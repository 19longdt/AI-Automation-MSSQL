# Layer 2 — Full-Capture Integration Plan

## Mục Tiêu

Layer 2 đọc snapshot từ `finding_diagnostics` (do Layer 1 capture) → inject vào Claude message → phân tích không cần gọi tools. Follow-up từ DBA vẫn dùng agentic loop như cũ.

---

## Luồng Hoạt Động (Layer 2)

```
POST /analyze (finding_id)
    │
    ├─ finding.has_diagnostics == True AND not follow_up_text
    │       ↓
    │  [Fresh analysis — snapshot path]
    │  DiagnosticsRepo.find_by_finding_id(finding_id)
    │       → build_user_message(skill, finding, snapshot=snapshot)
    │       → claude.messages.create(system, [user_msg])   ← NO tools
    │       → extract <insight>
    │       → save (used_snapshot=True, tool_calls=[], pre_captured_tools=[...])
    │
    ├─ follow_up_text (DBA reply)
    │       → agentic loop với tool access (như hiện tại)
    │
    └─ finding.has_diagnostics == False (fallback)
            → agentic loop như hiện tại (backward compatible)
```

---

## Files — Implementation Order

```
1.  layer2/storage/repositories/diagnostics_repo.py   CREATE — read-only
2.  layer2/models/analysis.py                         MODIFY — add pre_captured_tools, used_snapshot
3.  layer2/agent/context_builder.py                   MODIFY — build_snapshot_block() + ai_hints từ MongoDB
4.  layer2/agent/orchestrator.py                      MODIFY — snapshot path (no tools for fresh analysis)
5.  layer2/storage/indexes.py                         MODIFY — add finding_diagnostics + capture_tool_defs indexes
6.  layer2/api/routes/analysis.py                     MODIFY — add GET /findings/{id}/diagnostics endpoint
```

---

## Chi Tiết Từng File

### 1. `layer2/storage/repositories/diagnostics_repo.py` (NEW)

Read-only — chỉ đọc snapshot do Layer 1 tạo.

```python
"""diagnostics_repo.py — Read-only access vào finding_diagnostics collection."""
from __future__ import annotations
from ..mongo_client import MongoConnection


class DiagnosticsRepo:
    def find_by_finding_id(self, finding_id: str) -> dict | None:
        return MongoConnection.get_db()["finding_diagnostics"].find_one(
            {"finding_id": finding_id},
            projection={"_id": 0}
        )
```

---

### 2. `layer2/models/analysis.py`

Thêm 2 fields vào `AnalysisResult`:

```python
pre_captured_tools: list[str] = Field(default_factory=list)
# Danh sách tools đã được Layer 1 capture trong snapshot

used_snapshot: bool = False
# True khi fresh analysis dùng snapshot thay vì agentic loop
```

---

### 3. `layer2/agent/context_builder.py`

#### Thay đổi signature `build_user_message()`

```python
def build_user_message(self, skill: AnalysisSkill, finding: dict, snapshot: dict | None = None) -> str:
    # ... existing logic ...
    if snapshot:
        user_content += "\n\n" + self.build_snapshot_block(snapshot)
    return user_content
```

#### Thêm `build_snapshot_block()`

Đọc `ai_hints` từ MongoDB `capture_tool_defs` (single source of truth, cùng data với Layer 1).

```python
def build_snapshot_block(self, snapshot: dict) -> str:
    """
    Inject snapshot data vào Claude user message.
    Column filter và row limit đọc từ ai_hints trong capture_tool_defs.
    MongoDB lưu full data; Claude chỉ nhận compact view.
    """
    db = MongoConnection.get_db()
    lines = [
        f"## Pre-captured diagnostics (captured_at={snapshot.get('captured_at')}, node={snapshot.get('node')})",
        f"## Tools OK: {snapshot.get('tools_captured')} | Failed: {snapshot.get('tools_failed')}",
        "",
    ]

    for tool_id, result in snapshot.get("results", {}).items():
        if result.get("status") != "ok":
            continue

        hints = self._get_ai_hints(tool_id, db)
        key_cols = hints.get("key_columns", [])
        max_rows = hints.get("max_rows_for_ai", 5)
        interpret_as = hints.get("interpret_as", "")
        thresholds = hints.get("thresholds", {})

        rows = result.get("rows", [])
        if key_cols:
            rows = [{k: v for k, v in row.items() if k in key_cols} for row in rows]
        truncated = len(rows) > max_rows
        rows = rows[:max_rows]

        lines.append(f"### [{tool_id}] ({result.get('row_count')} rows, {result.get('duration_ms')}ms)")
        if interpret_as:
            lines.append(f"[Context: {interpret_as}]")
        if thresholds:
            lines.append(f"[Thresholds: {thresholds}]")
        lines.append(json.dumps(rows, ensure_ascii=False, separators=(',', ':'))[:2000])
        if truncated:
            lines.append(f"...[{result.get('row_count') - max_rows} more rows omitted]")
        lines.append("")

    return "\n".join(lines)

def _get_ai_hints(self, tool_id: str, db) -> dict:
    doc = db["capture_tool_defs"].find_one({"tool_id": tool_id}, {"ai_hints": 1, "_id": 0})
    return doc.get("ai_hints", {}) if doc else {}
```

#### Giới hạn context

- Max per-tool: 2000 chars (truncate với `...[N more rows omitted]`)
- Max total snapshot block: 8000 chars (thêm hard cap nếu cần)

#### Estimated context size (slow_sessions rich case)

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
| MongoDB tools | compact | — | ~500 |
| **Total** | | | **~3550 chars ≈ 900 tokens** |

**Lưu ý:** Prompt cache (`_base.yaml` Block 1) vẫn được cache từ lần call thứ 2. Snapshot nằm trong user message (~900 tokens) — thấp hơn nhiều so với agentic loop (mỗi tool round cộng dồn).

---

### 4. `layer2/agent/orchestrator.py`

Thêm snapshot path trong `_execute()`:

```python
# --- Load snapshot ---
snapshot = None
if finding.get("has_diagnostics"):
    snapshot = self._diagnostics_repo.find_by_finding_id(request.finding_id)
    if snapshot:
        result.pre_captured_tools = snapshot.get("tools_captured", [])
        result.used_snapshot = True

# --- Fresh analysis với snapshot: NO tools ---
if snapshot and not request.follow_up_text:
    user_content = self._context_builder.build_user_message(skill, finding, snapshot=snapshot)
    messages = [{"role": "user", "content": user_content}]
    response = self._claude_client.messages.create(
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
    # Insight retry nếu thiếu (max 1 retry — reuse existing logic)
    self._extract_and_retry_insight(result, skill, system_prompt)
    return

# --- Follow-up hoặc no snapshot: agentic loop như hiện tại ---
self._agentic_loop(messages, system_prompt, skill, result)
```

**Inject `DiagnosticsRepo` vào constructor:**
```python
self._diagnostics_repo = DiagnosticsRepo()
```

---

### 5. `layer2/storage/indexes.py`

Thêm 2 function mới (idempotent — `create_index` không fail nếu index đã tồn tại):

```python
TTL_FINDING_DIAGNOSTICS_SEC = 90 * 24 * 3600  # 90 ngày

def _create_finding_diagnostics_indexes(db: Database) -> None:
    col = db["finding_diagnostics"]
    col.create_index([("finding_id", ASCENDING)], unique=True, background=True)
    col.create_index([("topic_id", ASCENDING), ("captured_at", DESCENDING)], background=True)
    col.create_index([("captured_at", ASCENDING)], expireAfterSeconds=TTL_FINDING_DIAGNOSTICS_SEC, background=True)

def _create_capture_tool_defs_indexes(db: Database) -> None:
    col = db["capture_tool_defs"]
    col.create_index([("tool_id", ASCENDING)], unique=True, background=True)
    col.create_index([("enabled", ASCENDING)], background=True)
```

Gọi từ `create_all_indexes()`.

---

### 6. `layer2/api/routes/analysis.py`

Thêm endpoint mới cho Layer 3 và debugging:

```python
@router.get("/findings/{finding_id}/diagnostics")
async def get_finding_diagnostics(finding_id: str) -> dict:
    """Trả về full diagnostic snapshot (raw data, chưa filter cho AI)."""
    repo = DiagnosticsRepo()
    doc = repo.find_by_finding_id(finding_id)
    if not doc:
        raise HTTPException(status_code=404, detail="No diagnostic snapshot for this finding")
    return doc
```

---

## Behavior Matrix

| Condition | Path | tools param | used_snapshot |
|---|---|---|---|
| `has_diagnostics=True` + fresh request | Snapshot path | NOT passed | `True` |
| `has_diagnostics=True` + follow_up_text | Agentic loop | Passed | `False` |
| `has_diagnostics=False` | Agentic loop (fallback) | Passed | `False` |

---

## Lưu Ý Khi Implement `build_snapshot_block()`

### Phân biệt MongoDB vs Claude context

- **MongoDB `finding_diagnostics`** → lưu **full raw data** (cho Layer 3 display, debugging, audit)
- **Claude user message** → chỉ inject **compact view** theo `ai_hints` từ `capture_tool_defs`

Không filter dữ liệu trước khi save vào MongoDB. Filter chỉ xảy ra tại `build_snapshot_block()`.

### Tools inject as-is (không filter columns)

- `get_plan_analysis` — structured dict, không phải wide rows
- `get_query_structure` — structured dict
- `get_ag_status` — ít columns, đã compact
- `get_memory_pressure` — multi-query result `{"counters": [...], "top_clerks": [...]}`
- `get_cdc_status` — ít columns

Với các tools này, `ai_hints.key_columns = []` → `_get_ai_hints()` trả về empty list → inject as-is.

### Thứ tự inject tools

Inject theo thứ tự quan trọng giảm dần (gợi ý):
1. `get_blocking_chain` / `get_wait_stats` — bottleneck signal
2. `get_query_stats` / `get_query_store_history` — query-level metrics
3. `get_plan_analysis` / `get_query_structure` — structural analysis
4. `get_index_usage` / `get_statistics_info` / `get_missing_indexes` — table-level
5. MongoDB tools (context, history) — background context

---

## Verification

```javascript
// Verify Layer 2 dùng snapshot (no agentic loop)
db.ai_analyses.findOne(
  {"used_snapshot": true},
  {"used_snapshot":1, "pre_captured_tools":1, "tool_calls":1, "cost_usd":1, "input_tokens":1}
)
// tool_calls phải [] hoặc rất ít (chỉ follow-up calls)
// input_tokens thấp hơn agentic loop (~1200-1500 vs 3000+)

// Follow-up activates agentic loop
db.ai_analyses.findOne(
  {"used_snapshot": false, "follow_up_text": {$exists: true}},
  {"tool_calls":1, "cost_usd":1}
)
// tool_calls có data
```

**End-to-end test:**
1. Layer 1 detect finding → `finding.has_diagnostics = true`
2. `POST /api/v1/analyze` → verify `used_snapshot=true`, `tool_calls=[]` trong response
3. Reply với follow-up → verify `used_snapshot=false`, `tool_calls` có data
4. `GET /api/v1/findings/{id}/diagnostics` → 200 với full snapshot + `ai_hints` readable
5. Verify `ai_analyses` ghi nhận `pre_captured_tools` và `input_tokens` thấp hơn baseline

**Rollback:**
```javascript
// Layer 1: disable capture
db.monitor_topics.updateMany({}, {$set: {capture_tools: []}})
// Findings mới sẽ has_diagnostics=false → Layer 2 tự fallback agentic loop
// Findings cũ đã analyze xong → không bị ảnh hưởng
```
