from __future__ import annotations

import logging
from datetime import datetime

from ...config import EnvSettings
from ...models.cluster import ClusterConfig, ClusterCreate, ClusterResponse, ClusterUpdate
from ...utils.time_utils import now_vn
from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "db_clusters"


class ClusterRepo:
    @property
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def count(self) -> int:
        return int(self.collection.count_documents({}))

    def find_all(self) -> list[ClusterConfig]:
        docs = self.collection.find({}, sort=[("name", 1)])
        return [self._to_config(doc) for doc in docs]

    def find_all_enabled(self) -> list[ClusterConfig]:
        docs = self.collection.find({"enabled": True}, sort=[("name", 1)])
        return [self._to_config(doc) for doc in docs]

    def find_by_id(self, cluster_id: str) -> ClusterConfig | None:
        doc = self.collection.find_one({"cluster_id": cluster_id})
        return self._to_config(doc) if doc else None

    def upsert(self, cluster: ClusterConfig) -> None:
        now = now_vn()
        existing = self.collection.find_one({"cluster_id": cluster.cluster_id}, {"created_at": 1})
        payload = cluster.model_dump()
        payload["created_at"] = existing.get("created_at", now) if existing else (cluster.created_at or now)
        payload["updated_at"] = now
        self.collection.update_one({"cluster_id": cluster.cluster_id}, {"$set": payload}, upsert=True)

    def create(self, data: ClusterCreate) -> ClusterResponse:
        if self.find_by_id(data.cluster_id):
            raise ValueError(f"cluster_id '{data.cluster_id}' already exists")
        now = now_vn()
        cluster = ClusterConfig(**data.model_dump(), created_at=now, updated_at=now)
        self.collection.insert_one(cluster.model_dump())
        return self._to_response(cluster)

    def update(self, cluster_id: str, data: ClusterUpdate) -> ClusterResponse | None:
        current = self.find_by_id(cluster_id)
        if current is None:
            return None
        patch = data.model_dump(exclude_unset=True)
        if "password" in patch and patch["password"] is None:
            patch.pop("password")
        if patch.get("password", "") == "":
            patch.pop("password", None)
        merged = current.model_dump()
        merged.update(patch)
        merged["updated_at"] = now_vn()
        updated = ClusterConfig(**merged)
        self.collection.update_one({"cluster_id": cluster_id}, {"$set": updated.model_dump()})
        return self._to_response(updated)

    def delete(self, cluster_id: str) -> bool:
        result = self.collection.delete_one({"cluster_id": cluster_id})
        return result.deleted_count > 0

    def list_responses(self) -> list[ClusterResponse]:
        return [self._to_response(cluster) for cluster in self.find_all()]

    def get_response(self, cluster_id: str) -> ClusterResponse | None:
        cluster = self.find_by_id(cluster_id)
        return self._to_response(cluster) if cluster else None

    def seed_from_env(self, settings: EnvSettings) -> ClusterConfig | None:
        if self.count() > 0:
            return None
        if not settings.has_legacy_cluster_config():
            return None
        now = now_vn()
        cluster = ClusterConfig(
            cluster_id="legacy_default",
            name="Legacy Default Cluster",
            environment="other",
            nodes=settings.mssql_nodes,
            port=settings.mssql_port,
            database=settings.mssql_database,
            username=settings.mssql_username,
            password=settings.mssql_password,
            enabled=True,
            color="#6b7280",
            created_at=now,
            updated_at=now,
        )
        self.collection.insert_one(cluster.model_dump())
        logger.info("Seeded 1 cluster from env vars: cluster_id=%s", cluster.cluster_id)
        return cluster

    def _to_config(self, doc: dict | None) -> ClusterConfig:
        if doc is None:
            raise ValueError("cluster document is required")
        clean = {k: v for k, v in doc.items() if k != "_id"}
        return ClusterConfig(**clean)

    def _to_response(self, cluster: ClusterConfig) -> ClusterResponse:
        return ClusterResponse(
            cluster_id=cluster.cluster_id,
            name=cluster.name,
            environment=cluster.environment,
            nodes=cluster.nodes,
            port=cluster.port,
            database=cluster.database,
            username=cluster.username,
            connect_timeout_sec=cluster.connect_timeout_sec,
            enabled=cluster.enabled,
            color=cluster.color,
            has_password=bool(cluster.password),
            node_roles=cluster.node_roles,
            created_at=cluster.created_at,
            updated_at=cluster.updated_at,
        )
