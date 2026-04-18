"""
wait_anomaly_detector.py — Phát hiện wait type tăng bất thường (1.1.9).

So sánh delta wait_time_ms với day-of-week baseline (cùng ngày/giờ, 4 tuần).
Không alert toàn bộ wait types — chỉ top-10 và các wait types có ý nghĩa.
"""
from __future__ import annotations

import logging

from .base_detector import BaseDetector
from ..models.findings import Finding
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)

# Wait types được monitor đặc biệt — có mapping sang probable root cause
SIGNIFICANT_WAIT_TYPES = {
    "PAGEIOLATCH_SH": "I/O bottleneck (read)",
    "PAGEIOLATCH_EX": "I/O bottleneck (write)",
    "CXPACKET": "Parallelism inefficiency",
    "CXCONSUMER": "Parallelism inefficiency",
    "WRITELOG": "Transaction log I/O (liên quan AG sync)",
    "ASYNC_NETWORK_IO": "Client không đọc kịp kết quả",
}


class WaitAnomalyDetector(BaseDetector):

    def detect(self, metrics: list[RawMetric]) -> list[Finding]:
        """
        Kiểm tra mỗi wait type trong delta:
          1. Có trong wait_types_ignore? → skip
          2. So sánh với baseline (day_of_week + hour)
          3. Tăng > wait_anomaly_threshold_pct? → tạo finding
        """
        ...
