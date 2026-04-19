"""
threshold_detector.py — Generic: so sánh query result values với config thresholds.

Dùng cho: PLE, TempDB %, AG lag, backup gap, DBCC age, Resource Governor...
Thresholds hoàn toàn từ topic config — không hardcode trong Python.

Ví dụ topic config:
  thresholds:
    tempdb_usage_pct: { warning: 70, critical: 85 }
    ple_sec: { warning: 300, critical: 100 }

Detector kiểm tra mỗi row trong query result:
  row["tempdb_usage_pct"] > 85 → CRITICAL finding
  row["ple_sec"] < 300 → WARNING finding (ngược hướng — giá trị thấp hơn = xấu hơn)
"""
from __future__ import annotations

import logging

from ..models.topic import MonitorTopic, ThresholdConfig
from ..models.metrics import QueryResult
from ..models.findings import Finding

logger = logging.getLogger(__name__)


class ThresholdDetector:

    def detect(self, results: list[QueryResult], topic: MonitorTopic) -> list[Finding]:
        """
        Với mỗi threshold field trong topic.thresholds:
          Tìm field tương ứng trong query result rows.
          So sánh value với warning/critical thresholds.
          Tạo Finding nếu vượt ngưỡng.
        """
        ...

    def _check_row(
        self,
        row: dict,
        field: str,
        threshold: ThresholdConfig,
        topic: MonitorTopic,
        node: str,
    ) -> Finding | None:
        """Kiểm tra 1 row, 1 field. Trả về Finding hoặc None."""
        ...
