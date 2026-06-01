from __future__ import annotations

from typing import Annotated, Union

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ...analysis.base import ToolSnapshot
from ...analysis.plan.pipeline import PlanAnalysisOutput
from ...analysis.registry import PipelineRegistry
from ...analysis.types import AnalysisType
from ...plan.parser import PlanParseError

router = APIRouter(prefix="/api/v1/plan", tags=["plan-analysis"])

_SOURCE_LAYER1 = "layer1"


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

    if body.source == _SOURCE_LAYER1:
        return output.tool_snapshot

    return output
