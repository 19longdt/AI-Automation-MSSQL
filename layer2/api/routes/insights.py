from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Query

from ...storage.repositories.insight_repo import InsightRepo
from ...utils.time_utils import now_vn

router = APIRouter(prefix="/api/v1", tags=["insights"])


@router.get("/insights")
async def list_insights(
    issue_type: str | None = Query(default=None),
    cluster_id: str | None = Query(default=None),
    table: str | None = Query(default=None),
    root_cause: str | None = Query(default=None),
    resolved: bool | None = Query(default=None),
    priority: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
) -> list[dict[str, Any]]:
    """List insights với filter tùy chọn."""
    repo = InsightRepo()
    return repo.list_insights(
        issue_type=issue_type,
        cluster_id=cluster_id,
        table=table,
        root_cause=root_cause,
        resolved=resolved,
        priority=priority,
        limit=limit,
    )


@router.get("/insights/summary")
async def get_summary(days: int = Query(default=30, ge=1, le=365)) -> dict[str, Any]:
    """Tổng hợp insights: top root causes, top tables, backlog."""
    repo = InsightRepo()
    since = now_vn() - timedelta(days=days)
    return repo.get_summary(since)
