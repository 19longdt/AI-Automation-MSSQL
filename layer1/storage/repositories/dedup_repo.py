"""dedup_repo.py — Chống spam alert bằng cách track finding_hash đã gửi."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "dedup_cache"


class DedupRepo:

    @property
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def should_alert(self, finding_hash: str, suppress_minutes: int) -> bool:
        """
        Trả về True nếu nên gửi alert (chưa alert trong suppress_minutes gần đây).
        Dùng findOneAndUpdate để atomic check-and-set — tránh race condition
        khi nhiều findings cùng hash xuất hiện trong cùng job run.
        """
        now = datetime.utcnow()
        cutoff = now - timedelta(minutes=suppress_minutes)

        # Atomic: update record nếu last_alerted_at đã quá suppress window
        updated = self.collection.find_one_and_update(
            {"finding_hash": finding_hash, "last_alerted_at": {"$lt": cutoff}},
            {"$set": {"last_alerted_at": now}},
            return_document=ReturnDocument.AFTER,
        )
        if updated is not None:
            return True

        # Record chưa tồn tại → tạo mới (lần alert đầu tiên)
        try:
            self.collection.insert_one(
                {"finding_hash": finding_hash, "last_alerted_at": now}
            )
            return True
        except DuplicateKeyError:
            # Record tồn tại và last_alerted_at còn trong suppress window → suppress
            return False

    def mark_alerted(self, finding_hash: str) -> None:
        """Ghi nhận đã alert, update last_alerted_at."""
        self.collection.update_one(
            {"finding_hash": finding_hash},
            {"$set": {"last_alerted_at": datetime.utcnow()}},
            upsert=True,
        )
