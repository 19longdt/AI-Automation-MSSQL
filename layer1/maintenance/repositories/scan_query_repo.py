"""scan_query_repo.py — CRUD maintenance_scan_queries."""
from __future__ import annotations

from ..models.scan_query import ScanQueryConfig
from ..mongo import get_maint_db

COLLECTION = "maintenance_scan_queries"


class ScanQueryRepo:

    @property
    def collection(self):
        return get_maint_db()[COLLECTION]

    def find_all_enabled(self) -> list[ScanQueryConfig]:
        docs = self.collection.find({"enabled": True}, {"_id": 0})
        return [ScanQueryConfig(**doc) for doc in docs]

    def find_by_id(self, query_id: str) -> ScanQueryConfig | None:
        doc = self.collection.find_one({"query_id": query_id}, {"_id": 0})
        return ScanQueryConfig(**doc) if doc else None

    def upsert(self, query: ScanQueryConfig) -> None:
        self.collection.replace_one(
            {"query_id": query.query_id},
            query.model_dump(),
            upsert=True,
        )
