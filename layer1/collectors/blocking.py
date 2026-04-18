"""
blocking.py — Phát hiện blocking chain structure và deadlock (check 1.1.7).

Khác với blocked_queries.py (lấy query-level detail của session bị block),
collector này focus vào STRUCTURE của blocking:
  - Chain depth: bao nhiêu sessions bị cascade block từ 1 head blocker
  - Deadlock: đọc từ System Health Extended Event
  - Lock escalation: table lock thay vì row/page lock

Chạy trên tất cả nodes vì blocking xảy ra độc lập trên mỗi node.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class BlockingCollector(BaseCollector):

    METRIC_BLOCKING_CHAIN = "blocking_chain"
    METRIC_DEADLOCK = "deadlock_event"
    METRIC_LOCK_ESCALATION = "lock_escalation"

    def collect_node(self, node_host: str) -> list[RawMetric]: ...

    def _collect_blocking_chains(self, node_host: str) -> list[RawMetric]:
        """
        Build blocking chain từ sys.dm_exec_requests.
        Dùng recursive CTE hoặc Python-side graph traversal để tính chain depth.
        """
        ...

    def _collect_deadlocks(self, node_host: str) -> list[RawMetric]:
        """
        Đọc deadlock events từ System Health XEvent session.
        XEvent chứa deadlock graph XML — parse để lấy involved queries.
        Chỉ lấy events chưa được ghi (dùng timestamp từ last run).
        """
        ...

    def _collect_lock_escalations(self, node_host: str) -> list[RawMetric]:
        """Detect table lock trên bảng lớn từ sys.dm_tran_locks."""
        ...
