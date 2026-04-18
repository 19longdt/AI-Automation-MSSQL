"""plan_instability.py — Phát hiện query có nhiều plan khác nhau (1.1.3)."""
from __future__ import annotations

import logging

from .base_detector import BaseDetector
from ..models.findings import Finding
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class PlanInstabilityDetector(BaseDetector):

    def detect(self, metrics: list[RawMetric]) -> list[Finding]:
        """
        Flag nếu plan_count > plan_instability_min_plans
        và worst/best ratio > plan_instability_ratio.

        Không bao giờ suggest OPTION(OPTIMIZE FOR UNKNOWN) trong finding.notes —
        đã xác nhận gây CPU overload khi throughput cao trên hệ thống này.
        """
        ...
