from __future__ import annotations

import asyncio
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
    Nếu body.telegram_chat_id có → Layer 2 bot gửi kết quả trực tiếp qua Telegram.
    """
    logger.debug(
        "POST /api/v1/analyze start finding_id=%s channel=%s telegram_chat_id=%s follow_up=%s",
        body.finding_id,
        body.channel,
        body.telegram_chat_id,
        bool(body.follow_up_text),
    )
    orch = request.app.state.orchestrator
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, orch.run, body)
    logger.debug(
        "POST /api/v1/analyze done analysis_id=%s status=%s skill_id=%s cost=%.6f duration_ms=%s",
        result.analysis_id,
        result.status.value,
        result.skill_id,
        result.cost_usd,
        result.total_duration_ms,
    )

    if body.telegram_chat_id:
        bot = getattr(request.app.state, "telegram_bot", None)
        if bot is not None:
            logger.debug(
                "POST /api/v1/analyze sending telegram analysis_id=%s chat_id=%s",
                result.analysis_id,
                body.telegram_chat_id,
            )
            await loop.run_in_executor(None, bot.send_analysis_result, result, body.telegram_chat_id)
        else:
            logger.warning("trigger_analysis: telegram_chat_id set but TelegramBot not available")

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
