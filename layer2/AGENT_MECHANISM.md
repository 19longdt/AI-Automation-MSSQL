# Layer 2 — Agent Core: Cơ chế hoạt động

Tài liệu giải thích toàn bộ luồng của Phase 5 (`agent/orchestrator.py`, `agent/context_builder.py`).

---

## 1. Luồng tổng thể

```
DBA gõ /analyze (Telegram)
      │ Layer 1 TelegramBot nhận
      │ HTTP POST http://layer2:8000/api/v1/analyze
      ▼
AnalysisRequest { finding_id, channel="telegram", telegram_message_id }
      │
      ▼
AgentOrchestrator.run()
  │
  ├─ 1. Load Finding từ MongoDB `findings` (Layer 1 đã ghi)
  │       { issue_type, node, query_hash, metrics, ... }
  │
  ├─ 2. SkillLoader.get_skill(issue_type)
  │       → AnalysisSkill { slow_query_v1, max_tool_rounds=6, ... }
  │
  ├─ 3. ContextBuilder.build_system_prompt(skill)
  │       → [Block1(cached), Block2(specialization + db_context)]
  │
  ├─ 4. ContextBuilder.build_user_message(skill, finding)
  │       → "Phân tích finding: slow_query | node=SQL-01 | hash=0xABCD..."
  │
  ├─ 5. _agentic_loop()          ← PHẦN CHÍNH — xem mục 3
  │       → tích lũy tokens + tool_calls → analysis_text
  │
  ├─ 6. _extract_insight()
  │       → parse <insight>JSON</insight>, strip khỏi analysis_text
  │
  ├─ 7. calculate_cost()
  │       → cost_usd từ token usage thực tế
  │
  ├─ 8. InsightRepo.upsert()
  │       → MongoDB `issue_insights` (recurrence tracking)
  │
  ├─ 9. AnalysisRepo.update_completed()
  │       → MongoDB `ai_analyses`
  │
  └─ 10. Session create/update (Telegram channel only)
```

---

## 2. Prompt Caching

`ContextBuilder.build_system_prompt()` trả về **2 blocks** cho Anthropic API:

```python
system = [
    # Block 1 — STATIC, giống nhau cho mọi skill và mọi request
    {
        "type": "text",
        "text": "<nội dung _base.yaml>",
        "cache_control": {"type": "ephemeral"}   # ← Anthropic cache
    },

    # Block 2 — VARIABLE: thay đổi theo skill + db_context
    {
        "type": "text",
        "text": "<specialization>\n\n---\n\n<db_context từ MongoDB>"
    }
]
```

**Tại sao Block 1 phải là phần lớn nhất và tĩnh nhất?**

Anthropic cache hoạt động theo prefix — nếu block đầu giống hệt nhau giữa các lần gọi,
toàn bộ block đó được phục vụ từ cache.

| Token type | Giá (per 1M) | Ghi chú |
|---|---|---|
| Input (cache miss) | $3.00 | Lần gọi đầu tiên |
| Cache creation | $3.75 | Ghi vào cache (1 lần) |
| Cache read | $0.30 | Các lần gọi sau (**rẻ hơn 10×**) |

`_base.yaml` chứa `<insight>` instruction dùng chung → đặt ở Block 1 → cache hit
cho **mọi skill** từ lần gọi thứ 2 trở đi.

---

## 3. Agentic Loop

Claude không trả lời 1 lần — nó là **agent tự chủ** trong vòng lặp:

```
messages = [{"role": "user", "content": "Phân tích: slow_query node=SQL-01..."}]

══════════════════════════════════════════════════════════════════

CALL 1 — Claude nhận finding, quyết định cần thêm data
  Claude response:
    stop_reason = "tool_use"
    content:
      text("Tôi cần kiểm tra execution stats và query store history...")
      tool_use(id="t1", name="get_query_stats",
               input={"node":"SQL-01","query_hash":"0xABCD","top_n":10})
      tool_use(id="t2", name="get_query_store_history",
               input={"node":"SQL-01","query_hash":"0xABCD","days_back":7})

  → Orchestrator execute "get_query_stats"       → DiagnosticExecutor → MSSQL DMV
  → Orchestrator execute "get_query_store_history" → DiagnosticExecutor → MSSQL DMV

  messages += [
    {"role": "assistant", "content": [text, tool_use(t1), tool_use(t2)]},
    {"role": "user",      "content": [
      {"type":"tool_result","tool_use_id":"t1","content":"{avg_elapsed_ms:1200,...}"},
      {"type":"tool_result","tool_use_id":"t2","content":"[{plan_id:1,avg_ms:300},{plan_id:2,avg_ms:2100}]"}
    ]}
  ]

══════════════════════════════════════════════════════════════════

CALL 2 — Claude phát hiện plan regression, muốn verify statistics
  Claude response:
    stop_reason = "tool_use"
    content:
      text("Phát hiện plan regression tại 2026-04-15. Cần kiểm tra statistics...")
      tool_use(id="t3", name="get_statistics_info",
               input={"node":"SQL-01","table_name":"Orders"})

  → Execute "get_statistics_info" → MSSQL
  messages += [assistant..., user(tool_result t3)]

══════════════════════════════════════════════════════════════════

CALL 3 — Claude có đủ data, tổng hợp phân tích
  Claude response:
    stop_reason = "end_turn"
    content:
      text("""
        ## Root Cause: Plan Regression
        Query 0xABCD bị plan regression từ 2026-04-15 do statistics cũ.
        Plan cũ (plan_id=1): avg 300ms. Plan mới (plan_id=2): avg 2100ms.
        ...
        <insight>
        {"root_cause_category":"plan_regression", ...}
        </insight>
      """)

  → stop_reason="end_turn" → THOÁT LOOP
```

### Cơ chế max_tool_rounds

```
remaining_rounds = skill.max_tool_rounds  # ví dụ: 6

Mỗi vòng lặp:
  if remaining_rounds > 0:
      call Claude WITH tools
  else:
      call Claude WITHOUT tools  ← Claude không có tool → buộc end_turn

  if stop_reason == "end_turn" OR remaining_rounds <= 0:
      lấy analysis_text → THOÁT

  if stop_reason == "tool_use":
      execute tools
      remaining_rounds -= 1
      loop tiếp
```

**Tại sao không cắt ngang khi hết rounds?**
Bỏ truyền `tools` = cho Claude cơ hội **tổng hợp analysis** trước khi kết thúc,
thay vì dừng đột ngột khi Claude chưa viết được gì.

Tổng số API calls = số tool rounds thực tế + 1 lần kết luận cuối.

---

## 4. Insight Parsing

`_base.yaml` yêu cầu Claude embed JSON ở cuối mỗi response:

```
## Root Cause: ...
[phần analysis gửi DBA]

<insight>
{"root_cause_category": "plan_regression",
 "root_cause_summary": "Statistics cũ trên Orders gây plan regression",
 "affected_tables": ["Orders"],
 "actions": [{"type": "statistics_update", "priority": "high", ...}],
 "systemic": false}
</insight>
```

Orchestrator xử lý:
1. Regex tìm `<insight>(.*?)</insight>`
2. `json.loads()` → `InsightData` object
3. **Strip block** ra khỏi `analysis_text` → DBA nhận text sạch, không có JSON thô
4. Trả về `InsightData` để upsert vào MongoDB

Nếu không tìm thấy block: log warning, tiếp tục bình thường (không crash).

---

## 5. Recurrence Tracking (InsightRepo)

Cùng pattern (`root_cause_category` + `affected_tables`) có thể xảy ra nhiều lần:

```
Lần 1 → insert mới:  recurrence_count = 1
Lần 2 → update:      recurrence_count = 2, merge actions mới
Lần 5 → update:      recurrence_count = 5
```

DBA thấy qua `/summary`:
```
plan_regression trên Orders: 5 lần trong 30 ngày → systemic issue
```

Upsert key = `(root_cause_category, sorted(affected_tables))`.
Actions merge theo `description` để tránh duplicate.

---

## 6. Cost Tracking

```python
# Sau mỗi Claude API call trong loop — tích lũy:
result.input_tokens          += usage.input_tokens
result.output_tokens         += usage.output_tokens
result.cache_read_tokens     += usage.cache_read_input_tokens
result.cache_creation_tokens += usage.cache_creation_input_tokens

# Sau khi thoát loop:
result.cost_usd = calculate_cost(
    settings.claude_model,
    result.input_tokens,
    result.output_tokens,
    result.cache_read_tokens,
    result.cache_creation_tokens,
)
```

Cost được lưu trong `ai_analyses` → aggregate 30 ngày cho `/summary`.
Bảng giá trong `utils/cost_calculator.py` — sửa 1 chỗ khi Anthropic update giá.

---

## 7. Multi-turn Session

```
Lần 1 — fresh analysis (follow_up_text = None):
  messages = [user("Phân tích finding...")]
  → analysis xong → SessionRepo.create():
    { turns: [{ role:"assistant", content:"## Root Cause..." }] }

Lần 2 — follow-up (follow_up_text = "Tại sao không dùng query hint?"):
  → load session by telegram_message_id
  → messages = [
      {"role": "assistant", "content": "## Root Cause..."},  ← từ session
      {"role": "user",      "content": "Tại sao không dùng query hint?"}
    ]
  → Claude có full context lần 1 → trả lời coherent
  → SessionRepo.append_turns(): thêm 2 turns mới
```

Session TTL: 8 giờ. Chỉ lưu **text turns** — tool calls đã có trong `ai_analyses`.

---

## 8. Luồng dữ liệu tổng hợp

```
MongoDB `findings` (Layer 1)
    │ finding_id
    ▼
AgentOrchestrator._execute()
    │
    ├── system prompt (3 parts, Block 1 cached)
    │
    ├── user message (từ skill template + finding fields)
    │
    ▼
Claude API ──tool_use──► ToolExecutor
                              │
                              ▼
                         DiagnosticExecutor ──► MSSQL DMV
                              │
                         tool_results (JSON)
                              │
Claude API ◄──tool_result─────┘
    │
    │ (lặp đến end_turn hoặc hết max_tool_rounds)
    ▼
analysis_text + <insight>JSON</insight>
    │
    ├──► strip insight ──► InsightData
    │                          │
    │                          ▼
    │                    InsightRepo.upsert()
    │                          │
    │                          ▼
    │                    MongoDB `issue_insights`
    │
    ├──► calculate_cost() → result.cost_usd
    │
    └──► AnalysisRepo.update_completed()
               │
               ▼
         MongoDB `ai_analyses`
```

---

## Files liên quan

| File | Vai trò |
|---|---|
| `agent/orchestrator.py` | `AgentOrchestrator` — điều phối toàn bộ flow |
| `agent/context_builder.py` | Build system prompt (3 parts) + user message |
| `agent/skill_loader.py` | Load YAML skills + lookup theo issue_type |
| `agent/tool_executor.py` | Safety dispatch (whitelist + node + peak hours) |
| `agent/tool_registry.py` | 15 tool definitions + `build_claude_tools()` |
| `executor/diagnostic_executor.py` | SQL templates cho 15 DMV tools |
| `storage/repositories/insight_repo.py` | Upsert + recurrence tracking |
| `storage/repositories/session_repo.py` | Multi-turn Telegram session (TTL 8h) |
| `utils/cost_calculator.py` | USD cost từ token usage + MODEL_PRICING table |
| `skills/_base.yaml` | Base system prompt (cache block) + `<insight>` instruction |

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
