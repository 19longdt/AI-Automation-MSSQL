# ARCHITECTURE.md — Layer 2: AI Analysis Agent

## Mục đích

FastAPI service cung cấp 2 capabilities độc lập:
1. **AI Agent** (`/api/v1/analyze`): Phân tích sự cố MSSQL on-demand bằng Claude AI + agentic loop + DMV tools
2. **Plan Analysis Engine** (`/api/v1/plan/analyze`): Parse và phân tích XML execution plan bằng pure Python (không cần AI)

---

## Startup Sequence

```
lifespan(app):
    1. _setup_logging()
           → basicConfig + optional Logstash handler (UDP/TCP)

    2. MongoConnection.initialize(settings)
       create_all_indexes(db)  ← idempotent

    3. SkillLoader.load_all(skills_dir)
           → Eager load tất cả YAML trong skills/
           → Validate: _base.yaml phải tồn tại
           → Build: issue_type → AnalysisSkill map
           → Fail fast nếu YAML invalid/thiếu

    4. NodeRoleCache.initialize()
           → Query AG DMV: primary/secondary roles
           → Cache in-memory { host → role }
           → Fail fast nếu cluster unreachable

    5. Build agent components:
           ContextBuilder(skill_loader)
           ToolExecutor(node_role_cache, peak_start, peak_end)
           AgentOrchestrator(skill_loader, ctx_builder, tool_executor)

    6. Build plan analysis:
           PlanAnalysisService.create()
               → instantiate 10 analyzers + register
           PipelineRegistry.register(PlanAnalysisPipeline(service))

    7. _start_telegram_bot(app, orchestrator, skill_loader, node_role_cache)
           → TelegramBot(token, chat_id, orchestrator)
           → bot.start() → daemon thread

    8. asyncio.create_task(_node_role_refresh_loop(nrc))
           → refresh mỗi NODE_ROLE_REFRESH_SEC (default 3600s)

    yield  ← FastAPI serving

    shutdown: refresh_task.cancel() + MongoConnection.close()
```

---

## AI Agent — Agentic Loop (`/api/v1/analyze`)

### Request Path

```
POST /api/v1/analyze
    Body: AnalysisRequest {
        finding_id:         str        ← ID finding trong MongoDB
        channel:            str        ← "api" | "telegram"
        requested_by:       str | None
        telegram_chat_id:   str | None ← nếu có → gửi Telegram
        telegram_message_id: int | None ← message Layer 1 alert (cho reply threading)
        follow_up_text:     str | None ← DBA reply text (multi-turn)
    }
    │
    ├── analysis_repo.insert(result)  ← status=RUNNING
    │
    ├── AgentOrchestrator.run(request)
    │       ← xem chi tiết bên dưới
    │
    └── Nếu telegram_chat_id:
            TelegramBot.send_analysis_result(result, chat_id)
```

### AgentOrchestrator.run()

```
_execute(request, result):
│
├── ① Load finding từ MongoDB (findings collection)
│       finding = { issue_type, node, severity, metrics, ... }
│
├── ② Select skill
│       skill = skill_loader.get_skill(finding.issue_type)
│           issue_type "slow_sessions"   → slow_sessions.yaml
│           issue_type "blocking_chain"  → blocking.yaml
│           unknown                      → generic.yaml (fallback)
│
├── ③ Build system prompt (3-part, ContextBuilder)
│       Block 1: _base.yaml (STATIC — prompt cache hit)
│           cache_control: ephemeral
│           Instructions: output plain text, embed <insight> JSON
│       Block 2: skill.specialization (per issue_type)
│       Block 3: MongoDB db_context (schema, AG config, RG config)
│
├── ④ Build messages
│       Fresh analysis:
│           user: skill.user_prompt_template.format(finding, metrics)
│       Follow-up (is_follow_up=True):
│           Load session: prev turns (text only, no tool calls)
│           Append: user: request.follow_up_text
│
├── ⑤ Agentic loop: _agentic_loop(result, skill, system, messages)
│       ┌─────────────────────────────────────────────────────────┐
│       │  round = 0                                              │
│       │  while round < skill.max_tool_rounds:                  │
│       │      tools = build_tools_for_skill(skill)              │
│       │          if round == max_tool_rounds-1: tools = None   │
│       │          (force end_turn cuối)                         │
│       │                                                         │
│       │      response = claude_client.messages.create(         │
│       │          model=skill.model | settings.claude_model,    │
│       │          max_tokens=skill.max_tokens,                  │
│       │          system=system,    ← 3-part với cache_control  │
│       │          messages=messages,                            │
│       │          tools=tools,                                  │
│       │      )                                                  │
│       │                                                         │
│       │      Tích lũy token usage (in, out, cache_r, cache_w) │
│       │                                                         │
│       │      if stop_reason == "max_tokens":                   │
│       │          result.analysis_text = extract text blocks    │
│       │          result.status = COMPLETED  ← text bị cắt     │
│       │          return  ← bước ⑥ retry insight               │
│       │                                                         │
│       │      if stop_reason != "tool_use":  (end_turn)         │
│       │          if NOT is_follow_up:                          │
│       │              missing = required_tools - called_ok      │
│       │              if missing + rounds > 0 + tools_allowed:  │
│       │                  inject user reminder → remaining=1    │
│       │                  continue  ← 1 round nữa              │
│       │          result.analysis_text = extract text blocks    │
│       │          result.status = COMPLETED                     │
│       │          return                                        │
│       │                                                         │
│       │      # stop_reason == "tool_use"                       │
│       │      remaining_rounds -= 1                             │
│       │      if cost > max_cost_usd (first time):             │
│       │          budget_exceeded = True                        │
│       │          grace_tool_rounds = 1  ← 1 round ân hạn      │
│       │      for tool_call in response.content:                │
│       │          tool_result = tool_executor.execute(tool_call) │
│       │          Append tool_result vào messages               │
│       │          Log ToolCallRecord                            │
│       └─────────────────────────────────────────────────────────┘
│
├── ⑥ Parse insight
│       _extract_insight(result):
│           Tìm <insight>JSON</insight> trong analysis_text
│           Parse JSON → InsightData { root_cause_category,
│               root_cause_summary, systemic, actions[] }
│       Nếu thiếu và status==COMPLETED:
│           → _retry_missing_insight(): gửi lại 1 message "chỉ trả JSON block"
│
├── ⑦ Persist
│       InsightRepo.upsert(analysis_id, finding_id, issue_type, insight)
│           Key: (root_cause_category, sorted(affected_tables))
│           → Cùng pattern đã tồn tại: recurrence_count++, merge actions mới
│           → Chưa tồn tại: insert mới, recurrence_count=1
│
│       result.cost_usd = calculate_cost(model, tokens)
│       analysis_repo.update_completed(result)
│
└── ⑧ Return AnalysisResult
        {
          analysis_id, finding_id, skill_id, model,
          status, analysis_text, tool_calls[],
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          cost_usd, total_duration_ms, root_cause_summary, top_actions
        }
```

---

## Tool Safety (ToolExecutor)

Claude không gửi SQL — chỉ gửi tên tool + params. ToolExecutor dispatch sang pre-written SQL templates.

```
Tool whitelist (tool_registry.py) — 19 tools:
    # MongoDB/static tools (không query MSSQL):
    get_plan_analysis       ← parse query_plan_xml của finding → structured summary
    get_query_structure     ← parse query_text → tables/joins/predicates
    get_table_context       ← lookup db_context MongoDB theo table_name
    get_analysis_history    ← issue_insights + ai_analyses gần đây cho finding

    # DMV tools (query MSSQL trực tiếp):
    get_query_stats         ← dm_exec_query_stats theo query_hash (plan_predates_finding flag)
    get_query_store_history ← Query Store: plan regression timeline
    get_statistics_info     ← statistics freshness cho 1 bảng
    get_memory_grant        ← active memory grants (requested vs granted vs used)
    get_blocking_chain      ← dm_exec_requests blocking chain
    get_wait_stats          ← top wait types (lọc idle waits)
    get_index_usage         ← index usage stats cho 1 bảng
    get_missing_indexes     ← DMV missing index recommendations
    get_tempdb_usage        ← TempDB space per session
    get_ag_status           ← AG replica synchronization health
    get_memory_pressure     ← PLE, Target/Total memory, top clerks
    get_resource_governor_stats ← CPU/memory per Resource Governor pool
    get_cdc_status          ← CDC log scan sessions, lag
    get_recent_findings     ← findings gần đây từ MongoDB (không query MSSQL)
    get_index_fragmentation ← dm_db_index_physical_stats SAMPLED (block_in_peak_hours=True)

ToolExecutor.execute(tool_call):
    1. Kiểm tra tool_name trong whitelist → error nếu không có
    2. node param → NodeRoleCache.get(node) → error nếu không có
    3. block_in_peak_hours? → is_peak_hours()? → return error result
    4. Dispatch sang DiagnosticExecutor.run(tool_name, params)
           → SELECT ... FROM sys.dm_* WHERE ... ORDER BY ... FETCH TOP N
    5. Exception → return { "error": "message" } — KHÔNG crash agent

Peak hours: 8:00–18:00 VN time
    → Tool có block_in_peak_hours=True bị từ chối
    → Agent nhận error result, có thể thử tool khác hoặc kết luận
```

---

## Plan Analysis Engine (`/api/v1/plan/analyze`)

Pipeline hoàn toàn tách biệt với AI Agent — không dùng Claude, không dùng MongoDB.

```
POST /api/v1/plan/analyze
    Body: { plan_xml: str, source: "ui" | "layer1" }
    │
    ├── PipelineRegistry.run(PLAN_XML, plan_xml)
    │       → PlanAnalysisPipeline.run(plan_xml)
    │
    └── source == "layer1"  → return ToolSnapshot (compact)
        source == "ui"      → return PlanAnalysisOutput (full)
```

### PlanAnalysisPipeline.run(plan_xml)

```
plan_xml (str)
    │
    ▼ PlanAnalysisService.analyze(plan_xml)
    │
    ├── PlanParser.parse(plan_xml)
    │       → Namespace-aware XML parsing (ShowPlanXML)
    │       → list[ParsedStatement]:
    │           statement_text (truncated nếu len ≥ 3990)
    │           query_time: elapsed_time, cpu_time
    │           query_hash, query_plan_hash
    │           operator_tree (root OperatorNode)
    │           wait_stats[], memory_grant, parameters[]
    │           missing_index_groups[]
    │
    ├── Per statement: AnalyzerRegistry.run_all(PlanContext)
    │       10 analyzers, mỗi cái trả list[Finding]:
    │       │
    │       ├── OperatorAnalyzer
    │       │       Recursive traverse operator tree
    │       │       Detect:
    │       │         scan/lookup operations (→ missing_index hint)
    │       │         parallelism (CXPACKET overhead)
    │       │         row_underestimate: actual/estimate ≥ 10
    │       │         row_overestimate:  actual/estimate ≤ 0.1
    │       │       Description: include op_label + NodeId
    │       │
    │       ├── IndexAnalyzer
    │       │       MissingIndexes từ XML → IndexSuggestion[]
    │       │       Impact score → severity
    │       │
    │       ├── MemoryAnalyzer
    │       │       memory_grant.max_used_kb > granted_kb → spill
    │       │       grant_wait_ms > 0 → grant_inefficiency
    │       │
    │       ├── WaitAnalyzer
    │       │       14 wait type handlers (xem layer2/plan/analyzers/wait_analyzer.py)
    │       │       Severity: CRITICAL nếu LCK_M_ > 5s, WRITELOG > 5s, etc.
    │       │
    │       ├── StatisticsAnalyzer
    │       │       is_stale = True hoặc modification_count > threshold
    │       │
    │       ├── CompilationAnalyzer
    │       │       ce_model < 70 (SQL 2012 CE) → WARNING
    │       │       early_abort_reason → INFO
    │       │
    │       ├── ParallelismAnalyzer
    │       │       non_parallel_reason set + dop == 1 → forced_serial
    │       │       dop != expected_dop → dop_mismatch
    │       │
    │       ├── ParameterAnalyzer
    │       │       compiled_value != runtime_value → parameter_sniffing
    │       │
    │       └── CodePatternAnalyzer
    │               implicit_conversion (khác data type)
    │               spool operator
    │
    ├── _build_finding_groups(all_findings):
    │       Group by type (không phải recommendation)
    │       Escalate severity nếu nhiều instances
    │       shared_action = None nếu instances có action khác nhau
    │       Sort: critical → warning → info → count desc
    │       → list[FindingGroup]
    │
    ├── _build_wait_summary(wait_stats):
    │       Categorize: lck/io/latch/log_io/memory/memory_alloc/hadr/parallelism/network/cpu/other
    │       → list[WaitStatSummary]
    │
    └── PlanAnalysisResult { statements, total_findings, critical_count, ... }

    Sau khi PlanAnalysisService.analyze() → _enrich_truncated_texts(output, nrc):
        For each statement có statement_text_truncated == True:
            host = nrc.get_primary_host()
            _fetch_full_text(host, query_hash):
                Try: SELECT TOP 1 qt.query_sql_text
                     FROM sys.query_store_query q
                     JOIN sys.query_store_query_text qt ...
                     WHERE q.query_hash = CONVERT(binary(8), ?, 1)
                Fallback: SELECT TOP 1 SUBSTRING(st.text, offset...)
                          FROM sys.dm_exec_query_stats qs
                          CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
                          WHERE qs.query_hash = ...
            full_text dài hơn? → update statement_text, truncated=False
            Timeout 5s, silent fail nếu DB không accessible
```

### ToolSnapshot vs PlanAnalysisOutput

```
PlanAnalysisOutput (extends AnalysisOutput):
    analysis_type = PLAN_XML
    tool_snapshot: ToolSnapshot     ← compact, AI-ready
    statements: list[StatementResult]  ← full data cho UI
    total_findings, critical_count, warning_count
    analyzed_at, analysis_duration_ms

ToolSnapshot (AI digest — Layer 1 stores):
    status: "ok" | "error"
    findings: list[FindingGroup]     ← structured findings
    signals: dict {                  ← key metrics dạng số
        critical_count, spill_count, max_row_est_ratio,
        top_wait_type, top_wait_ms, memory_granted_kb,
        parameter_sniffing_count, ...
    }
    summary: str                     ← human-readable 1-2 câu
    recommendations: list[str]       ← top 5 actionable items
    duration_ms, row_count

StatementResult (Layer 3 full data):
    statement_text, statement_text_truncated
    elapsed_ms, cpu_ms
    finding_groups: list[FindingGroup]
    top_operators: list[OperatorSummary]
    missing_indexes: list[IndexSuggestion]
    memory_grant: MemoryGrantSummary
    parameters: list[ParameterInfo]
    wait_stats: list[WaitStatSummary]
    statistics: list[StatsSummary]
    io_stats: list[IOStatSummary]
    join_types: list[JoinTypeSummary]
    indexes_used: list[IndexUsage]
    compilation: CompilationInfo
```

---

## Multi-turn Telegram Session

```
DBA nhận Layer 2 analysis document
    │
    └── TelegramBot.send_analysis_result(result, chat_id):
            Gửi .txt document → Telegram API
            sent_msg_id = response.message_id
            SessionRepo.create(
                finding_id = result.finding_id,
                channel = "telegram",
                first_turn_text = result.analysis_text,
                analysis_id = result.analysis_id,
                telegram_message_id = sent_msg_id,  ← key để lookup khi DBA reply
            )
            → session_id = UUID (nội bộ)
            → TTL 8h trên last_activity_at

DBA reply vào document:
    TelegramBot._handle_reply(update):
        replied_to_id = update.message.reply_to_message.message_id
        session = session_repo.find(chat_id + ":" + replied_to_id)
        │
        ├── Session found:
        │       session.turns.append({ role:"user", text: reply_text })
        │       request = AnalysisRequest(
        │           finding_id = session.finding_id,
        │           follow_up_text = reply_text,
        │           telegram_chat_id = chat_id,
        │           channel = "telegram",
        │       )
        │       orchestrator.run(request)
        │           → is_follow_up = True
        │           → Build messages từ session.turns (no tool calls)
        │           → skip required_tools enforcement
        │
        └── Session NOT found:
                Fallback: parse finding_id từ Layer 1 alert text
                Nếu tìm được: trigger fresh analysis (is_follow_up=False)
                Nếu không: reply "Session expired — gửi lại /analyze"
```

---

## Skill System

```
skills/
├── _base.yaml         ← DÙNG CHUNG — Block 1 system prompt (prompt cache target)
│   instruction: output plain text
│   instruction: embed <insight>JSON</insight> ở cuối response
│   cache_control: ephemeral (Anthropic 5-minute TTL)
│
└── {issue_type}.yaml  ← Per skill
    skill_id:           "slow_sessions"
    issue_types:        ["slow_sessions", "high_variation_query"]
    specialization:     "..."  ← Block 2 system prompt
    user_prompt_template: "Phân tích finding: {issue_type} trên {node}..."
    required_tools:     ["get_session_details", "get_wait_stats"]
    optional_tools:     ["get_blocking_chain"]
    max_tool_rounds:    5
    max_tokens:         4096
    max_cost_usd:       0.05
    include_fields:     ["metrics.duration_ms", "metrics.query_hash"]
```

**Prompt caching economics:**
```
Fresh request, cùng issue_type:
    Block 1 (_base.yaml, ~2KB): CACHE HIT   → 0.1× giá input
    Block 2 (skill specialization, ~500 chars): new
    Block 3 (db_context, ~3KB): new nếu context đã hết TTL (5 phút)

Kết quả thực tế:
    Lần 1: full cost
    Lần 2+ (trong 5 phút): cache_read_tokens 60-70% → ~40% cost reduction
```

---

## MongoDB Collections (Layer 2)

| Collection | Write | Read | TTL | Notes |
|---|---|---|---|---|
| `ai_analyses` | AgentOrchestrator | Layer 3 | 90d | Full result + token usage + cost_usd |
| `issue_insights` | InsightRepo | Layer 3 | — | Structured insights, recurrence tracking |
| `db_context` | ContextBuilder | ContextBuilder | — | Singleton schema context (lazy load, stale > 24h) |
| `analysis_sessions` | TelegramBot | TelegramBot | 8h | Multi-turn conversation state |

---

## API Endpoints

| Method | Path | Handler | Notes |
|---|---|---|---|
| `POST` | `/api/v1/analyze` | analysis.py | Trigger AI analysis |
| `GET` | `/api/v1/analyses/{id}` | analysis.py | Get analysis by ID |
| `POST` | `/api/v1/plan/analyze` | plan.py | Parse XML plan |
| `GET` | `/api/v1/insights` | insights.py | List insights |
| `GET` | `/api/v1/insights/summary` | insights.py | 30-day cost + recurrence summary |
| `GET` | `/api/v1/skills` | skills.py | List loaded skills |
| `POST` | `/api/v1/admin/refresh-db-context` | admin.py | Force refresh db_context |
| `GET` | `/health` | health.py | Service health + node roles |

---

## Error Handling

| Tình huống | Xử lý |
|---|---|
| Tool call exception | Return `{"error": "..."}` → agent tiếp tục (không crash) |
| Claude max_tokens | `result.status = COMPLETED` (text bị cắt) — insight mất → retry JSON-only |
| PlanParseError | source=ui: HTTP 422; source=layer1: ToolSnapshot.from_error() |
| DB truncated text không enrich được | Silent fail — giữ text cũ, truncated=True |
| TelegramBot 409 Conflict | 30s backoff + log (duplicate process); 5s cho lỗi khác |
| Orchestrator unhandled exception | result.status = FAILED → analysis_repo.update_completed() |
| SkillLoader invalid YAML | Fail fast tại startup — không serve requests |
| NodeRoleCache unreachable | Fail fast tại startup |

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
