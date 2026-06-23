"""window_repo.py — Đọc/ghi maintenance_window (window config + kill-switch)."""
from __future__ import annotations

import logging

from ..infra.time_utils import now_vn
from ..mongo import get_maint_db
from ..models.window import MaintenanceWindow

logger = logging.getLogger(__name__)

COLLECTION = "maintenance_window"


class WindowRepo:

    @property
    def collection(self):
        return get_maint_db()[COLLECTION]

    def find_by_cluster(self, cluster_id: str) -> MaintenanceWindow | None:
        """
        Đọc fresh mỗi lần gọi (mỗi tick) — DBA sửa window/kill-switch
        trong MongoDB có hiệu lực ngay tick sau, không cần restart.
        """
        doc = self.collection.find_one({"cluster_id": cluster_id})
        if not doc:
            return None
        doc.pop("_id", None)
        return MaintenanceWindow(**doc)

    def upsert(self, window: MaintenanceWindow) -> None:
        doc = window.model_dump()
        doc["updated_at"] = now_vn()
        self.collection.replace_one({"cluster_id": window.cluster_id}, doc, upsert=True)

    def set_kill_switch(self, cluster_id: str, enabled: bool) -> None:
        self.collection.update_one(
            {"cluster_id": cluster_id},
            {"$set": {"kill_switch": enabled, "updated_at": now_vn()}},
        )
        logger.warning("Maintenance kill_switch set: cluster=%s enabled=%s", cluster_id, enabled)
