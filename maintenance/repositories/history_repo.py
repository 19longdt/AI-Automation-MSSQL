"""history_repo.py — Ghi/đọc maintenance_history (audit + AI context)."""
from __future__ import annotations

import logging
from datetime import datetime

from pymongo import DESCENDING

from ..models.history import MaintenanceHistory, MaintenanceOutcome
from ..mongo import get_maint_db

logger = logging.getLogger(__name__)

COLLECTION = "maintenance_history"


class HistoryRepo:

    @property
    def collection(self):
        return get_maint_db()[COLLECTION]

    def insert(self, history: MaintenanceHistory) -> str:
        self.collection.insert_one(history.model_dump())
        return history.history_id

    def find_between(self, cluster_id: str, since: datetime, until: datetime) -> list[dict]:
        """History records trong khoảng thời gian — cho nightly summary."""
        return list(
            self.collection.find(
                {"cluster_id": cluster_id, "created_at": {"$gte": since, "$lt": until}},
                {"_id": 0},
            ).sort("created_at", DESCENDING)
        )

    def sum_done_minutes_between(self, cluster_id: str, since: datetime, until: datetime) -> float:
        """
        Tổng phút đã thực thi trong khoảng — để tính budget còn lại của window.
        Tính cả done/failed/paused (đều chiếm thời gian window), bỏ skipped/dry_run.
        """
        pipeline = [
            {"$match": {
                "created_at": {"$gte": since, "$lt": until},
                "cluster_id": cluster_id,
                "outcome": {"$in": [
                    MaintenanceOutcome.DONE.value,
                    MaintenanceOutcome.FAILED.value,
                    MaintenanceOutcome.PAUSED.value,
                ]},
            }},
            {"$group": {"_id": None, "total_ms": {"$sum": "$duration_ms"}}},
        ]
        docs = list(self.collection.aggregate(pipeline))
        if not docs:
            return 0.0
        return float(docs[0].get("total_ms") or 0.0) / 60_000.0

    def find_recent_by_table(self, cluster_id: str, table_name: str, limit: int = 10) -> list[dict]:
        return list(
            self.collection.find({"cluster_id": cluster_id, "table_name": table_name}, {"_id": 0})
            .sort("created_at", DESCENDING)
            .limit(limit)
        )
