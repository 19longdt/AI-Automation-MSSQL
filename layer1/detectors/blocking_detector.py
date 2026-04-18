"""blocking_detector.py — Phát hiện blocking chain, deadlock, lock escalation (1.1.7)."""
from __future__ import annotations

import logging

from .base_detector import BaseDetector
from ..models.findings import Finding
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class BlockingDetector(BaseDetector):

    def detect(self, metrics: list[RawMetric]) -> list[Finding]:
        """Phân tích blocking_chain, deadlock_event, lock_escalation metrics."""
        ...

    def _detect_chains(self, metrics: list[RawMetric]) -> list[Finding]:
        """Flag nếu chain depth > blocking_chain_depth_critical hoặc duration > threshold."""
        ...

    def _detect_deadlocks(self, metrics: list[RawMetric]) -> list[Finding]:
        """Mọi deadlock event đều là CRITICAL — alert ngay."""
        ...
