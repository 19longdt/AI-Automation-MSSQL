from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ...plan.models.result import PlanAnalysisResult
from ...plan.parser import PlanParseError
from ...plan.service import PlanAnalysisService

router = APIRouter(prefix="/api/v1/plan", tags=["plan-analysis"])


class PlanAnalyzeRequest(BaseModel):
    plan_xml: str
    source: str = "unknown"


@router.post("/analyze", response_model=PlanAnalysisResult)
async def analyze_plan(request: Request, body: PlanAnalyzeRequest) -> PlanAnalysisResult:
    if not body.plan_xml or not body.plan_xml.strip():
        raise HTTPException(status_code=400, detail="plan_xml khong duoc de trong")

    service: PlanAnalysisService = request.app.state.plan_analysis_service
    try:
        return service.analyze(body.plan_xml)
    except PlanParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
