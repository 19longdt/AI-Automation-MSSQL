from __future__ import annotations

import logging
from typing import Annotated, Union

import pyodbc
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ...analysis.base import ToolSnapshot
from ...analysis.plan.pipeline import PlanAnalysisOutput
from ...analysis.registry import PipelineRegistry
from ...analysis.types import AnalysisType
from ...executor.mssql_connection import mssql_connection
from ...executor.node_role_cache import NodeRoleCache
from ...plan.parser import PlanParseError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/plan", tags=["plan-analysis"])

_SOURCE_LAYER1 = "layer1"

# SQL lấy full statement text từ plan cache (dùng statement offsets để tách đúng statement trong batch)
_SQL_FULL_TEXT_PLAN_CACHE = """
SELECT TOP 1
    SUBSTRING(
        st.text,
        (qs.statement_start_offset / 2) + 1,
        CASE WHEN qs.statement_end_offset = -1
             THEN LEN(CONVERT(nvarchar(max), st.text))
             ELSE (qs.statement_end_offset - qs.statement_start_offset) / 2 + 1
        END
    ) AS stmt_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
WHERE qs.query_hash = CONVERT(binary(8), ?, 1)
ORDER BY qs.last_execution_time DESC
"""

# SQL lấy từ Query Store (đầy đủ hơn, không bị 4000 char limit)
_SQL_FULL_TEXT_QUERY_STORE = """
SELECT TOP 1 qt.query_sql_text
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE q.query_hash = CONVERT(binary(8), ?, 1)
ORDER BY q.last_execution_time DESC
"""


def _fetch_full_text(host: str, query_hash: str) -> str | None:
    """Fetch full statement text từ Query Store, fallback sang plan cache."""
    try:
        with mssql_connection(host, timeout_sec=5) as conn:
            cur = conn.cursor()
            # Thử Query Store trước
            try:
                cur.execute(_SQL_FULL_TEXT_QUERY_STORE, (query_hash,))
                row = cur.fetchone()
                if row and row[0]:
                    return str(row[0]).strip()
            except pyodbc.Error:
                pass  # Query Store có thể không enabled

            # Fallback: plan cache
            cur.execute(_SQL_FULL_TEXT_PLAN_CACHE, (query_hash,))
            row = cur.fetchone()
            if row and row[0]:
                return str(row[0]).strip()
    except Exception as exc:
        logger.debug("_fetch_full_text failed for hash=%s: %s", query_hash, exc)
    return None


class PlanAnalyzeRequest(BaseModel):
    plan_xml: str
    source: Annotated[str, Field(default="ui")]


@router.post(
    "/analyze",
    response_model=Union[ToolSnapshot, PlanAnalysisOutput],
    response_model_exclude_none=True,
)
async def analyze_plan(
    request: Request,
    body: PlanAnalyzeRequest,
) -> ToolSnapshot | PlanAnalysisOutput:
    """Phân tích XML execution plan.

    source="ui" (default) → PlanAnalysisOutput — full data cho Layer 3.
    source="layer1"       → ToolSnapshot — compact, AI-ready, Layer 1 lưu trực tiếp.
    """
    if not body.plan_xml or not body.plan_xml.strip():
        raise HTTPException(status_code=400, detail="plan_xml khong duoc de trong")

    registry: PipelineRegistry = request.app.state.pipeline_registry
    try:
        output: PlanAnalysisOutput = registry.run(AnalysisType.PLAN_XML, body.plan_xml)  # type: ignore[assignment]
    except PlanParseError as exc:
        if body.source == _SOURCE_LAYER1:
            return ToolSnapshot.from_error(str(exc))
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Enrich truncated statement texts từ DB nếu có thể
    _enrich_truncated_texts(output, request.app.state.node_role_cache)

    if body.source == _SOURCE_LAYER1:
        return output.tool_snapshot

    return output


def _enrich_truncated_texts(output: PlanAnalysisOutput, nrc: NodeRoleCache) -> None:
    """Với mỗi statement bị truncated, thử fetch full text từ primary node."""
    truncated = [s for s in output.statements if s.statement_text_truncated and s.query_hash]
    if not truncated:
        return

    host = nrc.get_primary_host()
    if not host:
        logger.debug("_enrich_truncated_texts: no primary host available")
        return

    for stmt in truncated:
        full = _fetch_full_text(host, stmt.query_hash)  # type: ignore[arg-type]
        if full and len(full) > len(stmt.statement_text):
            stmt.statement_text = full
            stmt.statement_text_truncated = False
            logger.debug("Enriched statement text via DB (hash=%s, len=%d)", stmt.query_hash, len(full))
