"""
base_detector.py — Abstract base class cho tất cả detectors.

Detector nhận raw metrics từ repository, so sánh với thresholds/baselines,
tạo Finding objects. Không tương tác trực tiếp với MSSQL — chỉ đọc MongoDB.

Separation of concerns:
  Collector: MSSQL → raw data → MongoDB raw_metrics
  Detector:  MongoDB raw_metrics → analysis → MongoDB findings
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from ..config import ConfigManager
from ..models.findings import Finding
from ..models.metrics import RawMetric
from ..storage.repositories.baseline_repo import BaselineRepo
from ..storage.repositories.findings_repo import FindingsRepo

logger = logging.getLogger(__name__)


class BaseDetector(ABC):

    def __init__(self, cfg: ConfigManager, findings_repo: FindingsRepo, baseline_repo: BaselineRepo) -> None:
        self._cfg = cfg
        self._findings_repo = findings_repo
        self._baseline_repo = baseline_repo

    @abstractmethod
    def detect(self, metrics: list[RawMetric]) -> list[Finding]:
        """Phân tích metrics, trả về list findings (empty nếu không có issue)."""
        ...

    def _save_finding(self, finding: Finding) -> None:
        """Lưu finding và update baseline."""
        ...

    def _determine_severity(self, value: float, warning_threshold: float, critical_threshold: float) -> ...:
        """Helper generic để map numeric value sang Severity."""
        ...
