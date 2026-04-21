"""
context_builder.py — Build system prompt và user message cho Anthropic API.

3-part system prompt:
  [1] base_system_prompt (_base.yaml)  → static block → prompt cache hit
  [2] skill.specialization             → nhỏ, per issue_type
  [3] db_context từ MongoDB            → schema, AG config, Resource Governor

User message: skill.user_prompt_template với placeholders từ Finding.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..models.skill import AnalysisSkill
from ..storage.repositories.db_context_repo import DbContextRepo
from .skill_loader import SkillLoader

logger = logging.getLogger(__name__)

_MAX_METRICS_CHARS = 3000
_MAX_PLAN_XML_CHARS = 20_000


class ContextBuilder:
    """Build prompts từ 3 nguồn: base YAML, skill YAML, db_context MongoDB."""

    def __init__(self, skill_loader: SkillLoader, db_context_repo: DbContextRepo) -> None:
        self._skill_loader = skill_loader
        self._db_context_repo = db_context_repo

    def build_system_prompt(self, skill: AnalysisSkill) -> list[dict[str, Any]]:
        """
        Trả về danh sách text blocks theo Anthropic API `system` format.

        Block 1 (cache_control=ephemeral): base_system_prompt — static, shared → prompt cache hit.
        Block 2: specialization + db_context — variable per skill/request.
        """
        blocks: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": self._skill_loader.base_system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ]

        variable_parts: list[str] = []

        if skill.specialization:
            variable_parts.append(skill.specialization.strip())

        db_ctx = self._db_context_repo.get()
        if db_ctx:
            variable_parts.append(_format_db_context(db_ctx))

        if variable_parts:
            blocks.append({"type": "text", "text": "\n\n---\n\n".join(variable_parts)})

        return blocks

    def build_user_message(self, skill: AnalysisSkill, finding: dict[str, Any]) -> str:
        """
        Điền placeholders trong skill.user_prompt_template từ finding dict.
        Keys không tồn tại hoặc None → thay bằng chuỗi rỗng.
        """
        template = skill.user_prompt_template
        subs = _extract_substitutions(skill, finding)
        try:
            return template.format_map(_SafeDict(subs))
        except Exception as exc:
            logger.warning("Template format failed: %s — trả về raw template", exc)
            return template


# ── Helpers ─────────────────────────────────────────────────────────────────────


def _extract_substitutions(skill: AnalysisSkill, finding: dict[str, Any]) -> dict[str, str]:
    """Build substitution dict cho user_prompt_template từ finding fields."""
    metrics = finding.get("metrics") or {}

    detected_at = finding.get("detected_at", "")
    if hasattr(detected_at, "isoformat"):
        detected_at = detected_at.isoformat()

    metrics_str = json.dumps(metrics, ensure_ascii=False, indent=2, default=str)
    if len(metrics_str) > _MAX_METRICS_CHARS:
        metrics_str = metrics_str[:_MAX_METRICS_CHARS] + "\n... (truncated)"

    query_text_raw = finding.get("query_text") or ""
    query_text = (
        f"\nQuery Text:\n```sql\n{query_text_raw}\n```" if query_text_raw else ""
    )

    query_plan_xml = ""
    if "query_plan_xml" in (skill.include_fields or []):
        xml = (
            finding.get("query_plan_xml")
            or metrics.get("query_plan_xml")
            or ""
        )
        if xml:
            if len(xml) > _MAX_PLAN_XML_CHARS:
                xml = xml[:_MAX_PLAN_XML_CHARS] + "\n... (truncated)"
            query_plan_xml = f"\nExecution Plan XML:\n```xml\n{xml}\n```"

    plan_patterns = finding.get("plan_patterns") or []
    plan_patterns_str = (
        "\nPlan Patterns Detected: " + ", ".join(plan_patterns) if plan_patterns else ""
    )

    return {
        "issue_type": str(finding.get("issue_type", "")),
        "severity": str(finding.get("severity", "")),
        "node": finding.get("node", ""),
        "role": finding.get("role", ""),
        "detected_at": str(detected_at),
        "metrics_json": metrics_str,
        "query_hash": finding.get("query_hash") or "(không có)",
        "query_text": query_text,
        "query_plan_xml": query_plan_xml,
        "plan_patterns": plan_patterns_str,
        "topic_id": finding.get("topic_id", ""),
    }


def _format_db_context(db_ctx: dict[str, Any]) -> str:
    """Convert db_context document thành text section cho system prompt."""
    parts = ["## Database Context"]

    schema_info = db_ctx.get("schema_info")
    if schema_info:
        parts.append("### Schema / Infrastructure")
        parts.append(json.dumps(schema_info, ensure_ascii=False, indent=2, default=str))

    business_ctx = db_ctx.get("business_context")
    if business_ctx:
        parts.append("### Business Context")
        if isinstance(business_ctx, dict):
            parts.append(json.dumps(business_ctx, ensure_ascii=False, indent=2, default=str))
        else:
            parts.append(str(business_ctx))

    collected_at = db_ctx.get("collected_at", "")
    if collected_at:
        parts.append(f"\n_Context collected at: {collected_at}_")

    return "\n\n".join(parts)


class _SafeDict(dict):
    """dict subclass cho format_map: key không tồn tại → '' thay vì KeyError."""

    def __missing__(self, key: str) -> str:  # noqa: ARG002
        return ""
