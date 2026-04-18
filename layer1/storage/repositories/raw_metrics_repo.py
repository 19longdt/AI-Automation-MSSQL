"""raw_metrics_repo.py — Repository cho collection `raw_metrics`."""
from __future__ import annotations

import logging
from datetime import datetime

from ..mongo_client import MongoConnection
from ...models.metrics import RawMetric

logger = logging.getLogger(__name__)

COLLECTION = "raw_metrics"


class RawMetricsRepo:
    """Ghi raw data từ collectors vào MongoDB.

    Dùng insert_many để batch write — collectors thường trả về nhiều rows
    và individual inserts sẽ tạo quá nhiều round-trips.
    """

    @property
    def collection(self): ...

    def insert_batch(self, metrics: list[RawMetric]) -> int:
        """Batch insert, trả về số documents đã ghi.
        Không raise nếu MongoDB lỗi — log ERROR và return 0."""
        ...

    def find_by_type_and_node(
        self,
        metric_type: str,
        node: str,
        since: datetime,
        limit: int = 1000,
    ) -> list[dict]: ...

    def aggregate_blocked_query_trend(
        self,
        node: str,
        since: datetime,
        min_count: int,
    ) -> list[dict]:
        """Group by query_hash, tính blocked_count/avg_wait/peak_hours.
        Dùng aggregation pipeline thay vì Python-side groupby để tránh
        load toàn bộ raw data vào memory."""
        ...
