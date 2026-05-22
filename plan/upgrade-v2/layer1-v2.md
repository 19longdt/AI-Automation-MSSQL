# Layer 1 — Full-Capture Implementation Plan

## Mục Tiêu

Sau khi detect finding, Layer 1 chạy **tất cả** diagnostic tools cần thiết → save full snapshot vào MongoDB `finding_diagnostics`. Layer 2 đọc snapshot này thay vì gọi tools real-time → tránh stale data.

**Backward compatible:** `capture_tools: []` default → topics hiện tại không bị ảnh hưởng.

---

## Luồng Hoạt Động (Layer 1)

```
topic_runner.run(topic_id)
    └─ _process_findings(findings, topic)
           │
           ├─ finding.severity == CRITICAL          AND
           │  topic.capture_tools không rỗng        AND
           │  self._diagnostic_capture is not None
           │         ↓
           │  DiagnosticCapture.capture(finding, topic)
           │         │
           │         ├─ Phase 1: Parallel DMV queries (ThreadPoolExecutor, 15s budget)
           │         ├─ Phase 2: Static analysis từ plan_xml / query_text (no MSSQL)
           │         ├─ Phase 3: Table-specific DMV (get_index_usage, get_statistics_info)
           │         └─ Phase 4: MongoDB reads (get_table_context, get_recent_findings, get_analysis_history)
           │                 ↓
           │         Save to MongoDB `finding_diagnostics`
           │         finding.has_diagnostics = True
           │
           └─ findings_repo.insert(finding)
```

---

## MongoDB Schema: `finding_diagnostics`

```json
{
  "finding_id":           "uuid",
  "topic_id":             "slow_sessions",
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

**TTL:** 90 ngày.
**Indexes:** `unique(finding_id)`, `(topic_id, captured_at DESC)`, TTL on `captured_at`.

---

## MongoDB Schema: `capture_tool_defs`

Collection mới lưu SQL templates + AI hints. Layer 1 đọc `sql`/`params` để chạy queries. Layer 2 đọc `ai_hints` để format snapshot khi inject vào Claude.

```json
{
  "tool_id":        "get_wait_stats",
  "display_name":   "Wait Statistics",
  "description":    "Top wait types từ sys.dm_os_wait_stats",
  "execution_type": "sql",
  "sql":            "SELECT TOP 20 ...",
  "sql_parts":      null,
  "params": {
    "needs_query_hash": false,
    "needs_table_name": false,
    "is_multi_query":   false
  },
  "phase":       1,
  "timeout_sec": 10,
  "enabled":     true,
  "ai_hints": {
    "key_columns":      ["wait_type", "wait_time_ms", "pct_total"],
    "max_rows_for_ai":  10,
    "interpret_as":     "Top waits tại T+0. PAGEIOLATCH_*: disk IO. LCK_M_*: lock...",
    "thresholds": {
      "pct_total": {"warning": 30, "critical": 50}
    }
  }
}
```

---

## Capture Phases Chi Tiết

> **Tổng quan:** 4 phase chạy tuần tự, mỗi phase có mục đích riêng. Phase chỉ ảnh hưởng thứ tự thực thi — kết quả tất cả phase đều ghi vào 1 document duy nhất trong `finding_diagnostics.results` (flat dict keyed by `tool_id`).

### Phase 1: Parallel DMV Queries

**Mục đích:** Chụp snapshot trạng thái server tại T+0 — ngay sau khi finding được detect. Trả lời câu hỏi: *"Server đang ở trạng thái gì lúc này?"*

Dữ liệu DMV thay đổi từng giây nên phải capture ngay, chạy song song để tối thiểu hoá thời gian chờ.

`ThreadPoolExecutor`, mỗi tool timeout 10s, tổng budget 15s.

| Tool | Params | Skip khi |
|---|---|---|
| `get_blocking_chain` | node | — |
| `get_wait_stats` | node | — |
| `get_memory_grant` | node | — |
| `get_tempdb_usage` | node | — |
| `get_ag_status` | node | — |
| `get_memory_pressure` | node (2 queries) | — |
| `get_resource_governor_stats` | node | — |
| `get_cdc_status` | node | — |
| `get_missing_indexes` | node | — |
| `get_query_stats` | node, query_hash | query_hash is None |
| `get_query_store_history` | node, query_hash | query_hash is None |

### Phase 2: Static Analysis (No MSSQL)

**Mục đích:** Phân tích cấu trúc query từ dữ liệu đã có sẵn trong finding — không cần kết nối MSSQL, không có timeout. Trả lời câu hỏi: *"Query này có vấn đề gì về cấu trúc?"*

Output quan trọng của phase này: danh sách `affected_tables` — input bắt buộc cho Phase 3.

Chạy từ dữ liệu trong finding — không query MSSQL.

| Tool | Input | Output |
|---|---|---|
| `get_plan_analysis` | `finding.metrics["query_plan_xml"]` | operators, warnings, tables, implicit conversions, spills |
| `get_query_structure` | `finding.query_text` | tables, joins, predicates, query_type |

Sau Phase 2: extract `affected_tables` (unique, max 5 tables) từ cả 2 kết quả → dùng cho Phase 3.

### Phase 3: Table-Specific DMV Queries

**Mục đích:** Query DMV theo từng table cụ thể được extract từ Phase 2. Trả lời câu hỏi: *"Các table bị ảnh hưởng có index/statistics tốt không?"*

Không thể chạy trước Phase 2 vì chưa biết table nào liên quan. Max 3 tables để giới hạn số lượng queries.

Chỉ chạy nếu Phase 2 extract được tables VÀ tool trong `capture_tools`.

| Tool | Params | Notes |
|---|---|---|
| `get_index_usage` | node, table_name | mỗi table, max 3 tables |
| `get_statistics_info` | node, table_name | mỗi table, max 3 tables |

### Phase 4: MongoDB Reads

**Mục đích:** Đính kèm context lịch sử và business knowledge vào snapshot — không query MSSQL. Trả lời câu hỏi: *"Vấn đề này có bối cảnh gì? Đã từng xảy ra chưa?"*

Giúp snapshot `finding_diagnostics` self-contained: Layer 2 nhận được đầy đủ context mà không cần query thêm MongoDB trong lúc phân tích.

Không query MSSQL, đọc từ MongoDB cùng instance.

| Tool | Collection | Notes |
|---|---|---|
| `get_table_context` | `db_context` | lookup theo affected_tables từ Phase 2 |
| `get_recent_findings` | `findings` | last 24h, same node + issue_type |
| `get_analysis_history` | `issue_insights` + `ai_analyses` | pattern recurrence |

---

## `capture_tools` Per Topic

| topic_id | capture_tools |
|---|---|
| `blocking` | `["get_blocking_chain", "get_wait_stats", "get_recent_findings"]` |
| `slow_sessions` | `["get_query_stats", "get_wait_stats", "get_query_store_history", "get_plan_analysis", "get_query_structure", "get_index_usage", "get_statistics_info", "get_table_context", "get_analysis_history"]` |
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

## Files — Implementation Order

```
1.  layer1/models/topic.py                  MODIFY — add capture_tools field
2.  layer1/models/findings.py               MODIFY — add has_diagnostics field
3.  layer1/models/capture_tool.py           CREATE — CaptureToolDef, AiHints, CaptureToolParams
4.  layer1/storage/indexes.py               MODIFY — add indexes cho 2 collections mới
5.  layer1/capture/__init__.py              CREATE — empty package
6.  layer1/capture/plan_analyzer.py         CREATE — copy từ layer2/executor/plan_analyzer.py
7.  layer1/capture/query_analyzer.py        CREATE — copy từ layer2/executor/query_analyzer.py
8.  layer1/capture/capture_tool_loader.py   CREATE — load & cache từ MongoDB
9.  layer1/capture/diagnostic_capture.py    CREATE — class chính, 4-phase capture
    layer1/capture/handlers/               CREATE — handler registry (tách khỏi diagnostic_capture.py)
        types.py                           —   StaticToolResult, StaticToolHandler, MongoToolHandler
        static_registry.py                 —   Registry cho static tools (phase 2)
        mongo_registry.py                  —   Registry cho mongo tools (phase 4)
        static_get_plan_analysis.py        —   Handler: parse XML plan
        static_get_query_structure.py      —   Handler: parse query text
        mongo_get_table_context.py         —   Handler: lookup db_context
        mongo_get_recent_findings.py       —   Handler: query findings 24h
        mongo_get_analysis_history.py      —   Handler: query issue_insights
10. layer1/executor/topic_runner.py         MODIFY — inject capture vào _process_findings()
11. layer1/scheduler.py                     MODIFY — CaptureToolLoader.load_all() + wire DiagnosticCapture
12. layer1/seed/seed_capture_tools.py       CREATE — seed 18 tool defs vào MongoDB
13. layer1/seed/seed_topics.py              MODIFY — add capture_tools per topic (Phase 5)
```

---

## Chi Tiết Từng File

### 1. `layer1/models/topic.py`

Thêm 1 field, backward compatible:

```python
capture_tools: list[str] = Field(default_factory=list)
```

---

### 2. `layer1/models/findings.py`

Thêm 1 field sau `alert_error`:

```python
has_diagnostics: bool = False
```

---

### 3. `layer1/models/capture_tool.py` (NEW)

```python
"""capture_tool.py — Pydantic model cho capture_tool_defs collection."""
from __future__ import annotations
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class ExecutionType(str, Enum):
    SQL    = "sql"     # phase 1 + 3: pyodbc → MSSQL DMV queries
    STATIC = "static"  # phase 2: parse XML/text trong process, không cần MSSQL
    MONGO  = "mongo"   # phase 4: đọc MongoDB, không cần MSSQL


class CaptureToolParams(BaseModel):
    needs_query_hash: bool = False
    needs_table_name: bool = False
    is_multi_query: bool = False


class AiHints(BaseModel):
    key_columns: list[str] = Field(default_factory=list)
    max_rows_for_ai: int = 5
    interpret_as: str = ""
    thresholds: dict[str, Any] = Field(default_factory=dict)


class CaptureToolDef(BaseModel):
    tool_id: str
    display_name: str = ""
    description: str = ""
    execution_type: ExecutionType = ExecutionType.SQL
    sql: str | None = None
    sql_parts: dict[str, str] | None = None   # cho is_multi_query (get_memory_pressure)
    params: CaptureToolParams = Field(default_factory=CaptureToolParams)
    phase: int = 1
    timeout_sec: int = 10
    enabled: bool = True
    ai_hints: AiHints = Field(default_factory=AiHints)
```

---

### 4. `layer1/storage/indexes.py`

Thêm 2 function mới và gọi từ `create_all_indexes()`:

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
    col.create_index([("phase", ASCENDING)], background=True)
```

---

### 5. `layer1/capture/__init__.py` (NEW)

Empty file.

---

### 6–7. `plan_analyzer.py` và `query_analyzer.py` (NEW)

Copy nguyên từ `layer2/executor/plan_analyzer.py` và `layer2/executor/query_analyzer.py` — stdlib only, không sửa gì.

---

### 8. `layer1/capture/capture_tool_loader.py` (NEW)

Eager load tại startup, cache ở class level. Fail fast nếu collection rỗng.

```python
"""capture_tool_loader.py — Load và cache CaptureToolDef từ MongoDB."""
from __future__ import annotations
import logging
from ..models.capture_tool import CaptureToolDef
from ..storage.mongo_client import MongoConnection

logger = logging.getLogger(__name__)


class CaptureToolLoader:
    _tools: dict[str, CaptureToolDef] = {}

    @classmethod
    def load_all(cls) -> None:
        """
        Gọi 1 lần tại startup sau MongoConnection.initialize().
        Raises RuntimeError nếu collection rỗng → fail fast khi deploy thiếu seed.
        """
        docs = list(MongoConnection.get_db()["capture_tool_defs"].find({"enabled": True}))
        if not docs:
            raise RuntimeError(
                "capture_tool_defs collection rỗng. "
                "Chạy: python -m layer1.seed.seed_capture_tools trước khi start."
            )
        cls._tools = {
            doc["tool_id"]: CaptureToolDef(**{k: v for k, v in doc.items() if k != "_id"})
            for doc in docs
        }
        logger.info("CaptureToolLoader: loaded %d tools", len(cls._tools))

    @classmethod
    def get(cls, tool_id: str) -> CaptureToolDef | None:
        return cls._tools.get(tool_id)

    @classmethod
    def get_all(cls) -> dict[str, CaptureToolDef]:
        return dict(cls._tools)
```

---

### 9. `layer1/capture/diagnostic_capture.py` (NEW)

```python
"""
diagnostic_capture.py — Full diagnostic snapshot tại T+0 khi finding được detect.
Tool SQL và AI hints được load từ MongoDB capture_tool_defs (via CaptureToolLoader).
"""
from __future__ import annotations
import decimal, logging, time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from datetime import datetime, timedelta
from typing import Any
import pyodbc

from ..executor.mssql_connection import mssql_connection
from ..models.capture_tool import CaptureToolDef, ExecutionType
from ..models.findings import Finding
from ..models.topic import MonitorTopic
from ..storage.mongo_client import MongoConnection
from ..utils.time_utils import now_vn
from .capture_tool_loader import CaptureToolLoader
from .plan_analyzer import analyze_plan
from .query_analyzer import analyze_query

logger = logging.getLogger(__name__)

PHASE1_BUDGET_SEC = 15
MAX_TABLE_TOOLS = 3


def _sanitize(v: object) -> object:
    if isinstance(v, decimal.Decimal): return float(v)
    if isinstance(v, datetime): return v.isoformat()
    if isinstance(v, bytes): return "0x" + v.hex().upper()
    return v

def _rows(cursor: Any) -> list[dict[str, Any]]:
    cols = [c[0] for c in cursor.description] if cursor.description else []
    return [{col: _sanitize(val) for col, val in zip(cols, row)} for row in cursor.fetchall()]

def _hex_to_bytes(query_hash: str) -> bytes:
    return bytes.fromhex(query_hash.lstrip("0x").lstrip("0X"))


class DiagnosticCapture:

    def capture(self, finding: Finding, topic: MonitorTopic) -> bool:
        """Capture full snapshot. Returns True nếu >= 1 tool OK. KHÔNG raise exception."""
        if not topic.capture_tools:
            return False

        start = time.monotonic()
        tool_ids: set[str] = set(topic.capture_tools)
        all_results: dict[str, dict[str, Any]] = {}

        try:
            all_results.update(self._run_phase1_parallel(tool_ids, finding))
            phase2, affected_tables = self._run_phase2_static(tool_ids, finding)
            all_results.update(phase2)
            all_results.update(self._run_phase3_table_specific(tool_ids, finding, affected_tables))
            all_results.update(self._run_phase4_mongo(tool_ids, finding, affected_tables))

            tools_captured = [n for n, r in all_results.items() if r.get("status") == "ok"]
            tools_failed   = [n for n, r in all_results.items() if r.get("status") not in ("ok", "skipped", "empty")]
            capture_ms = (time.monotonic() - start) * 1000

            self._save(finding, topic, all_results, tools_captured, tools_failed, capture_ms)
            logger.info("DiagnosticCapture: finding=%s captured=%d failed=%d ms=%.0f",
                        finding.finding_id, len(tools_captured), len(tools_failed), capture_ms)
            return bool(tools_captured)

        except Exception:
            logger.exception("DiagnosticCapture unexpected error finding=%s", finding.finding_id)
            return False

    # --- Phase 1 ---

    def _run_phase1_parallel(self, tool_ids: set[str], finding: Finding) -> dict[str, dict[str, Any]]:
        results: dict[str, dict[str, Any]] = {}
        tasks: dict[str, CaptureToolDef] = {}

        for tid in tool_ids:
            defn = CaptureToolLoader.get(tid)
            if defn is None or defn.execution_type != ExecutionType.SQL or defn.phase != 1 or defn.params.needs_table_name:
                continue
            if defn.params.needs_query_hash and not finding.query_hash:
                results[tid] = {"status": "skipped", "rows": [], "row_count": 0, "reason": "query_hash is None"}
                continue
            tasks[tid] = defn

        if not tasks:
            return results

        futures: dict[Any, str] = {}
        with ThreadPoolExecutor(max_workers=len(tasks), thread_name_prefix="dc_p1") as pool:
            for tid, defn in tasks.items():
                extra = (finding.query_hash,) if defn.params.needs_query_hash else ()
                futures[pool.submit(self._run_one_sql, tid, defn, extra, finding.node)] = tid

            deadline = time.monotonic() + PHASE1_BUDGET_SEC
            for future, tid in list(futures.items()):
                remaining = max(0.1, deadline - time.monotonic())
                try:
                    results[tid] = future.result(timeout=remaining)
                except FuturesTimeout:
                    future.cancel()
                    results[tid] = {"status": "timeout", "rows": [], "row_count": 0,
                                    "duration_ms": PHASE1_BUDGET_SEC * 1000}
                    logger.warning("Phase1 budget timeout: tool=%s finding=%s", tid, finding.finding_id)
                except Exception as exc:
                    results[tid] = {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}
        return results

    # --- Phase 2 ---

    def _run_phase2_static(self, tool_ids: set[str], finding: Finding) -> tuple[dict, list[str]]:
        results: dict[str, dict[str, Any]] = {}
        tables_plan, tables_query = [], []

        static_ids = {tid for tid in tool_ids
                      if (d := CaptureToolLoader.get(tid)) and d.execution_type == ExecutionType.STATIC}

        if "get_plan_analysis" in static_ids:
            plan_xml = (finding.metrics or {}).get("query_plan_xml") or ""
            if plan_xml:
                t = time.monotonic()
                try:
                    parsed = analyze_plan(plan_xml)
                    tables_plan = [op["table"].split(".")[-1] for op in parsed.get("top_operators", []) if op.get("table")]
                    results["get_plan_analysis"] = {"status": "ok", "rows": [parsed], "row_count": 1,
                                                    "duration_ms": round((time.monotonic() - t) * 1000, 1)}
                except Exception as exc:
                    results["get_plan_analysis"] = {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}
            else:
                results["get_plan_analysis"] = {"status": "skipped", "rows": [], "row_count": 0, "reason": "no query_plan_xml"}

        if "get_query_structure" in static_ids:
            query_text = finding.query_text or ""
            if query_text:
                t = time.monotonic()
                try:
                    parsed = analyze_query(query_text)
                    tables_query = [tbl["name"] for tbl in parsed.get("tables", []) if tbl.get("name")]
                    results["get_query_structure"] = {"status": "ok", "rows": [parsed], "row_count": 1,
                                                      "duration_ms": round((time.monotonic() - t) * 1000, 1)}
                except Exception as exc:
                    results["get_query_structure"] = {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}
            else:
                results["get_query_structure"] = {"status": "skipped", "rows": [], "row_count": 0, "reason": "no query_text"}

        seen: set[str] = set()
        affected_tables: list[str] = []
        for tbl in tables_plan + tables_query:
            clean = tbl.strip().strip("[]")
            if clean and clean.lower() not in seen:
                seen.add(clean.lower()); affected_tables.append(clean)
                if len(affected_tables) >= 5: break

        return results, affected_tables

    # --- Phase 3 ---

    def _run_phase3_table_specific(self, tool_ids: set[str], finding: Finding, affected_tables: list[str]) -> dict:
        results: dict[str, dict[str, Any]] = {}
        if not affected_tables:
            return results

        tables = affected_tables[:MAX_TABLE_TOOLS]
        for tid in tool_ids:
            defn = CaptureToolLoader.get(tid)
            if defn is None or not defn.params.needs_table_name:
                continue
            combined: list[dict[str, Any]] = []
            any_ok, last_err = False, None
            for table_name in tables:
                try:
                    r = self._run_one_sql(tid, defn, (table_name,), finding.node)
                    if r["status"] == "ok": combined.extend(r["rows"]); any_ok = True
                    else: last_err = r.get("error") or r.get("status")
                except Exception as exc: last_err = str(exc)

            results[tid] = ({"status": "ok", "rows": combined, "row_count": len(combined), "tables_queried": tables}
                            if any_ok else {"status": "error", "rows": [], "row_count": 0,
                                           "error": last_err or "all tables failed"})
        return results

    # --- Phase 4 ---

    def _run_phase4_mongo(self, tool_ids: set[str], finding: Finding, affected_tables: list[str]) -> dict:
        results: dict[str, dict[str, Any]] = {}
        db = MongoConnection.get_db()

        mongo_ids = {tid for tid in tool_ids
                     if (d := CaptureToolLoader.get(tid)) and d.execution_type == ExecutionType.MONGO}

        if "get_table_context" in mongo_ids:
            try:
                db_ctx = db["db_context"].find_one({"context_id": "main"}, {"business_context": 1, "_id": 0})
                if db_ctx and affected_tables:
                    ctx_str = str(db_ctx.get("business_context", ""))
                    matched = [{"table_name": t, "found_in_context": t.lower() in ctx_str.lower()} for t in affected_tables[:3]]
                    results["get_table_context"] = {"status": "ok", "rows": matched, "row_count": len(matched), "duration_ms": 0}
                else:
                    results["get_table_context"] = {"status": "skipped", "rows": [], "row_count": 0, "reason": "no db_context or no tables"}
            except Exception as exc:
                results["get_table_context"] = {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}

        if "get_recent_findings" in mongo_ids:
            try:
                since = now_vn() - timedelta(hours=24)
                docs = list(db["findings"].find(
                    {"detected_at": {"$gte": since}, "node": finding.node, "issue_type": str(finding.issue_type)},
                    projection={"_id": 0, "finding_id": 1, "severity": 1, "detected_at": 1, "status": 1},
                    sort=[("detected_at", -1)], limit=10))
                for doc in docs:
                    if isinstance(doc.get("detected_at"), datetime): doc["detected_at"] = doc["detected_at"].isoformat()
                results["get_recent_findings"] = {"status": "ok", "rows": docs, "row_count": len(docs), "duration_ms": 0}
            except Exception as exc:
                results["get_recent_findings"] = {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}

        if "get_analysis_history" in mongo_ids:
            try:
                insights = list(db["issue_insights"].find(
                    {"issue_type": str(finding.issue_type), "node": finding.node},
                    projection={"_id": 0, "issue_type": 1, "root_cause_summary": 1, "recurrence_count": 1, "updated_at": 1},
                    sort=[("recurrence_count", -1)], limit=5))
                for doc in insights:
                    if isinstance(doc.get("updated_at"), datetime): doc["updated_at"] = doc["updated_at"].isoformat()
                results["get_analysis_history"] = {"status": "ok", "rows": insights, "row_count": len(insights), "duration_ms": 0}
            except Exception as exc:
                results["get_analysis_history"] = {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}

        return results

    # --- SQL helper ---

    def _run_one_sql(self, tool_id: str, defn: CaptureToolDef, extra_params: tuple, node: str) -> dict[str, Any]:
        start = time.monotonic()
        try:
            if defn.params.is_multi_query:
                return self._run_multi_query(defn, node, start)

            if defn.params.needs_query_hash and extra_params:
                params: tuple = (_hex_to_bytes(extra_params[0]),)
            elif defn.params.needs_table_name and extra_params:
                params = (extra_params[0],)
            else:
                params = ()

            sql = (defn.sql or "").strip()
            with mssql_connection(node, timeout_sec=defn.timeout_sec) as conn:
                rows = _rows(conn.execute(sql, params))

            duration_ms = round((time.monotonic() - start) * 1000, 1)
            return {"status": "ok" if rows else "empty", "rows": rows, "row_count": len(rows), "duration_ms": duration_ms}

        except pyodbc.Error as exc:
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            logger.warning("DiagnosticCapture SQL error: tool=%s node=%s: %s", tool_id, node, exc)
            return {"status": "error", "rows": [], "row_count": 0, "duration_ms": duration_ms, "error": str(exc)}

    def _run_multi_query(self, defn: CaptureToolDef, node: str, start: float) -> dict[str, Any]:
        sql_parts = defn.sql_parts or {}
        try:
            with mssql_connection(node, timeout_sec=defn.timeout_sec) as conn:
                part_results = {key: _rows(conn.execute(sql, ())) for key, sql in sql_parts.items()}
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            return {"status": "ok", "rows": [part_results], "row_count": 1, "duration_ms": duration_ms}
        except pyodbc.Error as exc:
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            return {"status": "error", "rows": [], "row_count": 0, "duration_ms": duration_ms, "error": str(exc)}

    def _save(self, finding: Finding, topic: MonitorTopic,
              results: dict, tools_captured: list[str], tools_failed: list[str],
              capture_duration_ms: float) -> None:
        MongoConnection.get_db()["finding_diagnostics"].insert_one({
            "finding_id": finding.finding_id,
            "topic_id": topic.topic_id,
            "node": finding.node,
            "captured_at": now_vn(),
            "capture_duration_ms": round(capture_duration_ms, 0),
            "tools_requested": list(topic.capture_tools),
            "tools_captured": tools_captured,
            "tools_failed": tools_failed,
            "results": results,
            "capture_error": None,
        })
```

---

### 10. `layer1/executor/topic_runner.py`

**Import thêm:**
```python
from ..capture.diagnostic_capture import DiagnosticCapture
```

**`__init__` — thêm param cuối:**
```python
diagnostic_capture: DiagnosticCapture | None = None
# ...
self._diagnostic_capture = diagnostic_capture
```

**`run()` — pass topic vào `_process_findings()`:**
```python
return self._process_findings(findings, topic)
```

**`_process_findings()` — thêm capture block:**
```python
def _process_findings(self, findings: list[Finding], topic: MonitorTopic | None = None) -> int:
    count = 0
    for finding in findings:
        finding.finding_hash = finding.compute_finding_hash()
        alert_status, alert_error = self._compute_alert_state(finding)
        finding.alert_status = alert_status
        finding.alert_error = alert_error
        if alert_status == "sent":
            finding.alert_sent_at = now_vn()

        if (finding.severity == Severity.CRITICAL
                and self._diagnostic_capture is not None
                and topic is not None
                and topic.capture_tools):
            try:
                finding.has_diagnostics = self._diagnostic_capture.capture(finding, topic)
            except Exception:
                logger.error("DiagnosticCapture catch: finding=%s topic=%s",
                             finding.finding_id, getattr(topic, "topic_id", "?"), exc_info=True)

        self._findings_repo.insert(finding)
        count += 1
    return count
```

> **Note:** Capture chỉ trigger khi `severity == CRITICAL` — không phụ thuộc `alert_status`. Lý do: severity là property của finding (compute trước), `alert_status` phụ thuộc dedup state. CRITICAL findings luôn đáng capture dù có bị suppressed hay không.

---

### 11. `layer1/scheduler.py`

**Import thêm:**
```python
from .capture.capture_tool_loader import CaptureToolLoader
from .capture.diagnostic_capture import DiagnosticCapture
```

**Startup sequence — sau `create_all_indexes()`:**
```python
CaptureToolLoader.load_all()    # fail fast nếu chưa seed

diagnostic_capture = DiagnosticCapture()

self._topic_runner = TopicRunner(
    # ... existing params ...
    diagnostic_capture=diagnostic_capture,
)
```

---

### 12. `layer1/seed/seed_capture_tools.py` (NEW)

Seed 18 tool definitions. Entry point: `python -m layer1.seed.seed_capture_tools`.

**Danh sách tools cần seed:**

| tool_id | execution_type | phase | needs_query_hash | needs_table_name | is_multi_query |
|---|---|---|---|---|---|
| `get_blocking_chain` | `sql` | 1 | No | No | No |
| `get_wait_stats` | `sql` | 1 | No | No | No |
| `get_memory_grant` | `sql` | 1 | No | No | No |
| `get_tempdb_usage` | `sql` | 1 | No | No | No |
| `get_ag_status` | `sql` | 1 | No | No | No |
| `get_memory_pressure` | `sql` | 1 | No | No | **Yes** |
| `get_resource_governor_stats` | `sql` | 1 | No | No | No |
| `get_cdc_status` | `sql` | 1 | No | No | No |
| `get_missing_indexes` | `sql` | 1 | No | No | No |
| `get_query_stats` | `sql` | 1 | **Yes** | No | No |
| `get_query_store_history` | `sql` | 1 | **Yes** | No | No |
| `get_index_usage` | `sql` | 3 | No | **Yes** | No |
| `get_statistics_info` | `sql` | 3 | No | **Yes** | No |
| `get_plan_analysis` | `static` | 2 | No | No | No |
| `get_query_structure` | `static` | 2 | No | No | No |
| `get_table_context` | `mongo` | 4 | No | No | No |
| `get_recent_findings` | `mongo` | 4 | No | No | No |
| `get_analysis_history` | `mongo` | 4 | No | No | No |

**Upsert pattern:**
```python
def seed_capture_tools() -> None:
    col = MongoConnection.get_db()["capture_tool_defs"]
    tools = [_get_blocking_chain(), _get_wait_stats(), ...]
    for tool in tools:
        col.update_one({"tool_id": tool["tool_id"]}, {"$set": tool}, upsert=True)
    print(f"Seeded {len(tools)} capture tool definitions.")
```

**Mỗi tool cần đủ các fields:** `tool_id`, `sql`/`sql_parts`, `params`, `phase`, `timeout_sec`, `enabled`, `ai_hints` (key_columns, max_rows_for_ai, interpret_as, thresholds).

---

### 13. `layer1/seed/seed_topics.py` (Phase 5)

Cập nhật sau khi verify production — thêm `capture_tools` per topic vào seed data.

---

## Edge Cases

| Case | Behavior |
|---|---|
| `topic.capture_tools == []` | `capture()` return `False` ngay — no-op |
| `CaptureToolLoader` chưa `load_all()` | `load_all()` fail fast tại startup với `RuntimeError` |
| `tool_id` không có trong loader | Skip tool đó, log warning |
| `alert_status == "suppressed"` | Skip capture — finding đã alert gần đây |
| MSSQL node unreachable (Phase 1) | Tool status = `"error"`, tools khác vẫn chạy |
| Phase 1 budget (15s) exceeded | Timeout futures bị cancel, status = `"timeout"` |
| Phase 2 no plan XML | `get_plan_analysis` = `"skipped"`, Phase 3 skip nếu không có tables |
| `is_multi_query=True` | Dispatch sang `_run_multi_query()` — dùng `sql_parts` dict |
| `query_hash` có prefix `0x` | `_hex_to_bytes()` strip trước `bytes.fromhex()` |
| `needs_query_hash` + `query_hash=None` | Tool status = `"skipped"` với reason |

---

## Phased Rollout

**Phase 1 — Deploy code (zero behavioral change)**
- Deploy Layer 1 với `capture_tools=[]` default
- Không update seed topics → mọi thứ hoạt động như cũ

**Phase 2 — Enable `blocking` topic (đơn giản nhất)**
```javascript
db.monitor_topics.updateOne(
  {topic_id: "blocking"},
  {$set: {capture_tools: ["get_blocking_chain", "get_wait_stats", "get_recent_findings"]}}
)
```
Monitor 24h: check job duration, check `finding_diagnostics` grows.

**Phase 3 — Enable `slow_sessions`** (test Phase 2+3+4 đầy đủ)

**Phase 4 — All remaining volatile topics**

**Phase 5 — Update seed_topics.py**

---

## Verification

```bash
# Seed trước khi start
python -m layer1.seed.seed_capture_tools

# Verify 18 tool defs
mongo db_monitor --eval "db.capture_tool_defs.find({},{tool_id:1,phase:1,enabled:1,_id:0}).toArray()"
```

```javascript
// Verify ai_hints có đủ fields cho Layer 2
db.capture_tool_defs.findOne({tool_id: "get_wait_stats"}, {ai_hints: 1, _id: 0})

// Enable blocking để test
db.monitor_topics.updateOne(
  {topic_id: "blocking"},
  {$set: {capture_tools: ["get_blocking_chain", "get_wait_stats", "get_recent_findings"]}}
)

// Verify capture worked
db.findings.findOne({"has_diagnostics": true}, {"finding_id":1, "topic_id":1, "detected_at":1})

// Inspect snapshot
db.finding_diagnostics.findOne(
  {"topic_id": "blocking"},
  {"tools_captured":1, "tools_failed":1, "capture_duration_ms":1}
)

// Capture failure rate by tool
db.finding_diagnostics.aggregate([
  {$unwind: "$tools_failed"},
  {$group: {_id: {topic:"$topic_id", tool:"$tools_failed"}, count:{$sum:1}}},
  {$sort: {count:-1}}
])
```

**Rollback:**
```javascript
db.monitor_topics.updateMany({}, {$set: {capture_tools: []}})
// has_diagnostics sẽ = false → Layer 2 fallback to agentic loop
```
