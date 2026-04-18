"""dedup_repo.py — Chống spam alert bằng cách track finding_hash đã gửi."""
from __future__ import annotations

import logging
from datetime import datetime

from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "dedup_cache"


class DedupRepo:

    @property
    def collection(self): ...

    def should_alert(self, finding_hash: str, suppress_minutes: int) -> bool:
        """
        Trả về True nếu nên gửi alert (chưa alert trong suppress_minutes gần đây).
        Dùng findOneAndUpdate để atomic check-and-set — tránh race condition
        khi nhiều findings cùng hash xuất hiện trong cùng job run.
        """
        ...

    def mark_alerted(self, finding_hash: str) -> None:
        """Ghi nhận đã alert, update last_alerted_at."""
        ...
