from __future__ import annotations

import logging

import pyodbc

from ..executor.mssql_connection import mssql_connection

logger = logging.getLogger(__name__)

_LIST_TABLES_SQL = """
SELECT t.name AS table_name
FROM sys.tables t
JOIN sys.schemas s
  ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0
  AND s.name = ?
ORDER BY t.name
"""


def list_tables(runtime, cluster_id: str, database: str, schema: str) -> tuple[int, dict]:
    cluster = runtime.service.get_cluster_config(cluster_id)
    if cluster is None:
        return 404, {"message": "Cluster not found"}

    role_cache = runtime.service.get_node_role_cache(cluster_id)
    if role_cache is None:
        return 404, {"message": "Cluster runtime not active"}

    primary_hosts = role_cache.resolve(["primary"])
    if not primary_hosts:
        return 503, {"message": "Primary node not available"}

    primary_host = primary_hosts[0][0]
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={primary_host},{cluster.port};"
        f"DATABASE={database};"
        f"UID={cluster.username};"
        f"PWD={cluster.password};"
        f"TrustServerCertificate=yes;"
        f"Connection Timeout={cluster.connect_timeout_sec};"
    )

    try:
        with mssql_connection(primary_host, conn_str=conn_str, timeout_sec=10) as conn:
            rows = conn.execute(_LIST_TABLES_SQL, schema).fetchall()
        return 200, {"tables": [str(row.table_name) for row in rows]}
    except pyodbc.Error as exc:
        logger.warning(
            "Live catalog table query failed: cluster=%s host=%s database=%s schema=%s error=%s",
            cluster_id,
            primary_host,
            database,
            schema,
            exc,
        )
        return 503, {"message": "SQL Server unreachable", "error": str(exc)}
