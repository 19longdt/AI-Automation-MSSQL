from __future__ import annotations

from pymongo.database import Database

from layer1.models.cluster import ClusterConfig


class ClusterReader:
    COLLECTION = "db_clusters"

    def __init__(self, monitor_db: Database) -> None:
        self._collection = monitor_db[self.COLLECTION]

    def find_all_enabled(self) -> list[ClusterConfig]:
        docs = self._collection.find({"enabled": True}, sort=[("name", 1)])
        return [ClusterConfig(**self._strip_id(doc)) for doc in docs]

    def find_by_id(self, cluster_id: str) -> ClusterConfig | None:
        doc = self._collection.find_one({"cluster_id": cluster_id, "enabled": True})
        if not doc:
            return None
        return ClusterConfig(**self._strip_id(doc))

    @staticmethod
    def _strip_id(doc: dict) -> dict:
        return {key: value for key, value in doc.items() if key != "_id"}
