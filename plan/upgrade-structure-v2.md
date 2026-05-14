# Plan: Full-Capture Architecture — Layer 1 Runs All Tools, Layer 2 Pure Evaluation

## Context

**Vấn đề hiện tại:**
- Layer 2 `/analyze` gọi tools real-time → MSSQL state đã thay đổi → stale data → phân tích sai.
- Agentic loop tool errors khó debug. Layer 3 không thấy diagnostics lúc xảy ra sự cố.

**Giải pháp — Full-Capture:**
- **Layer 1**: Sau khi detect finding, chạy **tất cả** tools cần thiết → save full snapshot.
- **Layer 2 fresh analysis**: Load snapshot → Claude analyze mà **không cần gọi tools** → pure reasoning.
- **Layer 2 follow-up**: DBA hỏi thêm → vẫn có tool access để trả lời câu hỏi cụ thể với fresh data.

**Backward compatible:** `capture_tools: []` default → không ảnh hưởng topics hiện tại.

---

## Architecture

```
Layer 1 — Topic Runner (after detect finding):
  ┌─────────────────────────────────────────────────────────┐
  │ DiagnosticCapture.capture(finding, topic)               │
  │                                                         │
  │  Phase 1 — Parallel DMV queries (no table needed):      │
  │    get_blocking_chain, get_wait_stats, get_memory_grant,│
  │    get_tempdb_usage, get_ag_status, get_memory_pressure,│
  │    get_resource_governor_stats, get_cdc_status,         │
  │    get_missing_indexes, get_query_stats(*),             │
  │    get_query_store_history(*)                           │
  │    (* skip if finding.query_hash is None)               │
  │                                                         │
  │  Phase 2 — Static analysis (no MSSQL, from finding):   │
  │    get_plan_analysis   → parse plan_xml → extract tables│
  │    get_query_structure → parse query_text → extract tbl │
  │                                                         │
  │  Phase 3 — Table-specific (uses tables from Phase 2):   │
  │    get_index_usage(table_name)                          │
  │    get_statistics_info(table_name)                      │
  │                                                         │
  │  Phase 4 — MongoDB reads (stable context):              │
  │    get_table_context   → db_context collection          │
  │    get_recent_findings → findings collection            │
  │    get_analysis_history → issue_insights + ai_analyses  │
  │                                                         │
  │  → Save to `finding_diagnostics` collection             │
  │  → finding.has_diagnostics = True                       │
  └─────────────────────────────────────────────────────────┘
                    MongoDB `finding_diagnostics`
                              │
                    Layer 2 reads at /analyze
                              ▼
Layer 2 — AgentOrchestrator.run():

  [Fresh analysis — finding.has_diagnostics=True]:
    load snapshot
    → inject ALL snapshot data into user message
    → Claude.messages.create(system, [user_msg])   ← NO tools
    → extract <insight> block
    → save result (tool_calls=[], pre_captured_tools=[...])

  [Follow-up — DBA reply]:
    load session turns
    → Claude có tool access (agentic loop như hiện tại)
    → trả lời câu hỏi cụ thể với fresh data

  [Fresh analysis — finding.has_diagnostics=False  (fallback)]:
    behaves exactly như hiện tại (agentic loop with tools)
```

---

## MongoDB Schema: `finding_diagnostics`

```json
{
  "finding_id":           "uuid",
  "topic_id":             "slow_query",
  "node":                 "SQL-NODE-01",
  "captured_at":          ISODate,
  "capture_duration_ms":  4800,
  "tools_requested":      ["get_query_stats", "get_wait_stats", "get_plan_analysis", ...],
  "tools_captured":       ["get_query_stats", "get_wait_stats", "get_plan_analysis"],
  "tools_failed":         ["get_query_store_history"],
  "results": {
    "get_query_stats": {
      "status":      "ok",
      "rows":        [...],
      "row_count":   5,
      "duration_ms": 120
    },
    "get_plan_analysis": {
      "status":      "ok",
      "rows":        [{"operators": [...], "warnings": [...], "tables": [...]}],
      "row_count":   1,
      "duration_ms": 45
    },
    "get_table_context": {
      "status":      "ok",
      "rows":        [{"table_name": "...", "matched_entries": [...]}],
      "row_count":   2,
      "duration_ms": 8
    },
    "get_query_store_history": {
      "status":      "timeout",
      "rows":        [],
      "row_count":   0,
      "duration_ms": 10000
    }
  },
  "capture_error": null
}
```

**TTL:** 90 ngày. **Indexes:** `unique(finding_id)`, `(topic_id, captured_at DESC)`, TTL on `captured_at`.

---

## Capture Phases Chi Tiết

### Phase 1: Parallel DMV Queries

Chạy song song với `ThreadPoolExecutor`, mỗi tool timeout 10s, tổng 15s budget.

| Tool | Params | Skip khi |
|---|---|---|
| `get_blocking_chain` | node | — |
| `get_wait_stats` | node | — |
| `get_memory_grant` | node | — |
| `get_tempdb_usage` | node | — |
| `get_ag_status` | node | — |
| `get_memory_pressure` | node | — |
| `get_resource_governor_stats` | node | — |
| `get_cdc_status` | node | — |
| `get_missing_indexes` | node | — |
| `get_query_stats` | node, query_hash | query_hash is None |
| `get_query_store_history` | node, query_hash | query_hash is None |

### Phase 2: Static Analysis (No MSSQL)

Chạy từ dữ liệu trong finding (plan_xml, query_text) — không query MSSQL.

| Tool | Input | Logic |
|---|---|---|
| `get_plan_analysis` | `finding.metrics["query_plan_xml"]` | parse với plan_analyzer (copy từ Layer 2) |
| `get_query_structure` | `finding.query_text` | parse với query_analyzer (copy từ Layer 2) |

Sau Phase 2: extract `affected_tables = plan_result.tables + query_result.tables` (unique list, max 5 tables).

### Phase 3: Table-Specific DMV Queries

Chỉ chạy nếu Phase 2 extract được tables VÀ tool trong `capture_tools`.

| Tool | Params | Notes |
|---|---|---|
| `get_index_usage` | node, table_name | chạy cho mỗi table, max 3 tables |
| `get_statistics_info` | node, table_name | chạy cho mỗi table, max 3 tables |

### Phase 4: MongoDB Reads

Không query MSSQL, đọc từ MongoDB (same instance).

| Tool | Collection | Notes |
|---|---|---|
| `get_table_context` | `db_context` | lookup theo table_name từ Phase 2 |
| `get_recent_findings` | `findings` | last 24h, same node + issue_type |
| `get_analysis_history` | `issue_insights` + `ai_analyses` | pattern recurrence |

**Ghi chú Phase 4:** `get_analysis_history` đọc từ collections do Layer 2 manage nhưng cùng MongoDB instance → acceptable.

---

## `capture_tools` Per Topic

| topic_id | capture_tools |
|---|---|
| `blocking` | `["get_blocking_chain", "get_wait_stats", "get_recent_findings"]` |
| `slow_query` | `["get_query_stats", "get_wait_stats", "get_query_store_history", "get_plan_analysis", "get_query_structure", "get_index_usage", "get_statistics_info", "get_table_context", "get_analysis_history"]` |
| `plan_regression` / `plan_instability` | `["get_query_stats", "get_query_store_history", "get_plan_analysis", "get_query_structure", "get_index_usage", "get_table_context", "get_analysis_history"]` |
| `non_optimal_index` | `["get_plan_analysis", "get_query_structure", "get_index_usage", "get_missing_indexes", "get_statistics_info", "get_table_context"]` |
| `high_variation_query` | `["get_query_stats", "get_wait_stats", "get_plan_analysis", "get_query_structure"]` |
| `tempdb_pressure` | `["get_tempdb_usage", "get_memory_grant", "get_memory_pressure", "get_cdc_status"]` |
| `memory_pressure` | `["get_memory_pressure", "get_memory_grant"]` |
| `wait_anomaly` | `["get_wait_stats", "get_recent_findings"]` |
| `ag_lag` | `["get_ag_status", "get_wait_stats"]` |
| `resource_pool_spike` | `["get_resource_governor_stats", "get_wait_stats"]` |
| `cdc_failure` | `["get_cdc_status"]` |
| `missing_index` | `["get_missing_indexes", "get_index_usage", "get_query_stats", "get_table_context"]` |
| `deadlock` | `["get_blocking_chain", "get_wait_stats", "get_query_stats", "get_plan_analysis", "get_query_structure"]` |
| `index_fragmentation` | `[]` |
| `job_failure` / `backup_gap` | `[]` |

---

## Files to Create / Modify

### Layer 1 — New Files

**`layer1/capture/__init__.py`** — empty

**`layer1/capture/sql_templates.py`**
- SQL strings cho 11 DMV tools (Phase 1) + 2 table-specific (Phase 3)
- Dict `CAPTURABLE_SQL_TOOLS` — chỉ SQL-based tools
- `needs_query_hash: bool`, `needs_table_name: bool`
- `get_memory_pressure` dùng `params: "multi"` (2 queries)

**`layer1/capture/plan_analyzer.py`**
- Copy từ `layer2/executor/plan_analyzer.py`
- Function `analyze_plan(xml_text: str) -> dict` — parse SQL Server XML plan
- Trả về: operators, warnings, tables, partition access, implicit conversions, parallelism, spills

**`layer1/capture/query_analyzer.py`**
- Copy từ `layer2/executor/query_analyzer.py`
- Function `analyze_query(query_text: str) -> dict` — regex parse SQL
- Trả về: tables, joins, predicates, query_type

**`layer1/capture/diagnostic_capture.py`** — `DiagnosticCapture` class

```
DiagnosticCapture:
  capture(finding, topic) → bool:
    - skip nếu topic.capture_tools == [] (non-breaking default)
    - chỉ capture khi finding.alert_status != "suppressed"
    - Phase 1: _run_phase1_parallel(tool_names, finding)
    - Phase 2: _run_phase2_static(tool_names, finding) → extract affected_tables
    - Phase 3: _run_phase3_table_specific(tool_names, finding, affected_tables)
    - Phase 4: _run_phase4_mongo(tool_names, finding, affected_tables)
    - save to `finding_diagnostics`
    - return True nếu ít nhất 1 tool captured ok
    - KHÔNG raise exception bao giờ

  _run_phase1_parallel(tool_names, finding):
    - filter tools trong SQL_TOOLS whitelist
    - ThreadPoolExecutor, mỗi tool TOOL_TIMEOUT_SEC=10, tổng PHASE1_BUDGET_SEC=15

  _run_phase2_static(tool_names, finding) → (results, affected_tables):
    - get_plan_analysis: analyze_plan(xml) nếu plan xml có trong finding metrics
    - get_query_structure: analyze_query(query_text) nếu finding.query_text
    - extract tables từ cả hai kết quả

  _run_phase3_table_specific(tool_names, finding, tables):
    - get_index_usage, get_statistics_info cho mỗi table (max 3)
    - Sequential, mỗi query TOOL_TIMEOUT_SEC=10

  _run_phase4_mongo(tool_names, finding, tables):
    - get_table_context: MongoConnection.get_db()["db_context"].find_one()
    - get_recent_findings: FindingsRepo().find_recent_by_type()
    - get_analysis_history: query issue_insights + ai_analyses collections

  _run_one_sql(tool_name, sql, params, node, timeout) → dict:
    - ThreadPoolExecutor(1) + future.result(timeout)
    - return {"status": "ok/timeout/error/empty", "rows": [...], ...}
```

**`layer1/storage/repositories/diagnostics_repo.py`** *(optional wrapper)*
- Hoặc insert trực tiếp trong DiagnosticCapture qua `MongoConnection.get_db()`

---

### Layer 1 — Modified Files

**`layer1/models/topic.py`**
```python
class MonitorTopic(BaseModel):
    capture_tools: list[str] = Field(default_factory=list)
```

**`layer1/models/findings.py`**
```python
class Finding(BaseModel):
    has_diagnostics: bool = False
```

**`layer1/executor/topic_runner.py`**
- Constructor: add `diagnostic_capture: DiagnosticCapture | None = None`
- `run()`: pass `topic` to `_process_findings(findings, topic)`
- `_process_findings(findings, topic)`:
  ```
  for finding:
      compute_finding_hash()
      compute_alert_state()
      if alert_status != "suppressed" and self._diagnostic_capture and topic.capture_tools:
          try:
              finding.has_diagnostics = self._diagnostic_capture.capture(finding, topic)
          except:
              logger.error(...)  # belt-and-suspenders
      findings_repo.insert(finding)
  ```

**`layer1/storage/indexes.py`**
- `_create_finding_diagnostics_indexes(db)`: unique(finding_id), (topic_id, captured_at DESC), TTL 90d

**`layer1/scheduler.py`** *(hoặc nơi TopicRunner được khởi tạo)*
- Import `DiagnosticCapture`, inject vào `TopicRunner` constructor

**`layer1/seed/seed_topics.py`**
- Thêm `capture_tools` cho từng topic per bảng trên

---

### Layer 2 — New Files

**`layer2/storage/repositories/diagnostics_repo.py`** (read-only)
```python
class DiagnosticsRepo:
    def find_by_finding_id(self, finding_id: str) -> dict | None:
        return col.find_one({"finding_id": finding_id}, projection={"_id": 0})
```

---

### Layer 2 — Modified Files

**`layer2/models/analysis.py`**
```python
class AnalysisResult(BaseModel):
    pre_captured_tools: list[str] = Field(default_factory=list)
    used_snapshot: bool = False   # True khi fresh analysis dùng snapshot thay vì agentic loop
```

**`layer2/agent/context_builder.py`**
- `build_user_message(skill, finding, snapshot=None)` — add snapshot param
- `build_snapshot_block(snapshot) -> str`:
  ```
  ## Pre-captured diagnostics (captured at {captured_at}, node {node})
  ## Tools OK: [...] | Tools failed: [...]

  ### [get_blocking_chain] (8 rows, 312ms)
  [compact JSON, max 2000 chars per tool]

  ### [get_plan_analysis] (1 rows, 45ms)
  [compact JSON]
  ...
  ```
  - Max per-tool: 2000 chars; Max total: 8000 chars (fresh analysis có nhiều data hơn hybrid)
  - Truncate với `...[truncated]` khi vượt budget

**`layer2/agent/orchestrator.py`**

Thay đổi trong `_execute()`:
```python
# Load snapshot
snapshot = None
if finding.get("has_diagnostics"):
    snapshot = self._diagnostics_repo.find_by_finding_id(request.finding_id)
    if snapshot:
        result.pre_captured_tools = snapshot.get("tools_captured", [])
        result.used_snapshot = True

# Fresh analysis với snapshot: NO tools
if snapshot and not request.follow_up_text:
    user_content = context_builder.build_user_message(skill, finding, snapshot=snapshot)
    messages = [{"role": "user", "content": user_content}]
    response = claude_client.messages.create(
        model=settings.claude_model,
        system=system_prompt,
        messages=messages,
        max_tokens=skill.max_tokens,
        # NO tools parameter
    )
    result.analysis_text = _extract_text(response)
    result.input_tokens = response.usage.input_tokens
    result.output_tokens = response.usage.output_tokens
    result.cache_read_tokens = getattr(response.usage, "cache_read_input_tokens", 0)
    result.cache_creation_tokens = getattr(response.usage, "cache_creation_input_tokens", 0)
    # Insight retry nếu thiếu (max 1 retry)
    _extract_and_retry_insight(result, ...)
    return

# Follow-up hoặc no snapshot: agentic loop như hiện tại
_agentic_loop(messages, system_prompt, skill, result)
```

**`layer2/storage/indexes.py`**
- `_create_finding_diagnostics_indexes(db)` — idempotent

**`layer2/api/routes/analysis.py`**
```python
@router.get("/findings/{finding_id}/diagnostics")
async def get_finding_diagnostics(finding_id: str) -> dict:
    repo = DiagnosticsRepo()
    doc = repo.find_by_finding_id(finding_id)
    if not doc:
        raise HTTPException(404, "No diagnostic snapshot")
    return doc
```

---

## Context Optimization — Snapshot Injection

**Vấn đề:** Full snapshot (10+ tools × nhiều rows × nhiều columns) có thể reach 5000–15000 tokens — đắt và gây noise cho Claude reasoning.

**Nguyên tắc tách biệt:**
- MongoDB `finding_diagnostics` → lưu **full raw data** (cho Layer 3 display, debugging)
- Claude user message → chỉ inject **AI-optimized compact view** (column filter + row limit)

### Column Filtering Per Tool

Thêm `SNAPSHOT_KEY_COLUMNS: dict[str, list[str]]` trong `layer2/agent/context_builder.py`:

```python
SNAPSHOT_KEY_COLUMNS = {
    "get_blocking_chain":        ["session_id", "blocking_session_id", "wait_type", "wait_sec", "current_statement"],
    "get_wait_stats":            ["wait_type", "wait_time_ms", "pct_total"],
    "get_query_stats":           ["execution_count", "avg_elapsed_ms", "avg_logical_reads", "avg_cpu_ms", "avg_spills"],
    "get_query_store_history":   ["plan_id", "is_forced_plan", "avg_duration_ms", "count_executions", "last_execution_time", "plan_hash_hex"],
    "get_memory_grant":          ["session_id", "requested_memory_kb", "granted_memory_kb", "used_memory_kb"],
    "get_tempdb_usage":          ["session_id", "user_obj_mb", "internal_obj_mb", "total_mb"],
    "get_missing_indexes":       ["table_name", "equality_columns", "inequality_columns", "included_columns", "estimated_benefit"],
    "get_index_usage":           ["index_name", "type_desc", "user_seeks", "user_scans", "user_lookups", "user_updates"],
    "get_statistics_info":       ["table_name", "stat_name", "last_updated", "rows_sampled", "sample_pct", "modification_counter"],
    "get_resource_governor_stats": ["pool_name", "active_request_count", "total_cpu_usage_ms", "used_memgrant_mb"],
    # get_plan_analysis, get_query_structure: inject as-is (already structured dicts, not wide rows)
    # get_ag_status, get_memory_pressure, get_cdc_status: inject as-is (few columns, already compact)
}

SNAPSHOT_MAX_ROWS = {
    "get_blocking_chain":     30,   # show all — usually few rows, critical
    "get_wait_stats":         10,   # top 10 waits sufficient
    "get_query_stats":         5,
    "get_query_store_history": 10,
    "get_memory_grant":        10,
    "get_tempdb_usage":        10,
    "get_missing_indexes":     10,
    "get_index_usage":         15,
    "get_statistics_info":     10,
    # default: 5
}
```

### Injection Logic trong `build_snapshot_block()`

```python
def _apply_column_filter(rows: list[dict], tool_name: str) -> list[dict]:
    cols = SNAPSHOT_KEY_COLUMNS.get(tool_name)
    if not cols:
        return rows   # no filter = inject as-is
    return [{k: v for k, v in row.items() if k in cols} for row in rows]

def _apply_row_limit(rows: list[dict], tool_name: str) -> list[dict]:
    limit = SNAPSHOT_MAX_ROWS.get(tool_name, 5)
    if len(rows) > limit:
        return rows[:limit] + [{"_note": f"... {len(rows) - limit} more rows omitted"}]
    return rows
```

### Estimated Context Size (Sau Optimization)

| Tool | Cols | Rows | Est. chars |
|---|---|---|---|
| `get_wait_stats` | 3 | 10 | ~300 |
| `get_query_stats` | 5 | 5 | ~350 |
| `get_blocking_chain` | 5 | ≤10 | ~500 |
| `get_plan_analysis` | structured dict | 1 | ~400 |
| `get_query_structure` | structured dict | 1 | ~300 |
| `get_index_usage` | 6 | 10 | ~450 |
| `get_missing_indexes` | 5 | 5 | ~400 |
| `get_query_store_history` | 6 | 5 | ~350 |
| MongoDB tools (context, history) | compact | — | ~500 |
| **Total (slow_query rich case)** | | | **~3550 chars ≈ 900 tokens** |

**Prompt cache benefit:** `_base.yaml` (Block 1) vẫn được cache → cache hit từ lần call thứ 2. Snapshot nằm trong user message (không cached) nhưng chỉ ~900 tokens — **thấp hơn nhiều so với agentic loop** (mỗi tool round adds tokens cộng dồn).

---

## Phased Rollout

**Phase 1 — Deploy code (zero behavioral change)**
- Deploy Layer 1 + Layer 2 changes với `capture_tools=[]` default
- Không update seed topics → mọi thứ hoạt động như cũ
- Verify: `finding_diagnostics` collection empty, Layer 2 `/analyze` unchanged

**Phase 2 — Enable `blocking` topic (highest urgency, simplest)**
```javascript
db.monitor_topics.updateOne(
  {topic_id: "blocking"},
  {$set: {capture_tools: ["get_blocking_chain", "get_wait_stats", "get_recent_findings"]}}
)
```
- Monitor 24h: check job duration, check `finding_diagnostics` grows

**Phase 3 — Enable `slow_query` (most complex, test Phase 2+3+4)**
- Enable → verify plan analysis runs, table extraction works

**Phase 4 — All remaining volatile topics**

**Phase 5 — Update seed_topics.py as canonical source**

---

## Critical Files

| File | Action |
|---|---|
| `layer1/capture/diagnostic_capture.py` | CREATE |
| `layer1/capture/sql_templates.py` | CREATE |
| `layer1/capture/plan_analyzer.py` | CREATE (copy from layer2) |
| `layer1/capture/query_analyzer.py` | CREATE (copy from layer2) |
| `layer1/models/topic.py` | MODIFY — add capture_tools |
| `layer1/models/findings.py` | MODIFY — add has_diagnostics |
| `layer1/executor/topic_runner.py` | MODIFY — inject capture step |
| `layer1/storage/indexes.py` | MODIFY — add finding_diagnostics indexes |
| `layer1/scheduler.py` | MODIFY — wire DiagnosticCapture |
| `layer1/seed/seed_topics.py` | MODIFY — add capture_tools |
| `layer2/storage/repositories/diagnostics_repo.py` | CREATE |
| `layer2/agent/orchestrator.py` | MODIFY — snapshot path, no tools for fresh |
| `layer2/agent/context_builder.py` | MODIFY — build_snapshot_block() |
| `layer2/models/analysis.py` | MODIFY — pre_captured_tools, used_snapshot |
| `layer2/storage/indexes.py` | MODIFY — add finding_diagnostics indexes |
| `layer2/api/routes/analysis.py` | MODIFY — add GET diagnostics endpoint |

---

## Verification

```javascript
// Verify capture worked
db.findings.findOne({"has_diagnostics": true}, {"finding_id":1, "topic_id":1, "detected_at":1})

// Check specific snapshot
db.finding_diagnostics.findOne(
  {"topic_id": "slow_query"},
  {"tools_captured":1, "tools_failed":1, "capture_duration_ms":1}
)

// Verify Layer 2 used snapshot (no tool calls)
db.ai_analyses.findOne(
  {"used_snapshot": true},
  {"used_snapshot":1, "pre_captured_tools":1, "tool_calls":1, "cost_usd":1}
)
// tool_calls should be [] or minimal (only follow-up calls)

// Capture failure rate
db.finding_diagnostics.aggregate([
  {$unwind: "$tools_failed"},
  {$group: {_id: {topic:"$topic_id", tool:"$tools_failed"}, count:{$sum:1}}},
  {$sort: {count:-1}}
])
```

**End-to-end test:**
1. Trigger slow query on MSSQL
2. Wait Layer 1 detect → verify `finding_diagnostics` có plan_analysis, query_stats, wait_stats
3. Gọi `/analyze` → verify `tool_calls=[]` trong AnalysisResult, `used_snapshot=true`
4. Reply với follow-up question → verify tool được gọi (agentic loop activated)
5. `GET /api/v1/findings/{id}/diagnostics` → 200 với full snapshot

**Rollback:**
```javascript
db.monitor_topics.updateMany({}, {$set: {capture_tools: []}})
// Layer 2 fallback to agentic loop khi has_diagnostics=False
```
