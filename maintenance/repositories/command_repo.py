from __future__ import annotations

from pymongo import ASCENDING, ReturnDocument

from ..infra.time_utils import now_vn
from ..models.command import MaintenanceCommand, MaintenanceCommandStatus
from ..mongo import get_maint_db


def _to_command(doc: dict | None) -> MaintenanceCommand | None:
    if not doc:
        return None
    doc.pop("_id", None)
    return MaintenanceCommand(**doc)


class CommandRepo:
    COLLECTION = "maintenance_commands"

    @property
    def collection(self):
        return get_maint_db()[self.COLLECTION]

    def claim_pending(self) -> MaintenanceCommand | None:
        doc = self.collection.find_one_and_update(
            {"status": MaintenanceCommandStatus.PENDING.value},
            {
                "$set": {
                    "status": MaintenanceCommandStatus.RUNNING.value,
                    "claimed_at": now_vn(),
                    "error": None,
                }
            },
            sort=[("requested_at", ASCENDING)],
            return_document=ReturnDocument.AFTER,
        )
        return _to_command(doc)

    def mark_done(self, command_id: str) -> None:
        now = now_vn()
        self.collection.update_one(
            {"command_id": command_id},
            {
                "$set": {
                    "status": MaintenanceCommandStatus.DONE.value,
                    "finished_at": now,
                    "error": None,
                }
            },
        )

    def mark_pending(self, command_id: str) -> None:
        self.collection.update_one(
            {"command_id": command_id},
            {
                "$set": {
                    "status": MaintenanceCommandStatus.PENDING.value,
                    "claimed_at": None,
                    "finished_at": None,
                    "error": None,
                }
            },
        )

    def mark_failed(self, command_id: str, error: str) -> None:
        self.collection.update_one(
            {"command_id": command_id},
            {
                "$set": {
                    "status": MaintenanceCommandStatus.FAILED.value,
                    "finished_at": now_vn(),
                    "error": error[:1000],
                }
            },
        )
