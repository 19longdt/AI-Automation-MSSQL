# CLAUDE.md — Layer 2: AI Analysis Agent

## Mục đích

AI Agent phân tích sự cố MSSQL theo yêu cầu (on-demand). Khi DBA gõ `/analyze`,
agent tự động query thêm MSSQL DMV để lấy data chẩn đoán, chọn skill phù hợp,
trả về phân tích chuyên sâu qua Telegram hoặc REST API.

**Layer 1 không bị sửa.** Layer 2 chỉ đọc từ MongoDB `findings` (write bởi Layer 1)
và MSSQL cluster (read-only DMV queries).

---

## Kiến trúc

```
Telegram /analyze | POST /api/v1/analyze
        ↓
AgentOrchestrator
    ↓ load skill từ SkillLoader (YAML)
    ↓ build system prompt: base_prompt + specialization + db_context
    ↓ agentic loop: Claude ↔ DiagnosticExecutor → MSSQL DMV
    ↓ parse <insight> block → InsightRepo.upsert()
    ↓ tính cost_usd = calculate_cost(model, tokens)
    ↓ AnalysisRepo.update_completed(result)
Telegram reply | API response
```

---

## Cấu trúc Module

```
layer2/
├── main.py                    ← FastAPI app + uvicorn entry
├── config.py                  ← Layer2Settings (env vars)
│
├── skills/                    ← YAML files — version-controlled, KHÔNG dùng MongoDB
│   ├── _base.yaml             ← Base system prompt DÙNG CHUNG — phải là phần đầu tiên
│   │                             của system prompt để enable prompt cache hit
│   ├── slow_query.yaml        ← slow_query, high_variation_query
│   ├── plan_xml.yaml          ← plan_regression, plan_instability, non_optimal_index,
│   │                             partition_elimination_failure
│   ├── index.yaml             ← missing_index, index_fragmentation
│   ├── blocking.yaml          ← blocking_chain, deadlock (TODO)
│   ├── tempdb.yaml            ← tempdb_pressure (TODO)
│   ├── memory.yaml            ← memory_pressure (TODO)
│   ├── wait.yaml              ← wait_anomaly (TODO)
│   ├── ag.yaml                ← ag_lag (TODO)
│   ├── cdc.yaml               ← cdc_failure (TODO)
│   ├── resource.yaml          ← resource_pool_spike (TODO)
│   ├── maintenance.yaml       ← job_failure, backup_gap, dbcc_overdue (TODO)
│   └── generic.yaml           ← fallback (TODO)
│
├── agent/
│   ├── skill_loader.py        ← Eager load + validate YAMLs, build issue_type → skill map
│   ├── context_builder.py     ← base_prompt + specialization + db_context → system prompt
│   ├── tool_registry.py       ← Whitelist 15 tools + Claude tool definitions (Phase 4)
│   ├── tool_executor.py       ← Dispatch Claude tool calls → DiagnosticExecutor (Phase 4)
│   └── orchestrator.py        ← Agentic loop chính + multi-turn (Phase 5)
│
├── models/
│   ├── skill.py               ← AnalysisSkill Pydantic model
│   └── analysis.py            ← AnalysisRequest, AnalysisResult (có cost_usd),
│                                 ToolCallRecord, InsightData, InsightAction
│
├── executor/
│   ├── mssql_connection.py    ← pyodbc context manager (per-call, không cache)
│   └── diagnostic_executor.py ← SQL templates cho 15 DMV tools (Phase 4)
│
├── storage/
│   ├── mongo_client.py        ← MongoConnection singleton
│   ├── indexes.py             ← TTL + compound indexes cho 4 collections
│   └── repositories/
│       ├── analysis_repo.py   ← CRUD ai_analyses
│       ├── insight_repo.py    ← Upsert + recurrence logic, get_summary()
│       ├── db_context_repo.py ← Singleton db_context, is_stale() check
│       └── session_repo.py    ← Multi-turn Telegram session (TTL 8h)
│
├── notifications/
│   └── telegram_bot.py        ← Bot polling: /analyze, /summary, multi-turn reply (Phase 6)
│
├── api/
│   └── routes/
│       ├── analysis.py        ← POST /analyze, GET /analyses/{id} (Phase 6)
│       ├── insights.py        ← GET /insights, GET /insights/summary (Phase 6)
│       ├── skills.py          ← GET /skills (Phase 6)
│       ├── admin.py           ← POST /admin/refresh-db-context (Phase 6)
│       └── health.py          ← GET /health (Phase 6)
│
├── utils/
│   ├── time_utils.py          ← now_vn(), utc_now()
│   ├── peak_hours.py          ← is_peak_hours() — check giờ VN
│   └── cost_calculator.py     ← calculate_cost(model, tokens) → float USD
│
└── db_business_context.yaml   ← DBA viết thủ công: bảng quan trọng, known patterns
```

---

## MongoDB Collections (Layer 2)

| Collection | TTL | Mục đích |
|---|---|---|
| `ai_analyses` | 90 ngày | Kết quả phân tích + tool calls + token usage + cost_usd |
| `issue_insights` | không | Structured insights, recurrence tracking, action backlog |
| `db_context` | không | Singleton schema/AG/RG context (refresh 24h) |
| `analysis_sessions` | 8 giờ | Multi-turn Telegram conversation state |

---

## AI Cost Tracking

Mỗi `AnalysisResult` lưu `cost_usd` tính từ token usage thực tế.

```python
# Sau agentic loop, trong orchestrator.py:
result.cost_usd = calculate_cost(
    settings.claude_model,
    result.input_tokens, result.output_tokens,
    result.cache_read_tokens, result.cache_creation_tokens,
)
```

**Bảng giá** trong `utils/cost_calculator.py` — sửa 1 chỗ khi Anthropic update pricing.

**Summary** (`/summary` command, `GET /insights/summary`) aggregate `cost_usd` 30 ngày từ `ai_analyses`.

---

## Skills — Thiết kế YAML

Skills là **code artifact**, lưu trong git. Thay đổi prompt → sửa YAML → commit → deploy.

**3-part system prompt** (ContextBuilder kết hợp):
```
[1] _base.yaml → base_system_prompt    ← STATIC, dùng chung → prompt cache hit
[2] skill.yaml → specialization        ← nhỏ, per issue_type
[3] MongoDB db_context                 ← schema, AG config, Resource Governor
```

**`_base.yaml`** phải chứa instruction output `<insight>JSON</insight>` block ở cuối mỗi response.
Orchestrator parse block này, strip khỏi analysis_text trước khi gửi DBA.

**Skill YAML fields** (xem `models/skill.py`):
- `skill_id`, `issue_types`, `specialization`, `user_prompt_template`
- `required_tools`, `optional_tools`, `max_tool_rounds`, `max_tokens`, `include_fields`

---

## Tool Safety

Claude **không gửi SQL**. Claude gửi `tool_name + params` → `tool_executor` → `diagnostic_executor` map sang pre-written SQL template.

- Chỉ tool name trong whitelist (`tool_registry.py`) được execute
- `node` phải có trong `NodeRoleCache`
- Tool có `block_in_peak_hours=True` → trả error result trong 8:00–18:00
- Mọi SQL template: bắt buộc `TOP N` hoặc `WHERE` thời gian

---

## Code Rules (kế thừa từ Layer 1)

- Full type hints trên mọi function
- Pydantic models cho data giữa modules
- pyodbc connection tạo mới per-call, không cache, không share giữa threads
- Exception trong tool call → return `{"error": "..."}`, agent tiếp tục (không crash)
- Structured logging: luôn có context (node, finding_id, analysis_id)
- **KHÔNG** query DMV không có TOP/WHERE
- **KHÔNG** share pyodbc connection giữa threads

---

## Entry Point

```bash
# Development
python -m layer2.main

# Docker
docker compose up -d layer2
```

```python
# Startup sequence (main.py):
1. Layer2Settings load
2. MongoConnection.initialize()
3. create_all_indexes()
4. SkillLoader.load_all(skills_dir)     ← fail fast nếu _base.yaml missing
5. NodeRoleCache.refresh()
6. DbContextRepo.is_stale() → auto-refresh nếu cần
7. TelegramBot.start() (daemon thread)
8. uvicorn.run(app)
```

---

## Agent Core — Cơ chế chi tiết

Xem `layer2/AGENT_MECHANISM.md` để hiểu toàn bộ luồng.

Tóm tắt nhanh:
- **Prompt cache**: `_base.yaml` = Block 1 với `cache_control: ephemeral` → cache hit từ lần gọi thứ 2 (rẻ hơn 10×)
- **Agentic loop**: Claude ↔ tool_use ↔ DiagnosticExecutor lặp đến `end_turn`; khi hết `max_tool_rounds`, bỏ truyền `tools` để force `end_turn`
- **Insight**: Claude embed `<insight>JSON</insight>` → orchestrator parse, strip khỏi analysis_text, upsert vào `issue_insights`
- **Cost**: tích lũy token usage qua tất cả API calls → `calculate_cost()` → lưu `cost_usd` mỗi analysis
- **Multi-turn**: `follow_up_text + telegram_message_id` → load session → rebuild context từ previous turns

---

## Key Design Decisions

| Quyết định | Lý do |
|---|---|
| **Skills trong YAML, không MongoDB** | Thay đổi prompt = code change = review + commit + deploy — intentional friction |
| **`<insight>` block trong `_base.yaml`** | Dùng chung → nằm trong prompt cache static block → cache hit cho mọi skill |
| **Eager load skills tại startup** | Fail fast — phát hiện YAML broken ngay khi deploy, không phải khi có request |
| **`cost_usd` lưu trong mỗi analysis** | Granular tracking — biết được từng phân tích tốn bao nhiêu |
| **Tool whitelist + pre-written SQL** | Claude không thể inject SQL tùy ý — security + predictability |
| **Session lưu text turns, không tool calls** | Tool calls đã có trong ai_analyses; session chỉ cần text để rebuild context |
