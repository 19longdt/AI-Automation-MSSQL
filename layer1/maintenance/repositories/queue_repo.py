"""
queue_repo.py — Work queue maintenance_queue.

Claim item bằng findOneAndUpdate — ATOMIC, an toàn kể cả khi
có nhiều hơn 1 maintenance process (dù design là single instance).
"""
from __future__ import annotations

import logging
from datetime import datetime

from pymongo import ASCENDING, DESCENDING, ReturnDocument

from ...utils.time_utils import now_vn
from ..mongo import get_maint_db
from ..models.work_item import (
    OPEN_STATUSES,
    TERMINAL_STATUSES,
    WorkItem,
    WorkItemStatus,
)

logger = logging.getLogger(__name__)

COLLECTION = "maintenance_queue"

_CLAIM_SORT = [("priority", DESCENDING), ("created_at", ASCENDING)]


def _to_item(doc: dict | None) -> WorkItem | None:
    if not doc:
        return None
    doc.pop("_id", None)
    return WorkItem(**doc)


class QueueRepo:

    @property
    def collection(self):
        return get_maint_db()[COLLECTION]

    # ── Scan side ────────────────────────────────────────────────────────────

    def insert_many(self, items: list[WorkItem]) -> int:
        if not items:
            return 0
        self.collection.insert_many([item.model_dump() for item in items])
        return len(items)

    def find_open_keys(self) -> set[tuple]:
        """Dedupe keys của items chưa terminal — scan không enqueue trùng."""
        open_values = [s.value for s in OPEN_STATUSES]
        keys: set[tuple] = set()
        cursor = self.collection.find(
            {"status": {"$in": open_values}},
            {
                "schema_name": 1,
                "table_name": 1,
                "index_name": 1,
                "stats_name": 1,
                "partition_number": 1,
                "kind": 1,
            },
        )
        for doc in cursor:
            keys.add((
                doc.get("schema_name"),
                doc.get("table_name"),
                doc.get("index_name"),
                doc.get("stats_name"),
                doc.get("partition_number"),
                doc.get("kind"),
            ))
        return keys

    def expire_stale_awaiting(self, older_than: datetime) -> int:
        """Batch cũ chưa được duyệt → expired (không bao giờ chạy)."""
        now = now_vn()
        result = self.collection.update_many(
            {
                "status": WorkItemStatus.AWAITING_APPROVAL.value,
                "created_at": {"$lt": older_than},
            },
            {"$set": {
                "status": WorkItemStatus.EXPIRED.value,
                "updated_at": now,
                "terminal_at": now,
            }},
        )
        return result.modified_count

    # ── Approval side ────────────────────────────────────────────────────────

    def bulk_decide_batch(self, batch_id: str, decision: str, decided_by: str) -> int:
        """Approve/Reject ALL items awaiting_approval của 1 batch."""
        now = now_vn()
        if decision == "approved":
            update = {"$set": {
                "status": WorkItemStatus.APPROVED.value,
                "approval": {"decided_by": decided_by, "decided_at": now, "decision": decision},
                "updated_at": now,
            }}
        else:
            update = {"$set": {
                "status": WorkItemStatus.REJECTED.value,
                "approval": {"decided_by": decided_by, "decided_at": now, "decision": decision},
                "updated_at": now,
                "terminal_at": now,
            }}
        result = self.collection.update_many(
            {"batch_id": batch_id, "status": WorkItemStatus.AWAITING_APPROVAL.value},
            update,
        )
        return result.modified_count

    def decide_item(self, short_id: str, decision: str, decided_by: str) -> bool:
        """Approve/Reject 1 item theo short_id. Idempotent — item đã quyết → False."""
        now = now_vn()
        new_status = (
            WorkItemStatus.APPROVED if decision == "approved" else WorkItemStatus.REJECTED
        )
        set_fields: dict = {
            "status": new_status.value,
            "approval": {"decided_by": decided_by, "decided_at": now, "decision": decision},
            "updated_at": now,
        }
        if new_status in TERMINAL_STATUSES:
            set_fields["terminal_at"] = now
        result = self.collection.update_one(
            {"short_id": short_id, "status": WorkItemStatus.AWAITING_APPROVAL.value},
            {"$set": set_fields},
        )
        return result.modified_count > 0

    # ── Execute side ─────────────────────────────────────────────────────────

    def claim_paused_resumable(self) -> WorkItem | None:
        """Ưu tiên RESUME rebuild đang paused trước khi lấy item mới."""
        doc = self.collection.find_one_and_update(
            {"status": WorkItemStatus.PAUSED.value, "resume_token": True},
            {"$set": {"status": WorkItemStatus.RUNNING.value, "updated_at": now_vn()}},
            sort=_CLAIM_SORT,
            return_document=ReturnDocument.AFTER,
        )
        return _to_item(doc)

    def claim_next_approved(self) -> WorkItem | None:
        """Claim atomic item approved có priority cao nhất."""
        doc = self.collection.find_one_and_update(
            {"status": WorkItemStatus.APPROVED.value},
            {"$set": {"status": WorkItemStatus.RUNNING.value, "updated_at": now_vn()}},
            sort=_CLAIM_SORT,
            return_document=ReturnDocument.AFTER,
        )
        return _to_item(doc)

    def release(
        self,
        item_id: str,
        status: WorkItemStatus,
        *,
        attempts: int | None = None,
        last_error: str | None = None,
        resume_token: bool | None = None,
    ) -> None:
        """Trả item về trạng thái non-terminal (approved/paused) sau gate-fail/PAUSE."""
        set_fields: dict = {"status": status.value, "updated_at": now_vn()}
        if attempts is not None:
            set_fields["attempts"] = attempts
        if last_error is not None:
            set_fields["last_error"] = last_error
        if resume_token is not None:
            set_fields["resume_token"] = resume_token
        self.collection.update_one({"item_id": item_id}, {"$set": set_fields})

    def finalize(
        self,
        item_id: str,
        status: WorkItemStatus,
        *,
        attempts: int | None = None,
        last_error: str | None = None,
    ) -> None:
        """Set trạng thái terminal + terminal_at (TTL anchor)."""
        now = now_vn()
        set_fields: dict = {
            "status": status.value,
            "updated_at": now,
            "terminal_at": now,
        }
        if attempts is not None:
            set_fields["attempts"] = attempts
        if last_error is not None:
            set_fields["last_error"] = last_error
        self.collection.update_one({"item_id": item_id}, {"$set": set_fields})

    def recover_running(self) -> int:
        """
        Gọi khi startup: item RUNNING là tàn dư của process chết giữa chừng —
        trả về approved để chạy lại (REORGANIZE/STATS an toàn re-run;
        REBUILD resumable bị ngắt sẽ được server giữ trạng thái PAUSED,
        ALTER ... RESUME từ statement mới vẫn hợp lệ).
        """
        result = self.collection.update_many(
            {"status": WorkItemStatus.RUNNING.value},
            {"$set": {"status": WorkItemStatus.APPROVED.value, "updated_at": now_vn()}},
        )
        if result.modified_count:
            logger.warning(
                "Recovered %d item(s) RUNNING từ process trước → approved.",
                result.modified_count,
            )
        return result.modified_count

    def count_by_status(self) -> dict[str, int]:
        """Đếm items theo status — cho summary/notification."""
        pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
        return {doc["_id"]: doc["count"] for doc in self.collection.aggregate(pipeline)}

    def find_by_batch(self, batch_id: str) -> list[WorkItem]:
        docs = self.collection.find({"batch_id": batch_id}).sort(_CLAIM_SORT)
        return [item for item in (_to_item(d) for d in docs) if item]
