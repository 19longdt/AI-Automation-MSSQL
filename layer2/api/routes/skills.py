from __future__ import annotations

from fastapi import APIRouter, Request

from ...models.skill import AnalysisSkill

router = APIRouter(prefix="/api/v1", tags=["skills"])


@router.get("/skills", response_model=list[AnalysisSkill])
async def list_skills(request: Request) -> list[AnalysisSkill]:
    """List tất cả skills đã load và issue_type mapping."""
    return request.app.state.skill_loader.list_skills()


@router.get("/skills/mapping")
async def get_mapping(request: Request) -> dict[str, str]:
    """issue_type → skill_id mapping — dùng để debug."""
    return request.app.state.skill_loader.get_issue_type_mapping()
