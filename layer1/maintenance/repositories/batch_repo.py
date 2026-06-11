"""batch_repo.py — CRUD maintenance_batches."""
from __future__ import annotations

import logging
from datetime import datetime

from pymongo import DESCENDING

from ...utils.time_utils import now_vn
from ..mongo import get_maint_db
from ..models.approval import BatchStatus, MaintenanceBatch

logger = logging.getLogger(__name__)

COLLECTION = "maintenance_batches"


def _to_batch(doc: dict | None) -> MaintenanceBatch | None:
    if not doc:
        return None
    doc.pop("_id", None)
    return MaintenanceBatch(**doc)


class BatchRepo:

    @property
    def collection(self):
        return get_maint_db()[COLLECTION]

    def insert(self, batch: MaintenanceBatch) -> str:
        self.collection.insert_one(batch.model_dump())
        return batch.batch_id

    def find_by_id(self, batch_id: str) -> MaintenanceBatch | None:
        return _to_batch(self.collection.find_one({"batch_id": batch_id}))

    def set_message_id(self, batch_id: str, message_id: int) -> None:
        self.collection.update_one(
            {"batch_id": batch_id},
            {"$set": {"telegram_message_id": message_id}},
        )

    def decide(self, batch_id: str, decision: str, decided_by: str) -> bool:
        """Ghi quyết định batch. Idempotent — batch đã quyết → False."""
        result = self.collection.update_one(
            {"batch_id": batch_id, "status": BatchStatus.AWAITING_APPROVAL.value},
            {"$set": {
                "status": BatchStatus.DECIDED.value,
                "decision": decision,
                "decided_by": decided_by,
                "decided_at": now_vn(),
            }},
        )
        return result.modified_count > 0

    def expire_stale(self, older_than: datetime) -> int:
        result = self.collection.update_many(
            {
                "status": BatchStatus.AWAITING_APPROVAL.value,
                "created_at": {"$lt": older_than},
            },
            {"$set": {"status": BatchStatus.EXPIRED.value}},
        )
        return result.modified_count

    def find_latest_awaiting(self) -> MaintenanceBatch | None:
        doc = self.collection.find_one(
            {"status": BatchStatus.AWAITING_APPROVAL.value},
            sort=[("created_at", DESCENDING)],
        )
        return _to_batch(doc)
