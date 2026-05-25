"""
diagnostic_capture.py - Full diagnostic snapshot at T+0 when a finding is detected.
"""
from __future__ import annotations

import decimal
import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from datetime import datetime
from typing import Any

import pyodbc

from ..executor.mssql_connection import mssql_connection
from ..models.capture_tool import CaptureToolDef, ExecutionType
from ..models.findings import Finding
from ..models.topic import MonitorTopic
from ..storage.mongo_client import MongoConnection
from ..utils.time_utils import now_vn
from .capture_tool_loader import CaptureToolLoader
from .handlers.mongo_registry import get_handlers as get_mongo_handlers
from .handlers.static_registry import get_handlers as get_static_handlers

logger = logging.getLogger(__name__)

PHASE1_BUDGET_SEC = 15
MAX_TABLE_TOOLS = 3
STATIC_HANDLERS = get_static_handlers()
MONGO_HANDLERS = get_mongo_handlers()


def _sanitize(value: object) -> object:
    """Convert non-JSON-friendly values from SQL driver into serializable values."""
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return "0x" + value.hex().upper()
    return value


def _rows(cursor: Any) -> list[dict[str, Any]]:
    """Fetch all rows from a cursor and map them into list-of-dict records."""
    columns = [col[0] for col in cursor.description] if cursor.description else []
    return [{col: _sanitize(val) for col, val in zip(columns, row)} for row in cursor.fetchall()]


def _hex_to_bytes(query_hash: str) -> bytes:
    """Convert SQL Server query_hash text (with/without 0x prefix) to bytes."""
    return bytes.fromhex(query_hash.removeprefix("0x").removeprefix("0X"))


class DiagnosticCapture:
    """Capture and persist a full tool snapshot for one finding across 4 phases."""

    def capture(self, finding: Finding, topic: MonitorTopic) -> bool:
        """Run all capture phases and save one snapshot document. Never raises."""
        if not topic.capture_tools:
            return False

        start = time.monotonic()
        tool_ids: set[str] = set(topic.capture_tools)
        all_results: dict[str, dict[str, Any]] = {}

        try:
            all_results.update(self._run_phase1_parallel(tool_ids, finding))
            phase2_results, affected_tables = self._run_phase2_static(tool_ids, finding)
            all_results.update(phase2_results)
            all_results.update(self._run_phase3_table_specific(tool_ids, finding, affected_tables))
            all_results.update(self._run_phase4_mongo(tool_ids, finding, affected_tables))

            tools_captured = [name for name, r in all_results.items() if r.get("status") == "ok"]
            tools_failed = [
                name
                for name, r in all_results.items()
                if r.get("status") not in ("ok", "skipped", "empty")
            ]
            capture_duration_ms = (time.monotonic() - start) * 1000

            self._save(
                finding=finding,
                topic=topic,
                results=all_results,
                tools_captured=tools_captured,
                tools_failed=tools_failed,
                capture_duration_ms=capture_duration_ms,
            )
            logger.info(
                "DiagnosticCapture finding=%s captured=%d failed=%d ms=%.0f",
                finding.finding_id,
                len(tools_captured),
                len(tools_failed),
                capture_duration_ms,
            )
            return bool(tools_captured)
        except Exception:
            logger.exception("DiagnosticCapture unexpected error finding=%s", finding.finding_id)
            return False

    def _run_phase1_parallel(self, tool_ids: set[str], finding: Finding) -> dict[str, dict[str, Any]]:
        """Run phase-1 SQL tools in parallel under a global time budget."""
        results: dict[str, dict[str, Any]] = {}
        tasks: dict[str, CaptureToolDef] = {}

        # query_hash ưu tiên từ finding field, fallback sang metrics dict
        effective_query_hash: str | None = finding.query_hash or finding.metrics.get("query_hash")

        for tool_id in tool_ids:
            definition = CaptureToolLoader.get(tool_id)
            if definition is None:
                logger.warning("CaptureToolLoader missing tool_id=%s", tool_id)
                continue
            if definition.execution_type != ExecutionType.SQL or definition.phase != 1:
                continue
            if definition.params.needs_table_name:
                continue
            if definition.params.needs_query_hash and not effective_query_hash:
                results[tool_id] = {
                    "status": "skipped",
                    "rows": [],
                    "row_count": 0,
                    "reason": "query_hash is None",
                }
                continue
            if definition.params.needs_query_hash:
                try:
                    _hex_to_bytes(effective_query_hash)  # type: ignore[arg-type]
                except ValueError:
                    results[tool_id] = {
                        "status": "skipped",
                        "rows": [],
                        "row_count": 0,
                        "reason": f"query_hash not valid hex: {str(effective_query_hash)[:30]}",
                    }
                    logger.warning(
                        "Phase1 skipping tool=%s: query_hash is not valid hex (finding=%s)",
                        tool_id, finding.finding_id,
                    )
                    continue
            tasks[tool_id] = definition

        if not tasks:
            return results

        futures: dict[Any, str] = {}
        with ThreadPoolExecutor(max_workers=len(tasks), thread_name_prefix="dc_p1") as pool:
            for tool_id, definition in tasks.items():
                extra = (effective_query_hash,) if definition.params.needs_query_hash else ()
                futures[pool.submit(self._run_one_sql, tool_id, definition, extra, finding.node)] = tool_id

            deadline = time.monotonic() + PHASE1_BUDGET_SEC
            for future, tool_id in list(futures.items()):
                remaining = max(0.1, deadline - time.monotonic())
                try:
                    results[tool_id] = future.result(timeout=remaining)
                except FuturesTimeout:
                    future.cancel()
                    results[tool_id] = {
                        "status": "timeout",
                        "rows": [],
                        "row_count": 0,
                        "duration_ms": PHASE1_BUDGET_SEC * 1000,
                    }
                    logger.warning("Phase1 budget timeout tool=%s finding=%s", tool_id, finding.finding_id)
                except Exception as exc:
                    results[tool_id] = {
                        "status": "error",
                        "rows": [],
                        "row_count": 0,
                        "error": str(exc),
                    }
        return results

    def _run_phase2_static(self, tool_ids: set[str], finding: Finding) -> tuple[dict[str, dict[str, Any]], list[str]]:
        """Run static analyzers and extract affected tables for phase 3."""
        results: dict[str, dict[str, Any]] = {}
        extracted_tables: list[str] = []

        static_tool_ids = {
            tool_id
            for tool_id in tool_ids
            if (definition := CaptureToolLoader.get(tool_id))
            and definition.execution_type == ExecutionType.STATIC
        }

        for tool_id in sorted(static_tool_ids):
            result, tables = self._run_one_static_tool(tool_id, finding)
            results[tool_id] = result
            extracted_tables.extend(tables)

        # Keep unique table names and cap to avoid exploding phase-3 SQL calls.
        seen: set[str] = set()
        affected_tables: list[str] = []
        for table_name in extracted_tables:
            clean_name = table_name.strip().strip("[]")
            if clean_name and clean_name.lower() not in seen:
                seen.add(clean_name.lower())
                affected_tables.append(clean_name)
                if len(affected_tables) >= 5:
                    break

        return results, affected_tables

    def _run_phase3_table_specific(
        self,
        tool_ids: set[str],
        finding: Finding,
        affected_tables: list[str],
    ) -> dict[str, dict[str, Any]]:
        """Run SQL tools that require table_name, based on phase-2 extracted tables."""
        results: dict[str, dict[str, Any]] = {}
        if not affected_tables:
            return results

        tables = affected_tables[:MAX_TABLE_TOOLS]
        for tool_id in tool_ids:
            definition = CaptureToolLoader.get(tool_id)
            if definition is None:
                logger.warning("CaptureToolLoader missing tool_id=%s", tool_id)
                continue
            if definition.execution_type != ExecutionType.SQL or not definition.params.needs_table_name:
                continue

            combined_rows: list[dict[str, Any]] = []
            any_ok = False
            last_error: str | None = None
            for table_name in tables:
                try:
                    result = self._run_one_sql(tool_id, definition, (table_name,), finding.node)
                    if result["status"] == "ok":
                        combined_rows.extend(result["rows"])
                        any_ok = True
                    else:
                        last_error = result.get("error") or result.get("status")
                except Exception as exc:
                    last_error = str(exc)

            if any_ok:
                results[tool_id] = {
                    "status": "ok",
                    "rows": combined_rows,
                    "row_count": len(combined_rows),
                    "tables_queried": tables,
                }
            else:
                results[tool_id] = {
                    "status": "error",
                    "rows": [],
                    "row_count": 0,
                    "error": last_error or "all tables failed",
                }
        return results

    def _run_phase4_mongo(
        self,
        tool_ids: set[str],
        finding: Finding,
        affected_tables: list[str],
    ) -> dict[str, dict[str, Any]]:
        """Run mongo-backed context tools to make snapshot self-contained."""
        results: dict[str, dict[str, Any]] = {}

        mongo_tool_ids = {
            tool_id
            for tool_id in tool_ids
            if (definition := CaptureToolLoader.get(tool_id))
            and definition.execution_type == ExecutionType.MONGO
        }

        for tool_id in sorted(mongo_tool_ids):
            results[tool_id] = self._run_one_mongo_tool(tool_id, finding, affected_tables)

        return results

    def _run_one_static_tool(self, tool_id: str, finding: Finding) -> tuple[dict[str, Any], list[str]]:
        """Dispatch one static tool by tool_id and return (result, extracted_tables)."""
        handler = STATIC_HANDLERS.get(tool_id)
        if handler is None:
            return (
                {"status": "skipped", "rows": [], "row_count": 0, "reason": f"no static handler for {tool_id}"},
                [],
            )
        return handler(finding)

    def _run_one_mongo_tool(
        self,
        tool_id: str,
        finding: Finding,
        affected_tables: list[str],
    ) -> dict[str, Any]:
        """Dispatch one mongo tool by tool_id."""
        handler = MONGO_HANDLERS.get(tool_id)
        if handler is None:
            return {"status": "skipped", "rows": [], "row_count": 0, "reason": f"no mongo handler for {tool_id}"}
        return handler(finding, affected_tables)

    def _run_one_sql(
        self,
        tool_id: str,
        definition: CaptureToolDef,
        extra_params: tuple[Any, ...],
        node: str,
    ) -> dict[str, Any]:
        """Execute one SQL tool with timeout and normalized output schema."""
        start = time.monotonic()
        try:
            if definition.params.is_multi_query:
                return self._run_multi_query(definition, node, start)

            if definition.params.needs_query_hash and extra_params:
                params: tuple[Any, ...] = (_hex_to_bytes(str(extra_params[0])),)
            elif definition.params.needs_table_name and extra_params:
                params = (extra_params[0],)
            else:
                params = ()

            sql = (definition.sql or "").strip()
            with mssql_connection(node, timeout_sec=definition.timeout_sec) as connection:
                result_rows = _rows(connection.execute(sql, params))

            duration_ms = round((time.monotonic() - start) * 1000, 1)
            return {
                "status": "ok" if result_rows else "empty",
                "rows": result_rows,
                "row_count": len(result_rows),
                "duration_ms": duration_ms,
            }
        except pyodbc.Error as exc:
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            logger.warning("DiagnosticCapture SQL error tool=%s node=%s: %s", tool_id, node, exc)
            return {
                "status": "error",
                "rows": [],
                "row_count": 0,
                "duration_ms": duration_ms,
                "error": str(exc),
            }

    def _run_multi_query(self, definition: CaptureToolDef, node: str, start: float) -> dict[str, Any]:
        """Execute all sql_parts in one connection and return combined part results."""
        sql_parts = definition.sql_parts or {}
        try:
            with mssql_connection(node, timeout_sec=definition.timeout_sec) as connection:
                part_results = {key: _rows(connection.execute(sql, ())) for key, sql in sql_parts.items()}
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            return {"status": "ok", "rows": [part_results], "row_count": 1, "duration_ms": duration_ms}
        except pyodbc.Error as exc:
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            return {
                "status": "error",
                "rows": [],
                "row_count": 0,
                "duration_ms": duration_ms,
                "error": str(exc),
            }

    def _save(
        self,
        finding: Finding,
        topic: MonitorTopic,
        results: dict[str, dict[str, Any]],
        tools_captured: list[str],
        tools_failed: list[str],
        capture_duration_ms: float,
    ) -> None:
        """Persist one snapshot document into finding_diagnostics collection."""
        MongoConnection.get_db()["finding_diagnostics"].insert_one(
            {
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
            }
        )
