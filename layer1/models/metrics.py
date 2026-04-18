"""
metrics.py — Models cho raw data thu thập từ MSSQL DMV/Query Store.

RawMetric là output chuẩn của mọi collector — ghi vào MongoDB `raw_metrics`
trước khi detectors phân tích. Tách bước thu thập và phân tích để:
  - Có thể replay detection với dữ liệu cũ khi điều chỉnh threshold
  - Audit trail đầy đủ ngay cả khi detector chưa tạo finding
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class RawMetric(BaseModel):
    """Một đơn vị dữ liệu thô từ 1 lần collector chạy trên 1 node."""

    metric_type: str = Field(description="Loại metric, ví dụ: 'slow_query', 'wait_stats_snapshot'")
    node: str = Field(description="Hostname của node MSSQL")
    collected_at: datetime = Field(default_factory=datetime.utcnow)
    data: dict[str, Any] = Field(description="Raw data tùy theo metric_type")
    collector_version: str = Field(default="1.0.0")


class CollectorResult(BaseModel):
    """Kết quả trả về từ 1 lần collector.run() cho 1 node.

    Collector không raise exception — mọi lỗi được capture vào error_message
    để scheduler tiếp tục chạy các job khác.
    """

    node: str
    metrics: list[RawMetric] = Field(default_factory=list)
    success: bool = True
    error_message: str | None = None
    duration_ms: float = 0.0
