"""
tool_executor.py — Dispatch Claude tool calls sang DiagnosticExecutor.

Safety checks theo thứ tự:
  1. tool_name có trong TOOL_REGISTRY không?
  2. node có trong AG cluster không? (NodeRoleCache.is_valid_node)
  3. Tool có block_in_peak_hours=True và đang trong peak hours không?
  4. Dispatch → DiagnosticExecutor method tương ứng

Khi check fail hoặc exception → trả {"error": "..."}.
Claude nhận error result và tự quyết định: bỏ qua, dùng tool khác, hoặc ghi chú.
KHÔNG crash service — exception trong tool call không được propagate ra ngoài.
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


class ToolExecutor:
    """Dispatch Claude tool calls với đầy đủ safety checks."""

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
        """
        Execute 1 tool call từ Claude.

        Returns:
            Kết quả tool (list hoặc dict) nếu thành công.
            {"error": "..."} nếu check fail hoặc exception.
        """
        start = time.monotonic()

        # Check 1: tool có trong whitelist không?
        tool_def = TOOL_REGISTRY.get(tool_name)
        if tool_def is None:
            logger.warning("Tool '%s' không có trong whitelist — từ chối", tool_name)
            return {"error": f"Tool '{tool_name}' không được phép. Chỉ dùng tools trong whitelist."}

        # Check 2: node validation (nếu tool có param 'node')
        node = tool_input.get("node", "")
        if node and not self._node_role_cache.is_valid_node(node):
            logger.warning("Tool '%s' bị từ chối: node='%s' không hợp lệ", tool_name, node)
            return {"error": f"Node '{node}' không thuộc AG cluster. Dùng một trong: {self._node_role_cache.get_all_hosts()}"}

        # Check 3: peak hours block
        if tool_def.block_in_peak_hours and is_peak_hours(self._peak_start, self._peak_end):
            logger.info("Tool '%s' bị block trong peak hours (%d:00–%d:00)", tool_name, self._peak_start, self._peak_end)
            return {
                "error": (
                    f"Tool '{tool_name}' không khả dụng trong giờ cao điểm "
                    f"({self._peak_start}:00–{self._peak_end}:00 VN). "
                    "Thử lại ngoài giờ cao điểm hoặc dùng tool thay thế."
                )
            }

        # Dispatch
        try:
            result = self._dispatch(tool_name, tool_input)
            duration_ms = (time.monotonic() - start) * 1000
            logger.debug("Tool '%s' OK: node=%s duration_ms=%.1f", tool_name, node, duration_ms)
            return result
        except Exception as exc:
            duration_ms = (time.monotonic() - start) * 1000
            logger.error(
                "Tool '%s' failed: node=%s duration_ms=%.1f error=%s",
                tool_name, node, duration_ms, exc,
            )
            return {"error": f"Tool '{tool_name}' thất bại: {exc}"}

    def _dispatch(self, tool_name: str, inp: dict[str, Any]) -> Any:
        """Map tool_name → DiagnosticExecutor method call."""
        ex = self._executor

        if tool_name == "get_query_stats":
            return ex.get_query_stats(
                node=inp["node"],
                query_hash=inp["query_hash"],
                top_n=inp.get("top_n", 10),
            )

        if tool_name == "get_query_store_history":
            return ex.get_query_store_history(
                node=inp["node"],
                query_hash=inp["query_hash"],
                days_back=inp.get("days_back", 7),
                top_n=inp.get("top_n", 20),
            )

        if tool_name == "get_statistics_info":
            return ex.get_statistics_info(
                node=inp["node"],
                table_name=inp["table_name"],
                top_n=inp.get("top_n", 50),
            )

        if tool_name == "get_memory_grant":
            return ex.get_memory_grant(
                node=inp["node"],
                top_n=inp.get("top_n", 20),
            )

        if tool_name == "get_blocking_chain":
            return ex.get_blocking_chain(
                node=inp["node"],
                top_n=inp.get("top_n", 30),
            )

        if tool_name == "get_wait_stats":
            return ex.get_wait_stats(
                node=inp["node"],
                top_n=inp.get("top_n", 20),
            )

        if tool_name == "get_index_usage":
            return ex.get_index_usage(
                node=inp["node"],
                table_name=inp["table_name"],
                top_n=inp.get("top_n", 50),
            )

        if tool_name == "get_missing_indexes":
            return ex.get_missing_indexes(
                node=inp["node"],
                table_name=inp.get("table_name"),
                top_n=inp.get("top_n", 20),
            )

        if tool_name == "get_tempdb_usage":
            return ex.get_tempdb_usage(
                node=inp["node"],
                top_n=inp.get("top_n", 20),
            )

        if tool_name == "get_ag_status":
            return ex.get_ag_status(node=inp["node"])

        if tool_name == "get_memory_pressure":
            return ex.get_memory_pressure(node=inp["node"])

        if tool_name == "get_resource_governor_stats":
            return ex.get_resource_governor_stats(node=inp["node"])

        if tool_name == "get_cdc_status":
            return ex.get_cdc_status(
                node=inp["node"],
                top_n=inp.get("top_n", 10),
            )

        if tool_name == "get_recent_findings":
            return ex.get_recent_findings(
                node=inp.get("node"),
                issue_type=inp.get("issue_type"),
                hours_back=inp.get("hours_back", 24),
                limit=inp.get("limit", 10),
            )

        if tool_name == "get_index_fragmentation":
            return ex.get_index_fragmentation(
                node=inp["node"],
                table_name=inp["table_name"],
                top_n=inp.get("top_n", 30),
            )

        # Không bao giờ đến đây vì đã check whitelist ở trên
        raise ValueError(f"Unhandled tool: {tool_name}")

    @staticmethod
    def serialize_result(result: Any) -> str:
        """
        Serialize tool result thành string để đưa vào Claude tool_result content.
        Dùng cho ToolCallRecord.output và Anthropic API messages.
        """
        try:
            return json.dumps(result, ensure_ascii=False, indent=None)
        except (TypeError, ValueError):
            return str(result)
