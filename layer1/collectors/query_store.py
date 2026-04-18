"""
query_store.py — Thu thập metrics từ Query Store cho checks 1.1.1–1.1.3, 1.1.6.

Chạy trên tất cả nodes (Primary + Readable Secondaries).
Query Store trên Secondary là subset của read workload — chấp nhận được
vì readable secondaries có workload riêng cần được monitor.

Checks:
  1.1.1 Slow Query / Performance Regression
  1.1.2 Plan Regression
  1.1.3 Plan Instability
  1.1.6 High Variation Query
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class QueryStoreCollector(BaseCollector):
    """Collector cho Query Store metrics."""

    METRIC_SLOW_QUERY = "qs_slow_query"
    METRIC_PLAN_REGRESSION = "qs_plan_regression"
    METRIC_PLAN_INSTABILITY = "qs_plan_instability"
    METRIC_HIGH_VARIATION = "qs_high_variation"

    def collect_node(self, node_host: str) -> list[RawMetric]:
        """Chạy tất cả 4 QS checks trên node, trả về combined list."""
        ...

    def _collect_slow_queries(self, node_host: str) -> list[RawMetric]:
        """
        Query: avg_duration trong 30 phút gần nhất, lọc theo min_executions.
        Kèm plan XML để detector và AI phân tích — plan XML có thể lớn,
        lưu reference thay vì embed trực tiếp nếu > 1MB.
        """
        ...

    def _collect_plan_regressions(self, node_host: str) -> list[RawMetric]:
        """
        Query: plans mới xuất hiện trong 24h tệ hơn plan cũ của cùng query.
        Cần JOIN query_store_plan với itself để so sánh new vs old plan.
        """
        ...

    def _collect_plan_instability(self, node_host: str) -> list[RawMetric]:
        """
        Query: queries có > plan_instability_min_plans plan khác nhau
        với worst/best ratio > plan_instability_ratio trong 7 ngày.
        """
        ...

    def _collect_high_variation(self, node_host: str) -> list[RawMetric]:
        """
        Query: queries có CV (stdev/avg) > high_variation_cv_threshold.
        stdev_duration có sẵn trong sys.query_store_runtime_stats.
        """
        ...
