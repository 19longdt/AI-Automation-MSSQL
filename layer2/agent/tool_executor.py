"""
tool_executor.py - Dispatch Claude tool calls to DiagnosticExecutor with safety checks.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from ..executor.diagnostic_executor import DiagnosticExecutor
from ..executor.node_role_cache import NodeRoleCache
from ..utils.peak_hours import is_peak_hours
from .tool_registry import TOOL_REGISTRY

logger = logging.getLogger(__name__)

MAX_TOOL_RESULT_ROWS = 20
MAX_TOOL_RESULT_CHARS = 5000


class ToolExecutor:
    """Dispatch Claude tool calls with validation and lightweight truncation."""

    def __init__(
        self,
        node_role_cache: NodeRoleCache,
        peak_hours_start: int = 8,
        peak_hours_end: int = 18,
    ) -> None:
        self._node_role_cache = node_role_cache
        self._peak_start = peak_hours_start
        self._peak_end = peak_hours_end
        self._executor = DiagnosticExecutor()

    def execute(self, tool_name: str, tool_input: dict[str, Any]) -> Any:
        start = time.monotonic()
        logger.debug(
            "Tool execute start tool=%s input_keys=%s",
            tool_name,
            sorted(tool_input.keys()),
        )

        tool_def = TOOL_REGISTRY.get(tool_name)
        if tool_def is None:
            logger.warning("Tool '%s' not in whitelist — input=%s", tool_name, tool_input)
            return {"error": f"Tool '{tool_name}' khong duoc phep."}

        node = tool_input.get("node", "")
        if node and not self._node_role_cache.is_valid_node(node):
            valid_nodes = self._node_role_cache.get_all_hosts()
            logger.warning(
                "Tool '%s' rejected: node='%s' not in cluster. Valid nodes: %s",
                tool_name, node, valid_nodes,
            )
            return {
                "error": (
                    f"Node '{node}' khong thuoc AG cluster. "
                    f"Dung mot trong: {valid_nodes}"
                )
            }

        if tool_def.block_in_peak_hours and is_peak_hours(self._peak_start, self._peak_end):
            logger.info("Tool '%s' blocked in peak hours", tool_name)
            return {
                "error": (
                    f"Tool '{tool_name}' khong kha dung trong gio cao diem "
                    f"({self._peak_start}:00-{self._peak_end}:00 VN)."
                )
            }

        try:
            result = self._dispatch(tool_name, tool_input)
            result = self._truncate_result(result, tool_name)
            duration_ms = (time.monotonic() - start) * 1000
            logger.debug(
                "Tool '%s' OK: node=%s duration_ms=%.1f result_type=%s",
                tool_name,
                node,
                duration_ms,
                type(result).__name__,
            )
            return result
        except Exception as exc:
            duration_ms = (time.monotonic() - start) * 1000
            logger.error(
                "Tool '%s' failed: node=%s duration_ms=%.1f error=%s",
                tool_name, node, duration_ms, exc,
            )
            return {"error": f"Tool '{tool_name}' that bai: {exc}"}

    def _truncate_result(self, result: Any, tool_name: str) -> Any:
        """Keep tool payloads compact before they are fed back into the model."""
        if isinstance(result, list) and len(result) > MAX_TOOL_RESULT_ROWS:
            total = len(result)
            logger.debug(
                "Tool '%s' row truncation total_rows=%d shown_rows=%d",
                tool_name,
                total,
                MAX_TOOL_RESULT_ROWS,
            )
            result = list(result[:MAX_TOOL_RESULT_ROWS])
            result.append(
                {
                    "_truncated": True,
                    "_tool": tool_name,
                    "_total_rows": total,
                    "_shown_rows": MAX_TOOL_RESULT_ROWS,
                }
            )

        serialized = self.serialize_result(result)
        if len(serialized) <= MAX_TOOL_RESULT_CHARS:
            return result

        logger.debug(
            "Tool '%s' char truncation total_chars=%d shown_chars=%d",
            tool_name,
            len(serialized),
            MAX_TOOL_RESULT_CHARS,
        )
        truncated_text = serialized[:MAX_TOOL_RESULT_CHARS].rstrip()
        return {
            "_truncated": True,
            "_tool": tool_name,
            "_reason": "char_limit",
            "_shown_chars": MAX_TOOL_RESULT_CHARS,
            "_preview": truncated_text,
        }

    def _dispatch(self, tool_name: str, inp: dict[str, Any]) -> Any:
        ex = self._executor

        if tool_name == "get_plan_analysis":
            return ex.get_plan_analysis(finding_id=inp["finding_id"])
        if tool_name == "get_query_structure":
            return ex.get_query_structure(finding_id=inp["finding_id"])
        if tool_name == "get_table_context":
            return ex.get_table_context(table_name=inp["table_name"])
        if tool_name == "get_analysis_history":
            return ex.get_analysis_history(
                finding_id=inp["finding_id"],
                issue_type=inp.get("issue_type"),
                node=inp.get("node"),
            )
        if tool_name == "get_query_stats":
            return ex.get_query_stats(node=inp["node"], query_hash=inp["query_hash"], top_n=inp.get("top_n", 10))
        if tool_name == "get_query_store_history":
            return ex.get_query_store_history(
                node=inp["node"],
                query_hash=inp["query_hash"],
                days_back=inp.get("days_back", 7),
                top_n=inp.get("top_n", 20),
            )
        if tool_name == "get_statistics_info":
            return ex.get_statistics_info(node=inp["node"], table_name=inp["table_name"], top_n=inp.get("top_n", 50))
        if tool_name == "get_memory_grant":
            return ex.get_memory_grant(node=inp["node"], top_n=inp.get("top_n", 20))
        if tool_name == "get_blocking_chain":
            return ex.get_blocking_chain(node=inp["node"], top_n=inp.get("top_n", 30))
        if tool_name == "get_wait_stats":
            return ex.get_wait_stats(node=inp["node"], top_n=inp.get("top_n", 20))
        if tool_name == "get_index_usage":
            return ex.get_index_usage(node=inp["node"], table_name=inp["table_name"], top_n=inp.get("top_n", 50))
        if tool_name == "get_missing_indexes":
            return ex.get_missing_indexes(node=inp["node"], table_name=inp.get("table_name"), top_n=inp.get("top_n", 20))
        if tool_name == "get_tempdb_usage":
            return ex.get_tempdb_usage(node=inp["node"], top_n=inp.get("top_n", 20))
        if tool_name == "get_ag_status":
            return ex.get_ag_status(node=inp["node"])
        if tool_name == "get_memory_pressure":
            return ex.get_memory_pressure(node=inp["node"])
        if tool_name == "get_resource_governor_stats":
            return ex.get_resource_governor_stats(node=inp["node"])
        if tool_name == "get_cdc_status":
            return ex.get_cdc_status(node=inp["node"], top_n=inp.get("top_n", 10))
        if tool_name == "get_recent_findings":
            return ex.get_recent_findings(
                node=inp.get("node"),
                issue_type=inp.get("issue_type"),
                hours_back=inp.get("hours_back", 24),
                limit=inp.get("limit", 10),
            )
        if tool_name == "get_index_fragmentation":
            return ex.get_index_fragmentation(node=inp["node"], table_name=inp["table_name"], top_n=inp.get("top_n", 30))

        raise ValueError(f"Unhandled tool: {tool_name}")

    @staticmethod
    def serialize_result(result: Any) -> str:
        try:
            return json.dumps(result, ensure_ascii=False, indent=None, default=str)
        except (TypeError, ValueError):
            return str(result)
