# Plan: Layer 2 — AI Analysis Agent for MSSQL Monitoring

## Context

Layer 1 đã hoàn chỉnh: tự động detect issues → lưu `Finding` → gửi Telegram alert. Layer 2 hiện tại chỉ là 1-shot Claude call (max 1024 tokens, không tool use, không web API).

**Mục tiêu Layer 2:** AI agent độc lập — khi DBA trigger `/analyze`, agent tự động query thêm MSSQL DMV để lấy data chẩn đoán, chọn skill phù hợp, trả về phân tích chuyên sâu.

---

## Architecture Tổng Quan

```
Layer 1 (không sửa)                  Layer 2 (mới)
────────────────────                  ─────────────────────────────────
Monitor → Finding → Alert      →      Telegram /analyze | POST /api/v1/analyze
MongoDB: findings (write)             AgentOrchestrator
TelegramNotifier: send alerts              ↓ load skill từ YAML
                                           ↓ build system prompt + DB context
                                           ↓ Claude agentic loop (tool use)
                                           ↓ DiagnosticExecutor → MSSQL DMV
                                           ↓ save ai_analyses → MongoDB
                                      Telegram reply | API response
```

**Integration:** cùng MongoDB, cùng MSSQL cluster (read-only), cùng Telegram bot token.
**Disable Layer 1 TelegramBot:** bỏ `CLAUDE_API_KEY` khỏi Layer 1 `.env` → Layer 1 chỉ gửi alerts, Layer 2 poll commands.

---

## Directory Structure

```
layer2/
├── main.py                    # FastAPI app + uvicorn entry
├── config.py                  # Layer2Settings
├── agent/
│   ├── orchestrator.py        # AgentOrchestrator — agentic loop chính
│   ├── tool_executor.py       # Dispatch Claude tool calls → MSSQL/MongoDB
│   ├── tool_registry.py       # Whitelist + Claude tool definitions
│   ├── skill_loader.py        # Load YAML files → dict[issue_type, AnalysisSkill]
│   └── context_builder.py     # Kết hợp base prompt + specialization + DB context
├── models/
│   ├── analysis.py            # AnalysisRequest, AnalysisResult, ToolCallRecord
│   └── skill.py               # AnalysisSkill Pydantic model
├── storage/
│   ├── mongo_client.py        # Copy từ layer1
│   ├── indexes.py
│   └── repositories/
│       ├── analysis_repo.py
│       ├── insight_repo.py            # CRUD + upsert/recurrence logic cho issue_insights
│       └── db_context_repo.py
├── executor/
│   ├── mssql_connection.py    # Copy từ layer1
│   └── diagnostic_executor.py # SQL templates + parameterized execution
├── api/
│   └── routes/
│       ├── analysis.py        # POST /analyze, GET /analyses/{id}
│       ├── skills.py          # GET /skills
│       └── health.py
├── notifications/
│   └── telegram_bot.py        # Enhanced bot: /analyze → AgentOrchestrator
├── db_business_context.yaml   # DBA viết thủ công: critical tables, known patterns, maintenance windows
├── skills/                    # YAML files — version-controlled, không dùng MongoDB
│   ├── _base.yaml             # Base system prompt dùng chung
│   ├── slow_query.yaml            # SLOW_QUERY, HIGH_VARIATION_QUERY
│   ├── plan_xml.yaml              # PLAN_REGRESSION, PLAN_INSTABILITY, NON_OPTIMAL_INDEX, PARTITION_ELIMINATION_FAILURE
│   ├── index.yaml                 # MISSING_INDEX, INDEX_FRAGMENTATION
│   ├── blocking.yaml
│   ├── deadlock.yaml
│   ├── tempdb.yaml
│   ├── memory.yaml
│   ├── wait.yaml
│   ├── ag.yaml
│   ├── cdc.yaml
│   ├── resource.yaml
│   ├── maintenance.yaml
│   └── generic.yaml           # Fallback
└── utils/
    ├── time_utils.py
    └── peak_hours.py
```

---

## Skills — YAML Design

Skills là **code artifact**, lưu trong git. Thay đổi prompt → sửa file → commit → deploy.

### Tách base prompt và specialization

`ContextBuilder` kết hợp 3 phần thành system prompt:

```
[1] _base.yaml → base_system_prompt      (SHARED, static → prompt cache hit cho MỌI skill)
[2] skill.yaml → specialization          (nhỏ, per issue_type)
[3] db_context (MongoDB)                 (schema, AG config, Resource Governor)
```

**`_base.yaml`** — dùng chung, sửa 1 chỗ có hiệu lực tất cả:
```yaml
base_system_prompt: |
  Bạn là chuyên gia SQL Server 2019 Enterprise performance tuning.
  Hệ thống: bán hàng quy mô lớn, 200M records/table, 50.000 req/phút.
  Cluster: AG 1 Primary + 2 Secondary, CDC enabled, Resource Governor,
  partition quarterly.
  Nhiệm vụ: phân tích root cause, đề xuất action cụ thể.
  KHÔNG gợi ý OPTION(OPTIMIZE FOR UNKNOWN).
  KHÔNG đề xuất thực thi lệnh — chỉ recommendations.
```

**Skill YAML (ví dụ `slow_query.yaml`):**
```yaml
skill_id: slow_query_v1
issue_types:
  - slow_query
  - high_variation_query

specialization: |
  Focus: slow query và query có execution time bất thường.
  Ưu tiên kiểm tra theo thứ tự:
  1. Query Store history — phát hiện plan regression (thời điểm, plan nào tốt/xấu)
  2. Parameter sniffing — cùng query_hash có nhiều plan_handle với perf khác nhau lớn,
     đặc biệt nguy hiểm trên partitioned table khi partition key là parameter
  3. Statistics freshness — stale stats → cardinality estimate sai → bad plan
  4. Execution plan XML (nếu có) — scan vs seek, implicit conversion, spill warning
  5. Wait stats — PAGEIOLATCH (I/O), RESOURCE_SEMAPHORE (memory grant), LCK_M_* (lock)
  6. TempDB spills — total_spills cao + CDC version store áp lực
  7. Partition elimination — function trên partition column làm mất elimination

user_prompt_template: |
  Phân tích finding:
  Issue: {issue_type} | Severity: {severity}
  Node: {node} ({role}) | Detected: {detected_at}
  Metrics: {metrics_json}
  Query Hash: {query_hash}
  {query_text}
  {query_plan_xml}

required_tools:
  - get_query_stats           # bao gồm total_spills, group by plan_handle
  - get_query_store_history   # plan regression detection
  - get_statistics_info       # stats freshness cho tables trong query
  - get_wait_stats

optional_tools:
  - get_index_usage
  - get_missing_indexes
  - get_memory_grant
  - get_resource_governor_stats

max_tool_rounds: 6
max_tokens: 4096
include_fields: [query_plan_xml]   # inject XML vào user_prompt nếu có
```

**Skill YAML `plan_xml.yaml`** — phân tích chuyên sâu XML execution plan:
```yaml
skill_id: plan_xml_v1
issue_types:
  - plan_regression
  - plan_instability
  - non_optimal_index
  - partition_elimination_failure

specialization: |
  Focus: phân tích chuyên sâu XML execution plan.
  Finding đã chứa query_plan_xml — KHÔNG cần gọi get_query_plan tool.
  Đọc XML và tìm các pattern sau:
  - Index Scan trên large table (EstimatedRows cao) → candidate for Seek
  - Key Lookup → thiếu covering index (include columns)
  - Implicit Conversion (CONVERT_IMPLICIT) → type mismatch, vô hiệu hóa index
  - Partition elimination: so sánh PartitionCount với tổng số partitions
  - Estimated vs Actual rows divergence lớn → stale statistics
  - Sort operator không có index → potential index candidate
  - Hash Match với large memory grant → missing index hoặc data skew
  - SpillToTempDb warning → memory grant không đủ hoặc cardinality estimate sai
  - MissingIndexGroup hint embedded trong plan XML
  - Parallelism (DOP) có phù hợp không

user_prompt_template: |
  Phân tích execution plan:
  Issue: {issue_type} | Severity: {severity}
  Node: {node} ({role}) | Detected: {detected_at}
  Metrics: {metrics_json}
  Query Hash: {query_hash}
  {query_text}

  Execution Plan XML:
  {query_plan_xml}

required_tools:
  - get_statistics_info       # cross-check cardinality estimate vs actual
  - get_index_usage           # confirm index utilization thực tế

optional_tools:
  - get_query_store_history   # xem plan có bị regress từ lúc nào
  - get_missing_indexes       # cross-check với MissingIndexGroup trong XML
  - get_query_stats           # confirm actual runtime metrics

max_tool_rounds: 4
max_tokens: 4096
include_fields: [query_plan_xml, query_text]
```

**Prompt caching:** `base_system_prompt + DB context` là phần lớn nhất và GIỐNG NHAU cho mọi issue_type → 1 cache entry dùng chung, cache hit từ lần gọi thứ 2.

---

## MongoDB Collections Mới

| Collection | TTL | Mục đích |
|---|---|---|
| `ai_analyses` | 90 ngày | Lưu kết quả phân tích, tool calls, token usage |
| `issue_insights` | không | Structured insights — aggregate, trending, backlog |
| `db_context` | không | Schema, AG config, RG config — refresh 24h |
| `analysis_sessions` | 8 giờ | Multi-turn conversation state (Telegram) |

**`ai_analyses` key fields:**
```
analysis_id, finding_id, finding_snapshot, skill_id,
status (pending|running|completed|failed|timeout),
tool_calls[], analysis_text,
input_tokens, output_tokens, cache_read_tokens, total_duration_ms
```

**`issue_insights`** — không TTL, lưu vĩnh viễn, phục vụ tổng hợp dài hạn:
```json
{
  "insight_id": "uuid4",
  "analysis_id": "uuid4",        ← ref tới ai_analyses
  "finding_id": "uuid4",
  "detected_at": "ISODate",
  "issue_type": "slow_query",
  "node": "SQL-NODE-01",

  "root_cause_category": "partition_elimination_failure",
  "root_cause_summary": "YEAR() trên partition column ngăn elimination",

  "affected_tables": ["Orders"],
  "affected_indexes": ["IX_Orders_OrderDate"],
  "affected_queries": ["0xABCD1234"],

  "actions": [
    {
      "type": "query_fix",
      "description": "Thay YEAR(OrderDate)=? bằng date range WHERE",
      "priority": "high",
      "effort": "low",
      "resolved": false,
      "resolved_at": null
    },
    {
      "type": "architecture",
      "description": "Xem xét computed column trên partition key",
      "priority": "medium",
      "effort": "medium",
      "resolved": false,
      "resolved_at": null
    }
  ],

  "systemic": true,
  "recurrence_count": 1   ← tăng khi cùng pattern (root_cause_category + affected_tables) xuất hiện lại
}
```

**`action.type` enum:** `query_fix | index_change | statistics_update | architecture | maintenance | configuration`

**Indexes:** `(root_cause_category, detected_at)`, `(affected_tables, detected_at)`, `(systemic, detected_at)`, `("actions.resolved", "actions.priority")`

**`db_context`** — singleton document, merge từ 2 nguồn:
```
schema_info        ← auto-collect từ MSSQL (sys.tables, sys.indexes, partition, AG, RG, CDC)
business_context   ← DBA cung cấp qua db_business_context.yaml (commit git)
collected_at, schema_version
```

---

## DB Context — Setup & Provisioning

### Nguồn dữ liệu

| Nguồn | Nội dung | Ai cung cấp |
|---|---|---|
| MSSQL auto-collect | Tables + row count, index definitions, partition scheme, AG config, Resource Governor, CDC tables | Agent tự query |
| `db_business_context.yaml` | Business context, known patterns, critical tables, maintenance windows | DBA viết thủ công |

### `db_business_context.yaml` — DBA tự viết, commit git

```yaml
# layer2/db_business_context.yaml

description: |
  Hệ thống quản lý bán hàng. Orders là bảng trung tâm.
  Cuối tháng (ngày 25–31) traffic tăng 3x do đối soát.
  Batch job nightly 2:00–4:00 AM chạy report aggregation.

critical_tables:
  - name: Orders
    note: "200M rows, partition theo OrderDate quarterly.
           Thường join với OrderDetails và Customers.
           Query có YEAR(OrderDate) = ? sẽ không partition eliminate."
  - name: OrderDetails
    note: "~800M rows, FK tới Orders. Dễ bị scan nếu thiếu filter OrderID."
  - name: Inventory
    note: "CDC enabled, update liên tục từ warehouse service — TempDB version store áp lực cao."

known_patterns:
  - "CustomerID có data skew: top 1% customer chiếm 40% orders → hash join thường kém hơn nested loop"
  - "Index IX_Orders_Status fragmented nhanh do update thường xuyên — rebuild hàng tuần"
  - "Parameter sniffing hay xảy ra với OrderDate range queries qua partition boundary"

maintenance_windows:
  - "Chủ nhật 1:00–5:00 AM: REBUILD INDEX, UPDATE STATISTICS có thể chạy"
  - "Peak hours: 8:00–18:00 weekday — tránh heavy DMV queries"
```

### Auto-collect từ MSSQL

`POST /admin/refresh-db-context` trigger agent query các view sau trên Primary node:

```
sys.tables + dm_db_partition_stats     → top 50 tables theo row count
sys.indexes + sys.index_columns        → index definitions (bỏ PK trivial)
sys.partition_schemes/functions        → partition scheme + boundary values
sys.availability_groups/replicas       → AG topology
sys.resource_governor_resource_pools   → pool CPU/memory limits
sys.resource_governor_workload_groups  → workload group config
cdc.change_tables                      → danh sách tables có CDC
```

**Filter để tránh context quá lớn:**
- Chỉ lấy top 50 tables theo row count (configurable: `DB_CONTEXT_MAX_TABLES=50`)
- Tables trong `critical_tables` của YAML → luôn được include dù không top 50
- Mỗi table: tối đa 20 indexes, bỏ qua internal/system indexes

### Merge flow

```
refresh-db-context được gọi
    ↓
1. Load db_business_context.yaml từ filesystem
2. Query MSSQL auto-collect (chạy trên Primary node)
3. Merge:
   schema_info   ← MSSQL results
   business_context ← YAML content
   collected_at  ← now()
    ↓
4. Upsert vào MongoDB db_context (context_id="main")
5. Invalidate in-memory cache trong ContextBuilder
    ↓
6. Lần analyze tiếp theo → prompt cache cold start (1 lần)
   → từ lần 2 trở đi: cache hit
```

### Khi nào cần refresh

| Sự kiện | Hành động |
|---|---|
| Deploy Layer 2 lần đầu | `POST /admin/refresh-db-context` |
| Thêm/sửa index quan trọng | `POST /admin/refresh-db-context` |
| AG failover | Tự động refresh qua `NodeRoleCache` (AG config) |
| Thêm bảng mới vào critical | Sửa YAML + refresh |
| Auto-refresh định kỳ | Mỗi 24h (configurable: `DB_CONTEXT_MAX_AGE_HOURS`) |

---

## Claude Tool Use

Claude **không gửi SQL**. Claude gửi `tool_name + params` → `DiagnosticExecutor` map sang pre-written SQL template → execute.

**15 tools (whitelist):**

| Tool | DMV / Source | Skills sử dụng |
|---|---|---|
| `get_query_stats` | `dm_exec_query_stats` (incl. spills, group by plan_handle) | slow_query, plan_xml |
| `get_query_plan` | `dm_exec_cached_plans` | *(bỏ — finding đã có query_plan_xml)* |
| `get_query_store_history` | `query_store_query`, `query_store_plan`, `query_store_runtime_stats` | slow_query, plan_xml |
| `get_statistics_info` | `sys.stats`, `dm_db_stats_properties` | slow_query, plan_xml |
| `get_memory_grant` | `dm_exec_query_memory_grants` | slow_query, memory |
| `get_blocking_chain` | `dm_exec_requests`, `dm_os_waiting_tasks` | blocking, deadlock |
| `get_wait_stats` | `dm_os_wait_stats` | slow_query, wait |
| `get_index_usage` | `dm_db_index_usage_stats` | slow_query, plan_xml, index |
| `get_missing_indexes` | `dm_db_missing_index_details` | slow_query, plan_xml, index |
| `get_tempdb_usage` | `dm_db_file_space_usage` | tempdb |
| `get_ag_status` | `dm_hadr_availability_replica_states` | ag |
| `get_memory_pressure` | `dm_os_performance_counters`, `dm_os_memory_clerks` | memory |
| `get_resource_governor_stats` | `dm_resource_governor_resource_pools` | slow_query, resource |
| `get_cdc_status` | `dm_cdc_log_scan_sessions` | cdc |
| `get_recent_findings` | MongoDB `findings` | Tất cả (trend) |

> `get_query_plan` bị loại khỏi whitelist — `query_plan_xml` đã có trong finding, không cần query thêm.

**Safety:**
- Chỉ tool name trong whitelist được execute
- `node` input phải có trong `NodeRoleCache`
- Peak hours (8:00–18:00): block `get_index_fragmentation`
- Mọi SQL template: bắt buộc có `TOP N` hoặc `WHERE` thời gian

---

## Orchestration Flow (Tổng quát)

```
TRIGGER → LOAD FINDING → SELECT SKILL → BUILD PROMPT
    ↓
AGENTIC LOOP:
  Claude phân tích → gọi tool → DiagnosticExecutor query MSSQL
  → trả kết quả → Claude phân tích tiếp → ... → end_turn
    ↓
SAVE ai_analyses → UPDATE finding.status="analyzed"
EXTRACT insight từ <insight> block → SAVE issue_insights
  └─ Nếu cùng (root_cause_category + affected_tables) đã tồn tại → increment recurrence_count
CREATE/UPDATE analysis_session (TTL 8h)
    ↓
RESPOND (Telegram reply hoặc API response)
+ hint: "💬 Reply vào message này để hỏi thêm"
```

---

## Multi-turn Conversation

### Design

Sau khi agent gửi analysis, DBA đọc và có thể **reply trực tiếp vào message đó** để hỏi thêm. Session lưu full message history, Claude gọi thêm tools nếu cần.

**Session config:**
- TTL: **8 giờ** từ lần activity cuối (cover cả ca làm việc)
- Trigger follow-up: **chỉ reply vào analysis message** (không phải free text) — tránh nhầm lẫn khi nhiều DBA trong cùng chat
- Follow-up có thể gọi thêm tools với cùng whitelist

### `analysis_sessions` schema

```
session_id           uuid4
finding_id           uuid4
channel              "telegram"
telegram_message_id  int        ← message_id của analysis message để detect reply

turns: [                        ← CHỈ lưu text turns, KHÔNG lưu tool calls/results
  {
    role:        "user" | "assistant",
    content:     str,           ← text only
    analysis_id: uuid4 | null   ← assistant turn: ref tới ai_analyses (có full tool calls)
  }
]

turn_count        int
status            active | closed | expired
last_activity_at  datetime      ← TTL index (expireAfterSeconds=28800 = 8h)
```

**Không lưu:**
- Raw tool call/result blocks — đã có đầy đủ trong `ai_analyses.tool_calls[]`
- System prompt — reconstruct từ skill YAML + db_context khi follow-up (cache hit)

**Size thực tế:** ~15KB/session × 1000 sessions active = ~15MB — không đáng kể.

### Rebuild messages khi follow-up

```python
# Reconstruct messages cho Claude từ text turns đã lưu
messages = [
    {"role": turn.role, "content": turn.content}
    for turn in session.turns
]
messages.append({"role": "user", "content": dba_question})

# Gọi Claude:
# - system: reconstruct từ skill YAML + db_context → cache hit
# - messages: text turns + câu hỏi mới
# - tools: full whitelist (Claude gọi thêm nếu cần)
```

Tool results từ lần trước không cần replay — assistant response đã tóm tắt key findings vào text. Nếu DBA hỏi số cụ thể, Claude gọi tool lại.

### Telegram Bot Flow

```
Lần 1 — /analyze:
  Agent phân tích → reply message (message_id=1001)
  SessionRepo.create({telegram_message_id: 1001, turns: [first_turn]})
  Hint cuối message: "💬 Reply vào đây để hỏi thêm"

Lần 2 — DBA reply vào message_id=1001:
  Bot: message.reply_to_message.message_id == 1001?
  → SessionRepo.find_by_telegram_message_id(1001)
  → Còn active (< 8h)?
     YES → Rebuild messages từ turns[]
           → AgentOrchestrator.follow_up(session, dba_question)
           → Append new turns vào session, update last_activity_at
           → Bot reply kết quả
     NO  → "⚠️ Session hết hạn. Dùng /analyze để bắt đầu lại."

Lần 3+ — DBA tiếp tục reply:
  Tương tự, turns[] tích lũy dần
```

### Ví dụ follow-up sau slow_query analysis

```
Agent: "Root cause: partition elimination failure do YEAR(OrderDate)..."
       💬 Reply vào đây để hỏi thêm

DBA reply: "computed column có fix được không hay phải sửa tất cả queries?"

Claude (với full context):
  → Không cần tool mới, đã có đủ context từ lần 1
  → "Có 2 hướng: (1) Computed column + index nếu không sửa được app..."

DBA reply: "hiện tại index nào đang cover query đó?"

Claude:
  → Gọi get_index_usage(table="Orders", node="SQL-NODE-01")
  → "IX_Orders_CustomerDate cover được 2/4 columns cần thiết..."
```

---

## Demo: Luồng `slow_query`

### Scenario
Layer 1 detect query hash `0xABCD1234` chạy 4.5s (baseline 200ms). Finding được lưu MongoDB, Telegram alert gửi tới DBA. DBA reply `/analyze`.

### Bước 1 — Trigger & Load

```
TelegramBot nhận /analyze
  → FindingsRepo.find_by_id_prefix("03cc0a88")
  → Finding {
      issue_type: "slow_query", severity: "CRITICAL",
      node: "SQL-NODE-01", role: "primary",
      metrics: { avg_duration_ms: 4500, baseline_avg: 200, query_hash: "0xABCD1234" },
      query_text: "SELECT o.*, c.* FROM Orders o JOIN Customers c ..."
    }
  → finding.status = "analyzing"
```

### Bước 2 — Build Prompt

```
SkillLoader.get("slow_query") → slow_query.yaml
ContextBuilder.build_system(skill, db_context):
  system = [
    {
      text: base_prompt + "\n## Specialization\n" + skill.specialization
            + "\n## DB Context\n" + render(db_context),
      cache_control: {type: "ephemeral"}   ← cache block
    }
  ]
user_message = render(skill.user_prompt_template, finding)
```

### Bước 3 — Agentic Loop

**Round 1:** Claude đọc finding, gọi tool đầu tiên
```
Claude → tool_use: get_query_stats
  input: { query_hash: "0xABCD1234", node: "SQL-NODE-01" }

DiagnosticExecutor:
  SELECT TOP 10 execution_count, avg_elapsed_time, avg_logical_reads, ...
  FROM sys.dm_exec_query_stats
  WHERE query_hash = 0xABCD1234
  → { execution_count: 1250, avg_elapsed_us: 4480000, avg_logical_reads: 285000 }
```

**Round 2:** Claude thấy logical_reads cao bất thường, muốn xem plan
```
Claude → tool_use: get_query_plan
  input: { query_hash: "0xABCD1234", node: "SQL-NODE-01" }

DiagnosticExecutor:
  SELECT TOP 1 qp.query_plan FROM sys.dm_exec_cached_plans cp
  CROSS APPLY sys.dm_exec_query_plan(cp.plan_handle) qp
  CROSS APPLY sys.dm_exec_sql_text(cp.plan_handle) st
  WHERE ...
  → XML plan (tóm tắt): Index Scan trên Orders (200M rows), no partition elimination
```

**Round 3:** Claude muốn kiểm tra wait stats
```
Claude → tool_use: get_wait_stats
  input: { node: "SQL-NODE-01", top_n: 10 }

DiagnosticExecutor:
  → PAGEIOLATCH_SH: 68%, CXPACKET: 12%, ...
```

**Round 4:** Claude gọi `get_index_usage` để xác nhận index không được dùng
```
Claude → tool_use: get_index_usage
  input: { table_name: "Orders", node: "SQL-NODE-01" }

DiagnosticExecutor:
  → IX_Orders_OrderDate: user_seeks=0, user_scans=1250 (full scan!)
  → IX_Orders_CustomerID: user_seeks=980
```

**Round 5 — end_turn:** Claude đủ data, trả analysis text
```
stop_reason = "end_turn"

analysis_text:
  "Root cause: Query thực hiện Index Scan toàn bộ bảng Orders (200M rows) thay vì
   Index Seek. Nguyên nhân: điều kiện WHERE dùng function trên cột partition
   (YEAR(OrderDate) = 2024) → SQL Server không thể partition elimination.
   
   Bằng chứng:
   - avg_logical_reads: 285.000 (bình thường ~500 với Index Seek)
   - IX_Orders_OrderDate: 0 seeks, 1.250 scans
   - Wait type chủ đạo: PAGEIOLATCH_SH (I/O bound)
   
   Khuyến nghị:
   1. Sửa query: WHERE OrderDate >= '2024-01-01' AND OrderDate < '2025-01-01'
      thay vì WHERE YEAR(OrderDate) = 2024 (cho phép partition elimination)
   2. Verify với Query Store: kiểm tra plan regression sau lần deploy gần nhất
   3. Nếu query pattern này xuất hiện nhiều: cân nhắc computed column + index"
```

### Bước 4 — Finalize, Extract Insight & Respond

Claude output cuối response có kèm `<insight>` block (nhúng trong `user_prompt_template`):

```
analysis_text:
  "Root cause: partition elimination failure ...
   Khuyến nghị: 1. Sửa query WHERE range... 2. computed column..."

<insight>
{
  "root_cause_category": "partition_elimination_failure",
  "root_cause_summary": "YEAR() trên partition column ngăn elimination",
  "affected_tables": ["Orders"],
  "affected_indexes": ["IX_Orders_OrderDate"],
  "affected_queries": ["0xABCD1234"],
  "actions": [
    {"type": "query_fix", "description": "Thay YEAR()=? bằng date range", "priority": "high", "effort": "low"},
    {"type": "architecture", "description": "Computed column trên partition key", "priority": "medium", "effort": "medium"}
  ],
  "systemic": true
}
</insight>
```

Orchestrator parse `<insight>` block → strip khỏi analysis_text trước khi gửi DBA:

```
ai_analyses.insert({status: "completed", analysis_text: "...", tool_calls: [4], ...})
finding.status = "analyzed"

issue_insights: upsert theo (root_cause_category + affected_tables):
  → Nếu chưa có: insert mới, recurrence_count=1
  → Nếu đã có:   increment recurrence_count, append actions mới nếu khác

Telegram reply:
  🔍 Phân tích: slow_query | SQL-NODE-01
  ━━━━━━━━━━━━━━━━━━━━━━
  [analysis_text]
  ⚙️ Tools: 4 | ⏱ 9.4s | 🔗 abc12345
  💬 Reply để hỏi thêm
```

---

## Issue Insights — Aggregation & Summary

### `/summary` Telegram command

```
DBA: /summary

Bot reply:
  📊 Tổng hợp 30 ngày gần nhất
  ━━━━━━━━━━━━━━━━━━━━━━
  🔁 Root causes phổ biến:
    1. partition_elimination_failure  — 12 lần (Orders, OrderDetails)
    2. stale_statistics               — 8 lần  (Orders, Inventory)
    3. parameter_sniffing             — 5 lần  (Orders)

  🗂 Bảng hay gặp vấn đề:
    1. Orders       — 18 incidents
    2. OrderDetails — 9 incidents
    3. Inventory    — 6 incidents

  🏗 Architectural actions chưa giải quyết: 4
    • Xem xét computed column trên partition key (Orders) — xuất hiện 12 lần
    • Redesign CustomerID index strategy — 5 lần
    ...

  📋 Backlog high priority chưa xử lý: 7 actions
  🔗 Chi tiết: GET /api/v1/insights/summary
```

### Use cases tổng hợp dài hạn

| Query | Ý nghĩa |
|---|---|
| `recurrence_count DESC` | Pattern nào lặp lại nhiều nhất → systemic issue |
| `type=architecture, resolved=false` | Backlog architectural changes cần làm |
| `affected_tables=Orders` | Tất cả vấn đề của bảng Orders theo thời gian |
| `systemic=true, recurrence_count > 5` | Các vấn đề đủ nghiêm trọng để xử lý kiến trúc |
| `detected_at > 90 ngày trước` | Long-term trends (dù ai_analyses đã bị xóa TTL) |

> `issue_insights` không có TTL → giữ lại lịch sử dài hạn ngay cả sau khi `ai_analyses` bị xóa sau 90 ngày.

---

## FastAPI Endpoints

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/api/v1/analyze` | Trigger analysis (sync hoặc async) |
| `GET` | `/api/v1/analyses/{id}` | Get analysis result |
| `GET` | `/api/v1/analyses` | List (filter: issue_type, node, status) |
| `GET` | `/api/v1/findings/{id_prefix}` | Proxy get finding từ MongoDB |
| `GET` | `/api/v1/skills` | List loaded skills từ YAML |
| `POST` | `/api/v1/admin/refresh-db-context` | Re-collect schema/AG/RG từ MSSQL |
| `GET` | `/api/v1/insights` | List insights (filter: issue_type, table, root_cause, resolved, priority) |
| `GET` | `/api/v1/insights/summary` | Tổng hợp: top root causes, top tables, unresolved backlog |
| `PATCH` | `/api/v1/insights/{id}/actions/{idx}` | Mark action resolved/unresolved |
| `GET` | `/health` | MongoDB, MSSQL, model, skills_loaded |

---

## AI Cost Tracking

Mỗi `AnalysisResult` lưu chi phí thực tế của API call:

```python
# layer2/models/analysis.py
cost_usd: float = 0.0   # tính bởi cost_calculator.py sau khi agentic loop kết thúc
```

**`layer2/utils/cost_calculator.py`** — bảng giá USD per 1M tokens:

| Model | Input | Output | Cache Read | Cache Creation |
|---|---|---|---|---|
| claude-sonnet-4-6 | $3.00 | $15.00 | $0.30 | $3.75 |
| claude-haiku-4-5 | $0.80 | $4.00 | $0.08 | $1.00 |
| claude-opus-4-7 | $15.00 | $75.00 | $1.50 | $18.75 |

Orchestrator gọi `calculate_cost()` sau mỗi analysis, lưu vào `ai_analyses.cost_usd`.

**Summary endpoint** (`GET /insights/summary`) và **`/summary` Telegram command** hiển thị:
```
💰 Chi phí AI 30 ngày: $X.XX
```
Aggregate từ `ai_analyses` collection (TTL 90 ngày).

---

## Config & Dependencies

**Key env vars (`layer2/.env.layer2`):**
```env
MSSQL_NODES, MSSQL_DATABASE, MSSQL_USERNAME, MSSQL_PASSWORD
MONGODB_URI=mongodb://mongodb:27017
MONGODB_DB=db_monitor
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
PEAK_HOURS_START=8
PEAK_HOURS_END=18
AGENT_TIMEOUT_SEC=120
DB_CONTEXT_MAX_TABLES=50
DB_CONTEXT_MAX_AGE_HOURS=24
```

**Dependencies:** `pyodbc`, `pymongo`, `pydantic`, `pydantic-settings`, `anthropic>=0.40`, `fastapi`, `uvicorn`, `pyyaml`, `tenacity`, `python-logstash-async`

---

## Implementation Sequence

| Phase | Files |
|---|---|
| **1. Foundation** | `config.py`, `utils/`, `executor/mssql_connection.py`, `storage/mongo_client.py`, `models/` |
| **2. Storage** | `storage/indexes.py`, `analysis_repo.py`, `insight_repo.py`, `db_context_repo.py` |
| **3. Skills** | `skills/_base.yaml` + 12 skill YAMLs, `agent/skill_loader.py` |
| **4. Tool Layer** | `agent/tool_registry.py`, `executor/diagnostic_executor.py`, `agent/tool_executor.py` |
| **5. Agent Core** | `agent/context_builder.py`, `agent/orchestrator.py` |
| **6. Interfaces** | `api/routes/`, `main.py`, `notifications/telegram_bot.py` |
| **7. Deployment** | `layer2_Dockerfile`, update `docker-compose.yml`, `.env.layer2` template |

---

## Constraints Kế Thừa từ Layer 1

- **KHÔNG** gợi ý `OPTION(OPTIMIZE FOR UNKNOWN)`
- **KHÔNG** share pyodbc connection giữa threads
- **KHÔNG** query DMV không có `TOP`/`WHERE` thời gian
- **KHÔNG** để exception crash service — tool failure → `{"error": "..."}`, agent tiếp tục
- Full type hints, Pydantic models, structured logging

---

## Verification

1. `slow_query` end-to-end: `/analyze <id>` → Telegram reply với analysis + tool_calls_count
2. Prompt cache: gọi 2 lần cùng issue_type → `cache_read_tokens > 0` lần 2
3. Tool safety: node không hợp lệ → validation error, không execute
4. Peak hours: `get_index_fragmentation` trong 8–18h → blocked
5. `GET /health` → MongoDB connected, primary detected, skills_loaded=13
