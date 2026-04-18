"""plan_regression.py — Phát hiện plan mới tệ hơn plan cũ (1.1.2)."""
from __future__ import annotations

import logging

from .base_detector import BaseDetector
from ..models.findings import Finding
from ..models.metrics import RawMetric
from ..plan_parser.plan_comparer import PlanComparer

logger = logging.getLogger(__name__)


class PlanRegressionDetector(BaseDetector):

    def __init__(self, cfg, findings_repo, baseline_repo, plan_comparer: PlanComparer) -> None:
        super().__init__(cfg, findings_repo, baseline_repo)
        self._comparer = plan_comparer

    def detect(self, metrics: list[RawMetric]) -> list[Finding]:
        """Phân tích qs_plan_regression metrics, so sánh plan XML old vs new."""
        ...
