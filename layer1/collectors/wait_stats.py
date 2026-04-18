"""
wait_stats.py — Thu thập wait statistics snapshot để detect anomaly (check 1.1.9).

Strategy: snapshot diff — lấy cumulative wait stats, trừ snapshot trước đó
để tính delta trong interval. Lưu snapshot vào MongoDB raw_metrics.

Chạy trên tất cả nodes vì wait stats độc lập per-node.
Day-of-week baseline: so sánh delta với baseline cùng ngày/giờ trong 4 tuần,
không phải rolling average — workload pattern khác nhau theo ngày.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class WaitStatsCollector(BaseCollector):

    METRIC_WAIT_SNAPSHOT = "wait_stats_snapshot"
    METRIC_WAIT_DELTA = "wait_stats_delta"

    def collect_node(self, node_host: str) -> list[RawMetric]:
        """Lấy snapshot, tính delta với snapshot trước, lưu cả 2."""
        ...

    def _fetch_current_snapshot(self, node_host: str) -> dict[str, int]:
        """Query sys.dm_os_wait_stats, exclude wait_types_ignore."""
        ...

    def _compute_delta(self, current: dict[str, int], previous: dict[str, int]) -> dict[str, int]:
        """Tính wait_time_ms delta per wait_type. Handle server restart (negative delta → 0)."""
        ...
