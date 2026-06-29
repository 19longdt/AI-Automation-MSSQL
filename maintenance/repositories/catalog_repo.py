from __future__ import annotations

from datetime import datetime

from ..models.campaign import CampaignScopeDatabase
from ..models.catalog import CatalogTableDocument
from ..mongo import get_maint_db

LEGACY_RUN_ID = "__legacy__"


def _strip_id(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


class CatalogRepo:
    COLLECTION = "maintenance_catalog"

    @property
    def collection(self):
        return get_maint_db()[self.COLLECTION]

    def upsert_batch(self, cluster_id: str, database_name: str, docs: list[dict]) -> None:
        if not docs:
            return
        payloads = [
            CatalogTableDocument(
                cluster_id=cluster_id,
                database_name=database_name,
                **doc,
            ).model_dump()
            for doc in docs
        ]
        if payloads:
            self.collection.insert_many(payloads, ordered=False)

    def find_databases(self, cluster_id: str) -> list[str]:
        return sorted(self.collection.distinct("database_name", {"cluster_id": cluster_id}))

    def find_schemas(self, cluster_id: str, database_name: str) -> list[str]:
        run_id = self._find_latest_run_id(cluster_id, database_name)
        if run_id is None:
            return []
        return sorted(
            self.collection.distinct(
                "schema_name",
                self._build_run_match(cluster_id, database_name, run_id),
            )
        )

    def find_tables(
        self,
        cluster_id: str,
        database_name: str,
        schema_name: str,
        min_frag_pct: float | None = None,
        has_stale_stats: bool = False,
        has_heap: bool = False,
        run_id: str | None = None,
    ) -> list[dict]:
        effective_run_id = run_id or self._find_latest_run_id(cluster_id, database_name)
        if effective_run_id is None:
            return []
        match = self._build_run_match(cluster_id, database_name, effective_run_id)
        if schema_name:
            match["schema_name"] = schema_name
        docs = list(
            self.collection.find(
                match
            )
        )
        result: list[dict] = []
        for doc in docs:
            payload = _strip_id(doc) or {}
            indexes = payload.get("indexes", [])
            stats = payload.get("statistics", [])
            max_frag = None
            for idx in indexes:
                frag = idx.get("fragmentation_pct")
                if frag is None:
                    continue
                max_frag = frag if max_frag is None else max(max_frag, frag)
            stale_count = sum(1 for stat in stats if int(stat.get("modification_counter") or 0) > 0)
            has_heap_issue = (payload.get("heap_forwarded_count") or 0) > 0
            if min_frag_pct is not None and (max_frag is None or max_frag < min_frag_pct):
                continue
            if has_stale_stats and stale_count <= 0:
                continue
            if has_heap and not has_heap_issue:
                continue
            result.append(
                {
                    "table_name": payload.get("table_name"),
                    "schema_name": payload.get("schema_name"),
                    "row_count": payload.get("row_count", 0),
                    "max_fragmentation_pct": max_frag,
                    "stale_stats_count": stale_count,
                    "has_heap_issue": has_heap_issue,
                    "captured_at": payload.get("captured_at"),
                    "run_id": payload.get("run_id"),
                }
            )
        return sorted(result, key=lambda item: (item["schema_name"], item["table_name"]))

    def find_table(
        self,
        cluster_id: str,
        database_name: str,
        schema_name: str,
        table_name: str,
        run_id: str | None = None,
    ) -> dict | None:
        effective_run_id = run_id or self._find_latest_run_id(cluster_id, database_name)
        if effective_run_id is None:
            return None
        match = self._build_run_match(cluster_id, database_name, effective_run_id)
        match["schema_name"] = schema_name
        match["table_name"] = table_name
        doc = self.collection.find_one(match)
        return _strip_id(doc)

    def find_for_campaign(
        self,
        cluster_id: str,
        scope: list[CampaignScopeDatabase] | None,
        execution_types: list[str],
    ) -> list[dict]:
        del execution_types
        or_conditions: list[dict[str, object]] = []
        latest_run_ids = self._find_latest_run_ids(cluster_id)
        if scope:
            for db_scope in scope:
                run_id = latest_run_ids.get(db_scope.database_name)
                if run_id is None:
                    continue
                for schema_scope in db_scope.schemas:
                    cond: dict[str, object] = {
                        **self._build_run_match(cluster_id, db_scope.database_name, run_id),
                        "schema_name": schema_scope.schema_name,
                    }
                    if schema_scope.table_names:
                        cond["table_name"] = {"$in": schema_scope.table_names}
                    or_conditions.append(cond)
        else:
            for database_name, run_id in latest_run_ids.items():
                or_conditions.append(
                    {
                        "cluster_id": cluster_id,
                        "database_name": database_name,
                        "run_id": run_id,
                    }
                )
        if not or_conditions:
            return []
        return [_strip_id(doc) or {} for doc in self.collection.find({"$or": or_conditions})]

    def get_status(self, cluster_id: str) -> dict[str, datetime | int | None]:
        docs = list(
            self.collection.aggregate(
                [
                    {"$match": {"cluster_id": cluster_id}},
                    {
                        "$group": {
                            "_id": "$run_id",
                            "last_run_at": {"$max": "$captured_at"},
                            "table_count": {"$sum": 1},
                        }
                    },
                    {"$sort": {"last_run_at": -1}},
                    {"$limit": 1},
                ]
            )
        )
        if not docs:
            return {"last_run_at": None, "table_count": 0}
        doc = docs[0]
        return {
            "last_run_at": doc.get("last_run_at"),
            "table_count": int(doc.get("table_count") or 0),
        }

    def list_runs(self, cluster_id: str, database_name: str) -> list[dict]:
        docs = list(
            self.collection.aggregate(
                [
                    {"$match": {"cluster_id": cluster_id, "database_name": database_name}},
                    {
                        "$group": {
                            "_id": "$run_id",
                            "captured_at": {"$max": "$captured_at"},
                            "table_count": {"$sum": 1},
                        }
                    },
                    {"$sort": {"captured_at": -1}},
                    {"$limit": 30},
                ]
            )
        )
        return [
            {
                "run_id": str(doc.get("_id") or LEGACY_RUN_ID),
                "captured_at": doc.get("captured_at"),
                "table_count": int(doc.get("table_count") or 0),
            }
            for doc in docs
        ]

    def _find_latest_run_id(self, cluster_id: str, database_name: str) -> str | None:
        doc = self.collection.find_one(
            {"cluster_id": cluster_id, "database_name": database_name},
            projection={"run_id": 1},
            sort=[("captured_at", -1)],
        )
        if doc is None:
            return None
        run_id = doc.get("run_id")
        return str(run_id) if run_id else LEGACY_RUN_ID

    def latest_run_ids(self, cluster_id: str) -> dict[str, str]:
        """run_id mới nhất per-database — public cho discovery phát hiện capture mới."""
        return self._find_latest_run_ids(cluster_id)

    def _find_latest_run_ids(self, cluster_id: str) -> dict[str, str]:
        docs = self.collection.aggregate(
            [
                {"$match": {"cluster_id": cluster_id}},
                {"$sort": {"captured_at": -1}},
                {
                    "$group": {
                        "_id": "$database_name",
                        "run_id": {"$first": "$run_id"},
                    }
                },
            ]
        )
        result: dict[str, str] = {}
        for doc in docs:
            database_name = doc.get("_id")
            run_id = doc.get("run_id")
            if database_name:
                result[str(database_name)] = str(run_id) if run_id else LEGACY_RUN_ID
        return result

    def _build_run_match(self, cluster_id: str, database_name: str, run_id: str) -> dict[str, object]:
        if run_id == LEGACY_RUN_ID:
            return {
                "cluster_id": cluster_id,
                "database_name": database_name,
                "$or": [
                    {"run_id": {"$exists": False}},
                    {"run_id": None},
                ],
            }
        return {
            "cluster_id": cluster_id,
            "database_name": database_name,
            "run_id": run_id,
        }
