# ARCHITECTURE.md — AI-Automation-MSSQL

## Tổng quan hệ thống

Hệ thống tự động giám sát và phân tích sự cố cho cụm **MSSQL Server 2019 Enterprise Always On Availability Groups**. Kiến trúc 3 layer độc lập, giao tiếp qua MongoDB và HTTP API.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  MSSQL Cluster (1 Primary + 2 Secondary — roles auto-detected)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                         │
│  │  Primary    │  │ Secondary 1 │  │ Secondary 2 │                         │
│  │  (R/W)      │  │ (Readable)  │  │ (Readable)  │                         │
│  │  AG leader  │  │             │  │             │                         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                         │
└─────────┼───────────────┼───────────────┼─────────────────────────────────┘
          │               │               │ pyodbc (per-call, không cache)
          │               │               │
┌─────────▼───────────────▼───────────────▼─────────────────────────────────┐
│  LAYER 1 — Python Monitoring Service (port 8001)                            │
│                                                                             │
│  APScheduler: 1 job/topic, interval từ MongoDB                             │
│  ┌───────────────────────────────────────────────────────────────┐         │
│  │  TopicRunner.run(topic_id)                                     │         │
│  │  ① Reload config từ MongoDB (query/threshold/detector)        │         │
│  │  ② Resolve nodes (primary/secondary/all) từ NodeRoleCache     │         │
│  │  ③ Execute queries parallel (ThreadPoolExecutor)              │         │
│  │  ④ Save raw_metrics → MongoDB                                 │         │
│  │  ⑤ Detector (threshold/baseline/plan/blocking) → Finding[]   │         │
│  │  ⑥ CRITICAL + capture_tools? → DiagnosticCapture (4 phase)   │         │
│  │  ⑦ Dedup check → gửi Telegram/Teams alert                    │         │
│  └───────────────────────────────────────────────────────────────┘         │
│                                                                             │
│  HTTP API:  POST /kill-session  |  GET /health                              │
│  Telegram:  Bot polling — /quick (Haiku), /kill-session, → forward Layer 2 │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ Write: findings, raw_metrics, finding_diagnostics
                              │ Read:  monitor_topics, capture_tool_defs
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MongoDB (shared)                                                            │
│                                                                             │
│  monitor_topics         ← Layer 1 reads (config source of truth)           │
│  raw_metrics            ← Layer 1 writes (TTL 3d)                          │
│  findings               ← Layer 1 writes / Layer 2 reads (TTL 9d)          │
│  finding_diagnostics    ← Layer 1 writes (CRITICAL snapshot) / L2 reads (TTL 9d) │
│  capture_tool_defs      ← seed only                                        │
│  ai_analyses            ← Layer 2 writes                                   │
│  issue_insights         ← Layer 2 writes                                   │
│  analysis_sessions      ← Layer 2 R/W (multi-turn, TTL 8h)                 │
│  db_context             ← Layer 2 R/W (schema context)                     │
│  baselines              ← Layer 1 R/W (day-of-week baseline)               │
│  dedup_cache            ← Layer 1 R/W (suppress duplicate alerts, TTL 7d)  │
│  job_executions         ← Layer 1 R/W (job tracking, TTL 3d)               │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ Read: findings, finding_diagnostics
                              │ Write: ai_analyses, issue_insights, analysis_sessions
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — FastAPI AI Agent (port 8000)                                     │
│                                                                             │
│  POST /api/v1/analyze                                                       │
│  ┌───────────────────────────────────────────────────────────────┐         │
│  │  AgentOrchestrator.run(AnalysisRequest)                        │         │
│  │  ① Load finding từ MongoDB                                    │         │
│  │  ② Select skill (YAML) by issue_type                          │         │
│  │  ③ Build system prompt (base + skill + db_context)            │         │
│  │  ④ Agentic loop: Claude ↔ DiagnosticExecutor (DMV queries)    │         │
│  │  ⑤ Parse <insight> block → upsert issue_insights              │         │
│  │  ⑥ Calculate cost_usd → save ai_analyses                      │         │
│  │  ⑦ telegram_chat_id? → TelegramBot.send_analysis_result()     │         │
│  └───────────────────────────────────────────────────────────────┘         │
│                                                                             │
│  POST /api/v1/plan/analyze                                                  │
│  ┌───────────────────────────────────────────────────────────────┐         │
│  │  PlanAnalysisPipeline.run(plan_xml)                            │         │
│  │  → Parse XML → 10 analyzers → FindingGroup[] → ToolSnapshot   │         │
│  │  → Enrich truncated statement_text từ DB (query_hash lookup)  │         │
│  └───────────────────────────────────────────────────────────────┘         │
│                                                                             │
│  Telegram Bot: /analyze, /summary, multi-turn reply session                │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ MongoDB reads (analyses, insights, findings, topics)
                              │ HTTP proxy → Layer 2 (/api/v1/*)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — Fastify Web API + Frontend (port 3000)                           │
│                                                                             │
│  Pages:  /dashboard  /insights  /query-plan                                │
│                                                                             │
│  API routes:                                                                │
│  GET  /findings         ← MongoDB findings trực tiếp                       │
│  GET  /analyses         ← MongoDB ai_analyses                               │
│  GET  /insights         ← MongoDB issue_insights                            │
│  GET  /topics           ← MongoDB monitor_topics                            │
│  GET  /jobs             ← MongoDB job_executions                            │
│  POST /actions          ← forward → Layer 1 HTTP API                       │
│  POST /api/v1/plan/analyze ← proxy → Layer 2                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cross-Layer Data Flows

### Flow 1 — Monitoring → Alert → AI Analysis

```
APScheduler tick (mỗi topic_schedule_sec)
    │
    ▼ topic_runner.run("slow_sessions")
    │
    ├── ① Query MSSQL: SELECT sessions with duration > threshold
    │       → raw_metrics (MongoDB, TTL 30d)
    │
    ├── ② ThresholdDetector: value > critical_threshold?
    │       → Finding{ severity=CRITICAL, issue_type="slow_sessions",
    │                  query_hash, node, metrics{session_id, duration_ms, ...} }
    │
    ├── ③ topic.capture_tools? → DiagnosticCapture.capture(finding, topic)
    │       Phase 1: Parallel DMV snapshot (15s budget)
    │           get_wait_stats, get_blocking_info, get_query_stats, ...
    │       Phase 2: Static analysis
    │           parse query_plan_xml → ToolSnapshot (plan findings)
    │           parse query_text → tables/joins/predicates
    │       Phase 3: Table-specific DMV (max 3 tables)
    │           index_usage_stats, statistics_info per table
    │       Phase 4: MongoDB reads
    │           db_context, recent_findings, analysis_history
    │       → finding_diagnostics (MongoDB, self-contained snapshot)
    │       finding.has_diagnostics = True
    │
    ├── ④ findings_repo.insert(finding)
    │
    └── ⑤ DedupRepo: đã alert trong 30 phút? → skip
            → TelegramNotifier.send_alert(finding)
                → HTML message + 🔗 ID: <code>03cc0a88</code>
                → action buttons: /quick, /kill-session (nếu slow_sessions)

DBA nhận Telegram alert
    │
    ├── A. Reply bất kỳ text (không phải /quick, không phải action)
    │       Layer 1 bot: extract finding_id → POST http://layer2:8000/api/v1/analyze
    │           { finding_id, telegram_chat_id }
    │       │
    │       └── Layer 2: AgentOrchestrator.run(request)
    │               ① Load finding + finding_diagnostics từ MongoDB
    │               ② Select skill (slow_sessions.yaml)
    │               ③ Agentic loop (Claude Sonnet) ↔ DMV tools
    │               ④ Parse insight → issue_insights
    │               ⑤ TelegramBot.send_analysis_result()
    │                   → gửi .txt document với full analysis
    │                   → lưu sent_msg_id → analysis_sessions (TTL 8h)
    │
    ├── B. Reply /quick vào alert
    │       Layer 1 bot: PlanAnalyzer(haiku_model) → reply text ngay (5s)
    │
    └── C. Reply /kill-session vào slow_sessions alert
            Layer 1 bot → TopicActionRegistry → SessionService.kill_session()
                → KILL <session_id> trên MSSQL → reply "Đã kill session"

DBA reply vào Layer 2 analysis document
    │
    └── Layer 2 bot: lookup session bằng replied_message_id
            → multi-turn: append follow-up → AgentOrchestrator.run(is_follow_up=True)
            → skip required_tools enforcement (Q&A mode)
            → Claude dùng tools nếu cần
```

### Flow 2 — Query Plan Analysis (Web UI)

```
DBA mở /query-plan page (Layer 3 web)
    │
    ├── Paste XML execution plan
    │
    └── POST /api/v1/plan/analyze
            │ (Layer 3 proxy → Layer 2)
            ▼
        PlanAnalysisPipeline.run(plan_xml)
            │
            ├── PlanParser: parse ShowPlanXML → ParsedStatement[]
            │       detect statement_text_truncated (len ≥ 3990)
            │
            ├── 10 Analyzers run_all(context):
            │       OperatorAnalyzer   → scan/lookup/underestimate/overestimate
            │       IndexAnalyzer      → missing_index
            │       MemoryAnalyzer     → spill, grant_inefficiency
            │       WaitAnalyzer       → 14 wait type handlers
            │       StatisticsAnalyzer → stale_stats
            │       CompilationAnalyzer → ce_downgrade, early_abort
            │       ParallelismAnalyzer → forced_serial, dop_mismatch
            │       ParameterAnalyzer  → parameter_sniffing
            │       CodePatternAnalyzer → implicit_conversion, spool
            │       (Finding[] per analyzer)
            │
            ├── _build_finding_groups(): gom Finding[] → FindingGroup[]
            │       group by type, sort critical→warning→info
            │
            ├── _enrich_truncated_texts():
            │       truncated? → query primary node
            │           Query Store: full text (không bị 4000 char limit)
            │           Plan Cache: fallback (statement_start/end_offset)
            │
            └── PlanAnalysisOutput{
                    statements[]:     full data cho Layer 3 UI
                    tool_snapshot:    AI-ready digest (Layer 1 lưu)
                }
                │
                └── Layer 3: PlanAnalysisComponent.render()
                        5 groups: ORIENTATION, COST ANALYSIS, ACTIONABLE,
                                  CONTEXT, DEEP DIVE
                        Glossary tooltips: 70+ entries
```

### Flow 3 — Dashboard Monitoring (Web UI)

```
Browser → Layer 3 /dashboard
    │
    ├── GET /findings?severity=critical&limit=20
    │       Layer 3 API → MongoDB findings direct read
    │       → Findings table with issue_type, node, severity
    │
    ├── GET /topics
    │       → Monitor topics list (enabled/disabled, last_run)
    │
    ├── GET /jobs?limit=50
    │       → Job execution history (ok/failed/stuck)
    │
    └── GET /analyses?limit=10
            → AI analyses history (cost_usd, duration, status)

Browser → Layer 3 /insights
    │
    └── GET /insights
            Layer 3 API → MongoDB issue_insights
            → Structured insights: root_cause, actions, recurrence_count
```

---

## Technology Stack

| Layer | Runtime | Framework | Key Dependencies |
|---|---|---|---|
| Layer 1 | Python 3.12+ | stdlib HTTP | APScheduler, pyodbc, pymongo, anthropic, lxml |
| Layer 2 | Python 3.12+ | FastAPI + uvicorn | anthropic, pyodbc, pymongo, pydantic |
| Layer 3 API | Node.js 20+ | Fastify | mongodb driver, node-fetch |
| Layer 3 Web | TypeScript (compiled) | Vanilla TS | No framework |
| Database | — | MongoDB 6+ | — |
| Infra | Docker Compose | nginx (static) | — |

---

## Deployment

```
┌──────────────────────────────────────────────────────────┐
│  Docker Compose (server)                                  │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ layer1   │  │ layer2   │  │ layer3   │  │ mongodb │  │
│  │ :8001    │  │ :8000    │  │ :3000    │  │ :27017  │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
│                                                           │
│  Networks: tất cả trong cùng docker bridge network        │
│  Volumes:  mongodb_data (persistent)                      │
└──────────────────────────────────────────────────────────┘

Build machine:
  docker build -t 19longdt/ai-automation-mssql:vX.X.X .
  docker push ...

Server:
  docker compose pull layerN && docker compose up -d layerN
  (pull + restart từng layer độc lập, không downtime cho layers khác)
```

---

## Key Design Principles

| Nguyên tắc | Biểu hiện |
|---|---|
| **Config-driven** | SQL queries + thresholds nằm trong MongoDB, không hardcode Python |
| **Fail fast** | Thiếu required config → crash tại startup, không silent fail lúc runtime |
| **Stateless jobs** | Mỗi TopicRunner.run() reload config từ MongoDB — thêm/sửa không cần restart |
| **Node role auto-detect** | AG failover transparent — không hardcode Primary hostname |
| **On-demand AI only** | Claude chỉ gọi khi DBA chủ động — không auto-analyze mọi finding |
| **Tool whitelist** | Claude không thể inject SQL tùy ý — chỉ gọi tên tool, Layer 2 dispatch pre-written SQL |
| **Self-contained snapshot** | `finding_diagnostics` đủ để Layer 2 phân tích mà không cần query thêm DB |
| **Separation of concerns** | Layer 1 = detect; Layer 2 = analyze; Layer 3 = visualize; MongoDB = data bus |

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
