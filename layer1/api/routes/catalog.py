from __future__ import annotations

from ...services.catalog_service import list_tables
from ..http import get_query_param


def register_catalog_routes(registry, runtime) -> None:
    def get_catalog_tables(req):
        cluster_id = get_query_param(req, "cluster_id").strip()
        database = get_query_param(req, "database").strip()
        schema = get_query_param(req, "schema").strip()

        if not cluster_id or not database or not schema:
            return 400, {"message": "cluster_id, database, schema required"}

        return list_tables(runtime, cluster_id, database, schema)

    registry.add("GET", "/catalog/tables", get_catalog_tables)
