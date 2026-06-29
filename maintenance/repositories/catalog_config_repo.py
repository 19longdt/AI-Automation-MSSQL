from __future__ import annotations

from ..infra.time_utils import now_vn
from ..models.catalog import CatalogConfig
from ..mongo import get_maint_db


class CatalogConfigRepo:
    COLLECTION = "maintenance_catalog_config"

    @property
    def collection(self):
        return get_maint_db()[self.COLLECTION]

    def find_by_cluster(self, cluster_id: str) -> CatalogConfig | None:
        doc = self.collection.find_one({"cluster_id": cluster_id})
        if not doc:
            return None
        doc.pop("_id", None)
        return CatalogConfig(**doc)

    def upsert(self, config: CatalogConfig) -> None:
        doc = config.model_dump()
        doc["updated_at"] = now_vn()
        self.collection.replace_one({"cluster_id": config.cluster_id}, doc, upsert=True)
