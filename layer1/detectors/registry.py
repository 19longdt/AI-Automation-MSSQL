"""
registry.py — Map detector_type string → detector handler.

Topic config chứa detector_type (optional). TopicRunner lookup handler qua registry.
Thêm detector mới = thêm 1 class + đăng ký trong DETECTOR_MAP — không sửa logic cũ.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .threshold_detector import ThresholdDetector
    from .baseline_detector import BaselineDetector
    from .plan_detector import PlanDetector
    from .blocking_detector import BlockingChainDetector
    from ..models.topic import MonitorTopic
    from ..models.metrics import QueryResult
    from ..models.findings import Finding

logger = logging.getLogger(__name__)


class DetectorRegistry:
    """
    Registry cho tất cả detector types.
    Mỗi detector nhận query results + topic config → trả về list[Finding].
    """

    def __init__(self) -> None:
        self._detectors: dict[str, object] = {}

    def register(self, detector_type: str, handler: object) -> None:
        """Đăng ký handler cho 1 detector_type."""
        ...

    def detect(self, detector_type: str, results: list[QueryResult], topic: MonitorTopic) -> list[Finding]:
        """
        Lookup handler và chạy detection.
        Trả về [] nếu detector_type không registered hoặc là None.
        """
        ...

    @classmethod
    def build_default(cls) -> DetectorRegistry:
        """
        Tạo registry với tất cả built-in detectors:
          "threshold" → ThresholdDetector
          "baseline"  → BaselineDetector
          "plan_analysis" → PlanDetector
          "blocking_chain" → BlockingChainDetector
        """
        ...
