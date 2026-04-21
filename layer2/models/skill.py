"""
skill.py — Pydantic model cho Analysis Skill được load từ YAML.

Skill định nghĩa cách agent phân tích một nhóm issue_type:
prompt specialization, danh sách tools ưu tiên, và giới hạn chạy.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class AnalysisSkill(BaseModel):
    """Đại diện cho 1 skill YAML sau khi được parse."""

    skill_id: str = Field(description="ID duy nhất, ví dụ: 'slow_query_v1'")
    issue_types: list[str] = Field(description="Danh sách issue_type mà skill này xử lý")

    specialization: str = Field(
        default="",
        description="Đoạn prompt bổ sung sau base_system_prompt — focus và checklist riêng",
    )
    user_prompt_template: str = Field(
        default="",
        description="Template cho user message — có {placeholders} từ Finding",
    )

    required_tools: list[str] = Field(
        default_factory=list,
        description="Tools agent phải gọi (ít nhất) trước khi kết luận",
    )
    optional_tools: list[str] = Field(
        default_factory=list,
        description="Tools agent có thể gọi thêm tùy context",
    )

    model: str | None = Field(
        default=None,
        description="Override model cho skill này. None = dùng settings.claude_model.",
    )
    max_tool_rounds: int = Field(
        default=6,
        description="Số round tối đa trong agentic loop (mỗi round = 1 Claude response)",
    )
    max_tokens: int = Field(
        default=4096,
        description="max_tokens cho Claude API call của skill này",
    )
    include_fields: list[str] = Field(
        default_factory=list,
        description="Fields từ Finding sẽ được inject vào user_prompt (ví dụ: query_plan_xml)",
    )
