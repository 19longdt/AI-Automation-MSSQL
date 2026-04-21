"""
admin.py — Admin endpoints cho Layer 2.

POST /admin/refresh-db-context:
  Thu thập schema info từ MSSQL + load db_business_context.yaml,
  upsert vào MongoDB db_context collection.
  Gọi lần đầu sau khi deploy, hoặc khi schema thay đổi lớn.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request

from ...executor.mssql_connection import mssql_connection
from ...storage.repositories.db_context_repo import DbContextRepo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

_BUSINESS_CONTEXT_FILE = Path(__file__).parent.parent.parent / "db_business_context.yaml"

_SCHEMA_SQL = """
SELECT TOP (?)
    t.name                                          AS table_name,
    s.name                                          AS schema_name,
    p.rows                                          AS row_count,
    CAST(SUM(a.total_pages) * 8.0 / 1024 AS INT)   AS size_mb,
    COUNT(i.index_id) - 1                           AS index_count
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.indexes i ON t.object_id = i.object_id
JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE t.is_ms_shipped = 0
GROUP BY t.name, s.name, p.rows
ORDER BY p.rows DESC
"""


@router.post("/refresh-db-context")
async def refresh_db_context(request: Request) -> dict[str, Any]:
    """
    Thu thập schema info từ Primary node + load db_business_context.yaml.
    Upsert vào MongoDB db_context.
    """
    nrc = request.app.state.node_role_cache
    primary = nrc.get_primary_host()
    if not primary:
        raise HTTPException(status_code=503, detail="Không xác định được Primary node.")

    from ...config import settings

    # Collect schema từ MSSQL
    schema_info: dict[str, Any] = {}
    try:
        with mssql_connection(primary) as conn:
            rows = conn.execute(_SCHEMA_SQL, settings.db_context_max_tables).fetchall()
            cols = [c[0] for c in rows[0].cursor_description] if rows else []
            schema_info["tables"] = [dict(zip(cols, row)) for row in rows]
            schema_info["primary_node"] = primary
            schema_info["ag_nodes"] = nrc.get_all_hosts()
        logger.info("Schema collected: %d tables from %s", len(schema_info.get("tables", [])), primary)
    except Exception as exc:
        logger.warning("Schema collection failed: %s — tiếp tục với schema_info rỗng", exc)
        schema_info = {"error": str(exc)}

    # Load business context từ YAML (DBA viết thủ công)
    business_context: dict[str, Any] = {}
    if _BUSINESS_CONTEXT_FILE.exists():
        try:
            with _BUSINESS_CONTEXT_FILE.open(encoding="utf-8") as f:
                business_context = yaml.safe_load(f) or {}
            logger.info("Business context loaded from %s", _BUSINESS_CONTEXT_FILE.name)
        except Exception as exc:
            logger.warning("Load business context failed: %s", exc)
    else:
        logger.info("db_business_context.yaml không tìm thấy — bỏ qua.")

    repo = DbContextRepo()
    repo.upsert(schema_info=schema_info, business_context=business_context)

    return {
        "status": "ok",
        "primary_node": primary,
        "tables_collected": len(schema_info.get("tables", [])),
        "business_context_loaded": bool(business_context),
    }


@router.get("/db-context")
async def get_db_context() -> dict[str, Any]:
    """Xem db_context hiện tại đang được dùng."""
    repo = DbContextRepo()
    ctx = repo.get()
    if not ctx:
        raise HTTPException(status_code=404, detail="db_context chưa được collect. Gọi POST /admin/refresh-db-context trước.")
    return ctx
