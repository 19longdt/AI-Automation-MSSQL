"""
baseline_detector.py — So sánh query results với day-of-week baseline.

Dùng cho: slow query, wait stats anomaly, blocked query trend.
Baseline = avg cùng ngày trong tuần + cùng giờ trong N tuần gần nhất.

KHÔNG dùng rolling 7-day average: workload pattern khác nhau theo ngày
(Thứ Hai peak, Chủ Nhật thấp) → rolling average gây false positives.
"""
from __future__ import annotations

import logging

from ..models.topic import MonitorTopic
from ..models.metrics import QueryResult
from ..models.findings import Finding
from ..storage.repositories.baseline_repo import BaselineRepo

logger = logging.getLogger(__name__)


class BaselineDetector:

    def __init__(self, baseline_repo: BaselineRepo) -> None:
        self._baseline_repo = baseline_repo

    def detect(self, results: list[QueryResult], topic: MonitorTopic) -> list[Finding]:
        """
        So sánh metric_field trong query results với day-of-week baseline.
        Baseline config lấy từ topic.baseline_config.
        Trả về findings nếu value tăng > threshold_pct so với baseline.
        """
        ...

    def _compare_with_baseline(
        self,
        value: float,
        topic: MonitorTopic,
        node: str,
        query_hash: str | None,
    ) -> Finding | None:
        """So sánh 1 value với baseline. Trả về None nếu chưa đủ baseline data."""
        ...
