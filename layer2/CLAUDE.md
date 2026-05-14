# CLAUDE.md — Layer 2: AI Analysis Agent

## Mục đích

AI Agent phân tích sự cố MSSQL theo yêu cầu (on-demand).

**Integration với Layer 1:**
- **Reply to Layer 1 alert**: Layer 1 TelegramBot extract finding_id, forward `POST http://layer2:8000/api/v1/analyze` với `telegram_chat_id` → Layer 2 bot gửi document trực tiếp
- **Direct `/analyze` command**: Layer 2 bot listen `/analyze` (token khác), gửi Telegram trực tiếp
- **Reply to Layer 2 document**: Layer 2 bot nhận reply → multi-turn session; nếu session không tồn tại → fallback extract finding_id từ Layer 1 alert text → trigger analysis mới
- (Hoặc: external client call API — Layer 2 chỉ trả JSON, không gửi Telegram)

**Cơ chế:**
Agent tự động query thêm MSSQL DMV để lấy data chẩn đoán, chọn skill phù hợp,
trả về phân tích chuyên sâu. Nếu `telegram_chat_id` có trong request → Layer 2 bot gửi Telegram trực tiếp;
ngược lại API chỉ trả JSON response.

**Data flow:**
- Layer 2 đọc từ MongoDB `findings` (write bởi Layer 1 monitoring)
- Query thêm MSSQL cluster (read-only DMV, phục vụ agentic loop)
- Ghi kết quả vào MongoDB `ai_analyses` + `issue_insights`
- Optionally: Telegram reply (nếu channel="telegram")

---

## Kiến trúc

```
Layer 1 reply-to-alert       Layer 2 /analyze cmd      External API client
        │                            │                        │
        └──────────┬────────────────┬────────────────────────┘
                   │ POST /api/v1/analyze (AnalysisRequest)
                   │ + telegram_chat_id (from Layer 1 only)
                   ▼
            AgentOrchestrator
    ↓ load skill từ SkillLoader (YAML)
    ↓ build system prompt: base_prompt + specialization + db_context
    ↓ agentic loop: Claude ↔ DiagnosticExecutor → MSSQL DMV
    ↓ parse <insight> block → InsightRepo.upsert()
    ↓ tính cost_usd = calculate_cost(model, tokens)
    ↓ AnalysisRepo.update_completed(result)
    │
    └─→ Nếu telegram_chat_id: TelegramBot.send_analysis_result() gửi Telegram
    │                                      
    └─→ API response trả JSON
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
│   ├── blocking.yaml          ← blocking_chain, blocked_query_snapshot, blocked_query_trend
│   ├── deadlock.yaml          ← deadlock (file riêng, không gộp vào blocking)
│   ├── tempdb.yaml            ← tempdb_pressure
│   ├── memory.yaml            ← memory_pressure
│   ├── wait.yaml              ← wait_anomaly
│   ├── ag.yaml                ← ag_lag
│   ├── cdc.yaml               ← cdc_failure
│   ├── resource.yaml          ← resource_pool_spike
│   ├── maintenance.yaml       ← job_failure, backup_gap, dbcc_overdue
│   └── generic.yaml           ← fallback (catch-all cho issue_type không có skill riêng)
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
│   └── analysis.py            ← AnalysisRequest (+ telegram_chat_id), AnalysisResult,
│                                 ToolCallRecord, InsightData, InsightAction
│
├── executor/
│   ├── mssql_connection.py    ← pyodbc context manager (per-call, không cache)
│   ├── diagnostic_executor.py ← SQL templates cho DMV tools + pre-processing methods
│   ├── plan_analyzer.py       ← Parse XML execution plan → structured summary (stdlib ET, no AI)
│   └── query_analyzer.py      ← Parse SQL query text → tables/joins/predicates (regex, no AI)
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
│   └── telegram_bot.py        ← Bot polling: /analyze, /summary, multi-turn reply
│                                 + send_analysis_result() public method (for API-triggered sends)
│                                 Reply handler: nếu không tìm thấy session → fallback parse
│                                 finding_id từ Layer 1 alert format → trigger new analysis
│
├── api/
│   └── routes/
│       ├── analysis.py        ← POST /analyze (+ call bot.send_analysis_result if telegram_chat_id),
│       │                         GET /analyses/{id}
│       ├── insights.py        ← GET /insights, GET /insights/summary
│       ├── skills.py          ← GET /skills
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

**`_base.yaml`** chứa:
- Instruction output plain text (KHÔNG markdown): `Định dạng output: plain text, KHÔNG dùng markdown`
- Instruction output `<insight>JSON</insight>` block ở cuối mỗi response
- Orchestrator parse insight block này, strip khỏi analysis_text trước khi gửi DBA

**Skill YAML fields** (xem `models/skill.py`):
- `skill_id`, `issue_types`, `specialization`, `user_prompt_template`
- `required_tools`, `optional_tools`, `max_tool_rounds`, `max_tokens`, `max_cost_usd`, `include_fields`
- `required_tools` chỉ được enforce cho **fresh analysis** — follow-up mode bỏ qua

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
1. _setup_logging()
2. MongoConnection.initialize()
3. create_all_indexes()
4. SkillLoader.load_all(skills_dir)     ← fail fast nếu _base.yaml missing
5. NodeRoleCache.initialize()           ← fail fast nếu cluster unreachable
6. TelegramBot.start() (daemon thread) + send_startup() notification
7. asyncio background task: NodeRoleCache.refresh() mỗi node_role_refresh_sec
8. uvicorn.run(app)
```

**Lưu ý:** `DbContextRepo` được khởi tạo nhưng không auto-refresh tại startup — context được load lazy khi `ContextBuilder` dùng đến.

---

## Agent Core — Cơ chế chi tiết

Xem `layer2/AGENT_MECHANISM.md` để hiểu toàn bộ luồng.

Tóm tắt nhanh:
- **Prompt cache**: `_base.yaml` = Block 1 với `cache_control: ephemeral` → cache hit từ lần gọi thứ 2 (rẻ hơn 10×)
- **Agentic loop**: Claude ↔ tool_use ↔ DiagnosticExecutor lặp đến `end_turn`; khi hết `max_tool_rounds`, bỏ truyền `tools` để force `end_turn`; `stop_reason=max_tokens` được detect riêng
- **Follow-up mode**: khi DBA reply, `is_follow_up=True` → skip required_tools enforcement (Q&A, không phải fresh analysis); Claude vẫn có thể dùng tools nếu cần
- **Insight**: Claude embed `<insight>JSON</insight>` → orchestrator parse, strip khỏi analysis_text, upsert vào `issue_insights`; nếu thiếu → retry 1 lần với yêu cầu chỉ JSON block
- **Cost**: tích lũy token usage qua tất cả API calls → `calculate_cost()` → lưu `cost_usd` mỗi analysis
- **Multi-turn session**: quản lý hoàn toàn bởi `TelegramBot.send_analysis_result()` (biết `sent_msg_id`); orchestrator KHÔNG tạo/update session

---

## Key Design Decisions

| Quyết định | Lý do |
|---|---|
| **Skills trong YAML, không MongoDB** | Thay đổi prompt = code change = review + commit + deploy — intentional friction |
| **`<insight>` block trong `_base.yaml`** | Dùng chung → nằm trong prompt cache static block → cache hit cho mọi skill |
| **Plain text format instruction trong `_base.yaml`** | Claude mặc định dùng markdown; chỉ thị trực tiếp tốt hơn post-processing regex |
| **Eager load skills tại startup** | Fail fast — phát hiện YAML broken ngay khi deploy, không phải khi có request |
| **`cost_usd` lưu trong mỗi analysis** | Granular tracking — biết được từng phân tích tốn bao nhiêu |
| **Tool whitelist + pre-written SQL** | Claude không thể inject SQL tùy ý — security + predictability |
| **Session lưu text turns, không tool calls** | Tool calls đã có trong ai_analyses; session chỉ cần text để rebuild context |
| **Session managed by TelegramBot, không Orchestrator** | Chỉ bot biết `sent_msg_id` (key session lookup); orchestrator không có thông tin này |
| **is_follow_up skip required_tools** | Follow-up là Q&A, không phải fresh analysis; enforce required_tools gây loop vì Claude thiếu context (node, query_hash) |
| **max_tokens detect riêng** | Khi response bị cắt, insight ở cuối mất → retry chỉ yêu cầu JSON block thay vì cả response |
| **Layer 2 bot gửi Telegram trực tiếp** | `send_analysis_result()` public method; dùng được từ bot-internal + API route |
| **`telegram_chat_id` trong AnalysisRequest** | Layer 1 forward request + đích chat; Layer 2 bot biết gửi kết quả đâu |
| **Layer 1 bot chỉ `/quick` + reply-to-alert** | `/analyze` quyền của Layer 2 bot (token khác); Layer 1 chỉ forward |

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn

**Status:** ✅ Fully Implemented (FastAPI + Telegram bot + Claude API)
