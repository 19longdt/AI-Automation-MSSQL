"""
blocked_query_trend.py — Phân tích trend của blocked queries (1.1.11 Phần B).

Đọc aggregated trend data từ raw_metrics_repo, tạo finding nếu cùng query_hash
bị block >= blocked_query_trend_min_count lần trong 7 ngày.
"""
from __future__ import annotations

import logging

from .base_detector import BaseDetector
from ..models.findings import Finding
from ..models.metrics import RawMetric
from ..storage.repositories.raw_metrics_repo import RawMetricsRepo

logger = logging.getLogger(__name__)


class BlockedQueryTrendDetector(BaseDetector):

    def __init__(self, cfg, findings_repo, baseline_repo, raw_metrics_repo: RawMetricsRepo) -> None:
        super().__init__(cfg, findings_repo, baseline_repo)
        self._raw_metrics_repo = raw_metrics_repo

    def detect(self, metrics: list[RawMetric]) -> list[Finding]:
        """
        Sử dụng blocked_query_trend metrics (đã được aggregate bởi collector).
        So sánh với day-of-week baseline để phân biệt pattern thực sự vs peak workload.
        """
        ...
