from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from uuid import uuid4

from layer1.models.cluster import ClusterConfig

from ..config import MaintEnvSettings
from ..infra.cluster_reader import ClusterReader
from ..infra.mssql_connection import mssql_connection
from ..infra.time_utils import now_vn
from ..models.catalog import CatalogScopeDatabase
from ..repositories.catalog_config_repo import CatalogConfigRepo
from ..repositories.catalog_repo import CatalogRepo

logger = logging.getLogger(__name__)

_TABLE_LIST_SQL_TEMPLATE = """
SELECT
  s.name AS schema_name,
  t.name AS table_name,
  t.object_id,
  CAST(SUM(CASE WHEN a.type = 1 THEN p.row_count ELSE 0 END) AS BIGINT) AS row_count,
  CAST(SUM(a.total_pages) * 8 AS BIGINT) AS reserved_kb,
  CAST(SUM(a.data_pages) * 8 AS BIGINT) AS data_kb,
  CAST((SUM(a.used_pages) - SUM(a.data_pages)) * 8 AS BIGINT) AS index_kb
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.dm_db_partition_stats p
  ON p.object_id = t.object_id AND p.index_id IN (0, 1)
JOIN sys.allocation_units a ON a.container_id = p.partition_id
WHERE t.is_ms_shipped = 0
  AND ({scope_filter})
GROUP BY s.name, t.name, t.object_id
ORDER BY s.name, t.name
"""

_INDEX_SQL = """
SELECT
  i.index_id,
  i.name AS index_name,
  i.type_desc AS index_type,
  i.is_unique,
  ips.partition_number,
  ips.avg_fragmentation_in_percent AS fragmentation_pct,
  ips.page_count,
  (SELECT COUNT(*) FROM sys.partitions p2
   WHERE p2.object_id = i.object_id AND p2.index_id = i.index_id) AS partition_count
FROM sys.indexes i
CROSS APPLY sys.dm_db_index_physical_stats(DB_ID(), ?, i.index_id, NULL, 'SAMPLED') ips
WHERE i.object_id = ?
  AND (ips.alloc_unit_type_desc = 'IN_ROW_DATA' OR ips.alloc_unit_type_desc IS NULL)
ORDER BY i.index_id, ips.partition_number
"""

_STATS_SQL = """
SELECT
  stat.stats_id,
  stat.name AS stats_name,
  stat.auto_created,
  sp.last_updated,
  sp.rows,
  sp.rows_sampled,
  sp.modification_counter
FROM sys.stats stat
CROSS APPLY sys.dm_db_stats_properties(stat.object_id, stat.stats_id) sp
WHERE stat.object_id = ?
"""

_HEAP_SQL = """
SELECT
  ps.forwarded_record_count
FROM sys.dm_db_index_physical_stats(DB_ID(), ?, 0, NULL, 'SAMPLED') ps
WHERE ps.index_type_desc = 'HEAP'
"""


class CatalogService:
    def __init__(
        self,
        cluster: ClusterConfig,
        cluster_reader: ClusterReader,
        config_repo: CatalogConfigRepo,
        catalog_repo: CatalogRepo,
        settings: MaintEnvSettings,
    ) -> None:
        self._cluster = cluster
        self._cluster_reader = cluster_reader
        self._config_repo = config_repo
        self._catalog_repo = catalog_repo
        self._settings = settings

    def run(self) -> int:
        return self.run_with_scope(None)

    def run_with_scope(self, scope_override: list[CatalogScopeDatabase] | None) -> int:
        if scope_override is not None:
            databases = scope_override
        else:
            config = self._config_repo.find_by_cluster(self._cluster.cluster_id)
            if config is None:
                logger.info("Catalog skip: no scope config for cluster=%s", self._cluster.cluster_id)
                return 0
            if not config.enabled:
                logger.info("Catalog skip: disabled for cluster=%s", self._cluster.cluster_id)
                return 0
            databases = config.databases

        host = self._get_primary_host()
        if host is None:
            logger.warning("Catalog skip: no primary found for cluster=%s", self._cluster.cluster_id)
            return 0

        total = 0
        run_id = uuid4().hex[:16]
        for db_scope in databases:
            total += self._run_database(host, db_scope, run_id)
        return total

    def _get_primary_host(self) -> str | None:
        fresh = self._cluster_reader.find_by_id(self._cluster.cluster_id)
        if fresh is not None:
            self._cluster = fresh
        for node_role in self._cluster.node_roles:
            if str(node_role.role).lower() == "primary":
                return node_role.host
        return None

    def _run_database(self, host: str, db_scope: CatalogScopeDatabase, run_id: str) -> int:
        conn_str = self._cluster.get_connection_string(host, database=db_scope.database_name)
        tables = self._collect_table_list(host, conn_str, db_scope)
        if not tables:
            return 0

        docs: list[dict] = []
        with ThreadPoolExecutor(max_workers=self._settings.maint_catalog_max_workers) as executor:
            futures = {
                executor.submit(self._collect_table_detail, host, conn_str, table_row, run_id): table_row
                for table_row in tables
            }
            for future in as_completed(futures):
                table_row = futures[future]
                try:
                    doc = future.result(timeout=self._settings.maint_catalog_table_timeout_sec)
                except Exception as exc:
                    logger.warning(
                        "Catalog skip table %s.%s.%s: %s",
                        db_scope.database_name,
                        table_row["schema_name"],
                        table_row["table_name"],
                        exc,
                    )
                    continue
                if doc:
                    docs.append(doc)

        if docs:
            self._catalog_repo.upsert_batch(self._cluster.cluster_id, db_scope.database_name, docs)
        return len(docs)

    def _collect_table_list(self, host: str, conn_str: str, db_scope: CatalogScopeDatabase) -> list[dict]:
        # Build per-schema exact conditions to avoid cross-schema table name leakage.
        # e.g. (s.name='dbo' AND t.name IN ('bill')) OR (s.name='audit' AND t.name IN ('bill_aud'))
        conditions: list[str] = []
        params: list[object] = []
        for schema in db_scope.schemas:
            if schema.table_names:
                placeholders = ", ".join("?" for _ in schema.table_names)
                conditions.append(f"(s.name = ? AND t.name IN ({placeholders}))")
                params.append(schema.schema_name)
                params.extend(schema.table_names)
            else:
                conditions.append("s.name = ?")
                params.append(schema.schema_name)

        sql = _TABLE_LIST_SQL_TEMPLATE.format(scope_filter=" OR ".join(conditions))
        with mssql_connection(host, conn_str, timeout_sec=self._settings.mssql_query_timeout_sec) as conn:
            rows = conn.execute(sql, *params).fetchall()
        return [
            {
                "schema_name": row.schema_name,
                "table_name": row.table_name,
                "object_id": int(row.object_id),
                "row_count": int(row.row_count or 0),
                "reserved_kb": int(row.reserved_kb or 0),
                "data_kb": int(row.data_kb or 0),
                "index_kb": int(row.index_kb or 0),
            }
            for row in rows
        ]

    def _collect_table_detail(self, host: str, conn_str: str, table_row: dict, run_id: str) -> dict:
        object_id = int(table_row["object_id"])
        indexes = self._query_indexes(host, conn_str, object_id)
        stats = self._query_stats(host, conn_str, object_id)
        heap_forwarded_count = None
        if any(str(idx.get("index_type", "")).upper() == "HEAP" for idx in indexes):
            heap_forwarded_count = self._query_heap(host, conn_str, object_id)
        return {
            **table_row,
            "run_id": run_id,
            "indexes": indexes,
            "statistics": stats,
            "heap_forwarded_count": heap_forwarded_count,
            "captured_at": now_vn(),
        }

    def _query_indexes(self, host: str, conn_str: str, object_id: int) -> list[dict]:
        with mssql_connection(host, conn_str, timeout_sec=self._settings.maint_catalog_table_timeout_sec) as conn:
            rows = conn.execute(_INDEX_SQL, object_id, object_id).fetchall()
        grouped: dict[int, dict] = {}
        for row in rows:
            index_id = int(row.index_id)
            partition_count = int(row.partition_count or 1)
            is_partitioned = partition_count > 1
            fragmentation_pct = float(row.fragmentation_pct) if row.fragmentation_pct is not None else None
            page_count = int(row.page_count) if row.page_count is not None else None

            payload = grouped.get(index_id)
            if payload is None:
                payload = {
                    "index_id": index_id,
                    "index_name": row.index_name,
                    "index_type": str(row.index_type),
                    "is_unique": bool(row.is_unique),
                    "is_partitioned": is_partitioned,
                    "fragmentation_pct": fragmentation_pct,
                    "page_count": page_count or 0,
                    "partition_count": partition_count,
                    "partitions": [],
                }
                grouped[index_id] = payload
            else:
                current_frag = payload.get("fragmentation_pct")
                if fragmentation_pct is not None:
                    payload["fragmentation_pct"] = (
                        fragmentation_pct
                        if current_frag is None
                        else max(float(current_frag), fragmentation_pct)
                    )
                payload["page_count"] = int(payload.get("page_count") or 0) + int(page_count or 0)
                payload["partition_count"] = max(int(payload.get("partition_count") or 1), partition_count)
                payload["is_partitioned"] = bool(payload.get("is_partitioned")) or is_partitioned

            if is_partitioned:
                payload["partitions"].append(
                    {
                        "partition_number": int(row.partition_number or 1),
                        "fragmentation_pct": fragmentation_pct,
                        "page_count": page_count,
                    }
                )

        result = list(grouped.values())
        for item in result:
            if not item["is_partitioned"]:
                item["partitions"] = []
            elif item["page_count"] == 0:
                item["page_count"] = None
        return result

    def _query_stats(self, host: str, conn_str: str, object_id: int) -> list[dict]:
        with mssql_connection(host, conn_str, timeout_sec=self._settings.maint_catalog_table_timeout_sec) as conn:
            rows = conn.execute(_STATS_SQL, object_id).fetchall()
        return [
            {
                "stats_id": int(row.stats_id),
                "stats_name": str(row.stats_name),
                "last_updated": row.last_updated,
                "rows": int(row.rows or 0),
                "rows_sampled": int(row.rows_sampled or 0),
                "modification_counter": int(row.modification_counter or 0),
                "auto_created": bool(row.auto_created),
            }
            for row in rows
        ]

    def _query_heap(self, host: str, conn_str: str, object_id: int) -> int | None:
        with mssql_connection(host, conn_str, timeout_sec=self._settings.maint_catalog_table_timeout_sec) as conn:
            row = conn.execute(_HEAP_SQL, object_id).fetchone()
        if row is None:
            return None
        return int(row.forwarded_record_count or 0)
