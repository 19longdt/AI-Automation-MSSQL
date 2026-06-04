"""window_repo.py — Đọc/ghi maintenance_window (window config + kill-switch)."""
from __future__ import annotations

import logging

from ...storage.mongo_client import MongoConnection
from ...utils.time_utils import now_vn
from ..models.window import MaintenanceWindow

logger = logging.getLogger(__name__)

COLLECTION = "maintenance_window"
WINDOW_ID = "default"


class WindowRepo:

    @property
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def get(self) -> MaintenanceWindow | None:
        """
        Đọc fresh mỗi lần gọi (mỗi tick) — DBA sửa window/kill-switch
        trong MongoDB có hiệu lực ngay tick sau, không cần restart.
        """
        doc = self.collection.find_one({"window_id": WINDOW_ID})
        if not doc:
            return None
        doc.pop("_id", None)
        return MaintenanceWindow(**doc)

    def upsert(self, window: MaintenanceWindow) -> None:
        doc = window.model_dump()
        doc["updated_at"] = now_vn()
        self.collection.replace_one({"window_id": window.window_id}, doc, upsert=True)

    def set_kill_switch(self, enabled: bool) -> None:
        self.collection.update_one(
            {"window_id": WINDOW_ID},
            {"$set": {"kill_switch": enabled, "updated_at": now_vn()}},
        )
        logger.warning("Maintenance kill_switch set: %s", enabled)
