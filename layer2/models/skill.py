"""
skill.py - Pydantic model for analysis skills loaded from YAML.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class AnalysisSkill(BaseModel):
    """Runtime representation of one analysis skill."""

    skill_id: str = Field(description="Unique skill id, e.g. 'slow_sessions_v1'")
    issue_types: list[str] = Field(description="Issue types handled by this skill")

    specialization: str = Field(
        default="",
        description="Extra system-prompt guidance for this skill",
    )
    user_prompt_template: str = Field(
        default="",
        description="User prompt template populated from the finding document",
    )

    required_tools: list[str] = Field(
        default_factory=list,
        description="Tools that should be called before the agent concludes",
    )
    optional_tools: list[str] = Field(
        default_factory=list,
        description="Additional tools the agent may call when useful",
    )

    model: str | None = Field(
        default=None,
        description="Optional model override. None uses settings.claude_model.",
    )
    max_tool_rounds: int = Field(
        default=6,
        description="Maximum Claude/tool rounds in the agentic loop",
    )
    max_tokens: int = Field(
        default=4096,
        description="max_tokens for each Claude API call",
    )
    max_cost_usd: float = Field(
        default=0.10,
        description="Maximum budget in USD for one analysis run",
    )
    include_fields: list[str] = Field(
        default_factory=list,
        description="Finding fields injected into the user prompt",
    )
