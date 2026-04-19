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
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def insert_batch(self, metrics: list[RawMetric]) -> int:
        """Batch insert, trả về số documents đã ghi.
        Không raise nếu MongoDB lỗi — log ERROR và return 0."""
        if not metrics:
            return 0
        try:
            docs = [m.model_dump() for m in metrics]
            result = self.collection.insert_many(docs, ordered=False)
            return len(result.inserted_ids)
        except Exception as exc:
            logger.error("insert_batch failed: %s", exc)
            return 0

    def find_by_type_and_node(
        self,
        metric_type: str,
        node: str,
        since: datetime,
        limit: int = 1000,
    ) -> list[dict]:
        return list(
            self.collection.find(
                {"topic_id": metric_type, "node": node, "collected_at": {"$gte": since}},
                limit=limit,
                sort=[("collected_at", -1)],
            )
        )

    def aggregate_blocked_query_trend(
        self,
        node: str,
        since: datetime,
        min_count: int,
    ) -> list[dict]:
        """Group by query_hash, tính blocked_count/avg_wait/peak_hours.
        Dùng aggregation pipeline thay vì Python-side groupby để tránh
        load toàn bộ raw data vào memory."""
        pipeline = [
            {"$match": {"node": node, "collected_at": {"$gte": since}}},
            {"$unwind": "$rows"},
            {"$match": {"rows.query_hash": {"$exists": True}}},
            {
                "$group": {
                    "_id": "$rows.query_hash",
                    "blocked_count": {"$sum": 1},
                    "avg_wait_ms": {"$avg": "$rows.wait_duration_ms"},
                    "max_wait_ms": {"$max": "$rows.wait_duration_ms"},
                    "peak_hours": {"$push": {"$hour": "$collected_at"}},
                }
            },
            {"$match": {"blocked_count": {"$gte": min_count}}},
            {"$sort": {"blocked_count": -1}},
        ]
        return list(self.collection.aggregate(pipeline))
