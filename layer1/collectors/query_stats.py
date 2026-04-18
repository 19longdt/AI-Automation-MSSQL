"""
query_stats.py — Thu thập từ sys.dm_exec_query_stats cho check 1.1.4, 1.1.5.

Khác với Query Store, dm_exec_query_stats reset khi SQL Server restart
và không có historical data. Nhưng cung cấp plan handle để lấy plan XML
của queries đang cache — cần thiết cho non-optimal index và partition checks.

Chạy trên tất cả nodes vì mỗi node có query cache riêng.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class QueryStatsCollector(BaseCollector):
    """Collector cho dm_exec_query_stats — non-optimal index và partition checks."""

    METRIC_HIGH_IO_QUERY = "dmv_high_io_query"

    def collect_node(self, node_host: str) -> list[RawMetric]:
        """Query TOP N queries theo avg_logical_reads kèm execution plan XML."""
        ...

    def _fetch_high_io_queries(self, node_host: str) -> list[RawMetric]:
        """
        Lấy TOP 30 queries có avg_logical_reads > high_io_threshold.
        Phải có CROSS APPLY sys.dm_exec_query_plan để lấy plan XML —
        plan XML là input bắt buộc cho plan_parser detectors.
        """
        ...
