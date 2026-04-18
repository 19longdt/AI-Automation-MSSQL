"""
query_regression.py — Phát hiện slow query so với day-of-week baseline (1.1.1).

So sánh avg_duration hiện tại với baseline cùng ngày trong tuần + cùng giờ.
Không dùng rolling 7-day average vì workload có pattern theo ngày:
  Thứ Hai (đầu tuần) thường cao hơn Thứ Sáu → so sánh Thứ Hai với Thứ Hai.
"""
from __future__ import annotations

import logging

from .base_detector import BaseDetector
from ..models.findings import Finding
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class QueryRegressionDetector(BaseDetector):

    def detect(self, metrics: list[RawMetric]) -> list[Finding]:
        """Phân tích qs_slow_query metrics, so sánh với baseline."""
        ...

    def _check_single_query(self, metric: RawMetric) -> Finding | None:
        """
        Kiểm tra 1 query metric:
          1. Có đủ executions không (min_executions threshold)?
          2. Có baseline chưa (chưa đủ 4 tuần → skip, không false positive)?
          3. avg_duration tăng > slow_query_threshold_pct so với baseline?
        """
        ...
