"""
blocked_queries.py — Thu thập query-level detail của sessions bị block (check 1.1.11).

Khác với blocking.py (phát hiện chain structure), collector này focus vào
QUERY CONTENT của sessions đang bị block:
  - Phần A: Snapshot realtime — query nào đang bị block, head blocker là gì
  - Phần B: Aggregate trend từ raw_metrics — gọi RawMetricsRepo.aggregate()

Cần cả 2 chiều để AI phân tích đúng:
  blocking.py: "chain depth 5, head blocker session 123"
  blocked_queries.py: "session 456 đang chạy SELECT ... bị block bởi UPDATE ..."
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric
from ..storage.repositories.raw_metrics_repo import RawMetricsRepo

logger = logging.getLogger(__name__)


class BlockedQueriesCollector(BaseCollector):

    METRIC_BLOCKED_SNAPSHOT = "blocked_query_snapshot"
    METRIC_BLOCKED_TREND = "blocked_query_trend"

    def __init__(self, cfg, raw_metrics_repo: RawMetricsRepo) -> None:
        super().__init__(cfg)
        self._raw_metrics_repo = raw_metrics_repo

    def collect_node(self, node_host: str) -> list[RawMetric]: ...

    def _collect_snapshot(self, node_host: str) -> list[RawMetric]:
        """
        Lấy tất cả sessions đang bị block > blocked_query_snapshot_min_sec.
        JOIN với sys.dm_exec_sql_text 2 lần: 1 cho blocked session, 1 cho head blocker.
        """
        ...

    def _aggregate_trend(self, node_host: str) -> list[RawMetric]:
        """
        Query MongoDB raw_metrics (7 ngày) để tính blocked_count/avg_wait/peak_hours.
        Thực hiện aggregation trong MongoDB thay vì load data về Python
        để tránh memory spike khi volume cao.
        """
        ...
