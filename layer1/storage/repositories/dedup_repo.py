"""dedup_repo.py — Chống spam alert bằng cách track finding_hash đã gửi."""
from __future__ import annotations

import logging
from datetime import timedelta

from ...utils.time_utils import now_vn
from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "dedup_cache"


class DedupRepo:

    @property
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def was_alerted_recently(self, finding_hash: str, suppress_minutes: int) -> bool:
        """Trả về True nếu hash đã alert trong suppress window gần đây."""
        cutoff = now_vn() - timedelta(minutes=suppress_minutes)
        doc = self.collection.find_one(
            {"finding_hash": finding_hash, "last_alerted_at": {"$gte": cutoff}},
            {"_id": 1},
        )
        return doc is not None

    def should_alert(self, finding_hash: str, suppress_minutes: int) -> bool:
        """Legacy helper: True nếu chưa alert trong suppress window."""
        return not self.was_alerted_recently(finding_hash, suppress_minutes)

    def mark_alerted(self, finding_hash: str) -> None:
        """Ghi nhận đã alert, update last_alerted_at."""
        self.collection.update_one(
            {"finding_hash": finding_hash},
            {"$set": {"last_alerted_at": now_vn()}},
            upsert=True,
        )
