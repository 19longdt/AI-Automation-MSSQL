from __future__ import annotations

import asyncio
import concurrent.futures
import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request

from ...models.analysis import AnalysisRequest, AnalysisResult
from ...storage.repositories.analysis_repo import AnalysisRepo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["analysis"])


@router.post("/analyze", response_model=AnalysisResult)
async def trigger_analysis(request: Request, body: AnalysisRequest) -> AnalysisResult:
    """
    Trigger on-demand analysis cho 1 finding.
    Blocking — chờ đến khi analysis hoàn tất (có thể 30–90s).
    """
    orch = request.app.state.orchestrator
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        result = await loop.run_in_executor(pool, orch.run, body)
    return result


@router.get("/analyses/{analysis_id}", response_model=AnalysisResult)
async def get_analysis(analysis_id: str) -> AnalysisResult:
    """Lấy kết quả của 1 analysis theo ID."""
    repo = AnalysisRepo()
    result = repo.find_by_id(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' không tìm thấy.")
    return result


@router.get("/analyses", response_model=list[AnalysisResult])
async def list_analyses(
    issue_type: str | None = Query(default=None),
    node: str | None = Query(default=None),
    status: str | None = Query(default=None),
    since: datetime | None = Query(default=None),
    limit: int = Query(default=50, le=200),
) -> list[AnalysisResult]:
    """List analyses với filter tùy chọn."""
    repo = AnalysisRepo()
    return repo.list_recent(issue_type=issue_type, node=node, status=status, since=since, limit=limit)
