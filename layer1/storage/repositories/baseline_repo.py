"""
baseline_repo.py — Repository cho collection `baselines`.

Day-of-week aware baseline: mỗi record là average của cùng ngày trong tuần
+ cùng giờ trong N tuần gần nhất. Không dùng rolling average vì workload
có pattern theo ngày (Thứ Hai cao điểm, Chủ Nhật thấp).
"""
from __future__ import annotations

import logging
from datetime import datetime

from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "baselines"

# Sentinel dùng khi query_hash là None để unique index hoạt động đúng.
# Baseline không gắn với query cụ thể dùng key này.
_NO_HASH = ""


class BaselineRepo:

    @property
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def _build_filter(
        self,
        metric_type: str,
        node: str,
        day_of_week: int,
        hour: int,
        query_hash: str | None = None,
    ) -> dict:
        return {
            "metric_type": metric_type,
            "node": node,
            "day_of_week": day_of_week,
            "hour": hour,
            "query_hash": query_hash if query_hash is not None else _NO_HASH,
        }

    def get_baseline(
        self,
        metric_type: str,
        node: str,
        day_of_week: int,
        hour: int,
        query_hash: str | None = None,
    ) -> dict | None:
        """
        Trả về baseline document cho metric_type + node + day_of_week + hour.
        day_of_week: 0=Monday … 6=Sunday (Python weekday()).
        """
        return self.collection.find_one(
            self._build_filter(metric_type, node, day_of_week, hour, query_hash)
        )

    def upsert_baseline(
        self,
        metric_type: str,
        node: str,
        day_of_week: int,
        hour: int,
        new_sample: dict,
        query_hash: str | None = None,
        max_samples: int = 4,
    ) -> None:
        """
        Thêm sample mới vào danh sách samples, giữ tối đa max_samples tuần gần nhất.
        Tính lại baseline_avg và baseline_stddev sau khi update.
        Dùng $push + $slice thay vì read-modify-write để atomic.
        """
        filter_doc = self._build_filter(metric_type, node, day_of_week, hour, query_hash)

        # Atomic: push new sample, giữ chỉ max_samples cuối
        self.collection.update_one(
            filter_doc,
            {
                "$push": {
                    "samples": {
                        "$each": [new_sample],
                        "$slice": -max_samples,
                    }
                },
                "$set": {"updated_at": datetime.utcnow()},
            },
            upsert=True,
        )

        # Recalculate avg/stddev sau khi push (2-phase update chấp nhận được vì single-instance)
        doc = self.collection.find_one(filter_doc)
        if not doc or not doc.get("samples"):
            return

        # Lấy field value từ sample — hỗ trợ cả "avg_ms" và "value"
        values = [
            s.get("avg_ms", s.get("value", 0.0))
            for s in doc["samples"]
            if s.get("avg_ms") is not None or s.get("value") is not None
        ]
        if not values:
            return

        avg = sum(values) / len(values)
        variance = sum((v - avg) ** 2 for v in values) / len(values)
        stddev = variance ** 0.5

        self.collection.update_one(
            filter_doc,
            {"$set": {"baseline_avg": avg, "baseline_stddev": stddev}},
        )

    def is_anomaly(
        self,
        metric_type: str,
        node: str,
        current_value: float,
        day_of_week: int,
        hour: int,
        threshold_pct: float,
        query_hash: str | None = None,
    ) -> bool:
        """
        Kiểm tra current_value có vượt baseline_avg * (1 + threshold_pct/100) không.
        Trả về False nếu chưa có baseline (chưa đủ dữ liệu).
        """
        doc = self.get_baseline(metric_type, node, day_of_week, hour, query_hash)
        if not doc or not doc.get("baseline_avg"):
            return False
        threshold = doc["baseline_avg"] * (1 + threshold_pct / 100)
        return current_value > threshold
