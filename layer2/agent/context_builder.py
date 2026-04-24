"""
context_builder.py - Build system prompt and user message for Anthropic API.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..models.skill import AnalysisSkill
from .skill_loader import SkillLoader

logger = logging.getLogger(__name__)

_MAX_METRICS_CHARS = 3000


class ContextBuilder:
    """Build prompts from base YAML, skill YAML, and compact infrastructure context."""

    def __init__(self, skill_loader: SkillLoader) -> None:
        self._skill_loader = skill_loader

    def build_system_prompt(self, skill: AnalysisSkill) -> list[dict[str, Any]]:
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

        infra_note = self._get_compact_infrastructure_note()
        if infra_note:
            variable_parts.append(infra_note)

        if variable_parts:
            blocks.append({"type": "text", "text": "\n\n---\n\n".join(variable_parts)})

        logger.debug(
            "System prompt built skill=%s blocks=%d base_chars=%d variable_chars=%d",
            skill.skill_id,
            len(blocks),
            len(self._skill_loader.base_system_prompt or ""),
            len("\n\n---\n\n".join(variable_parts)) if variable_parts else 0,
        )
        return blocks

    def build_user_message(self, skill: AnalysisSkill, finding: dict[str, Any]) -> str:
        template = skill.user_prompt_template
        subs = _extract_substitutions(finding)
        try:
            rendered = template.format_map(_SafeDict(subs))
            logger.debug(
                "User prompt built skill=%s chars=%d metrics_chars=%d finding_id=%s",
                skill.skill_id,
                len(rendered),
                len(subs.get("metrics_json", "")),
                subs.get("finding_id", ""),
            )
            return rendered
        except Exception as exc:
            logger.warning("Template format failed: %s - returning raw template", exc)
            return template

    @staticmethod
    def _get_compact_infrastructure_note() -> str:
        return (
            "Infrastructure note:\n"
            "- AG running in 3-node topology with readable secondaries.\n"
            "- Resource Governor pools are enforced per workload group.\n"
            "- CDC is enabled for part of OLTP workload.\n"
            "- Dung get_table_context(table_name), get_plan_analysis(finding_id), "
            "get_query_structure(finding_id), va get_analysis_history(finding_id) khi can context chi tiet."
        )


def _extract_substitutions(finding: dict[str, Any]) -> dict[str, str]:
    metrics = finding.get("metrics") or {}

    detected_at = finding.get("detected_at", "")
    if hasattr(detected_at, "isoformat"):
        detected_at = detected_at.isoformat()

    metrics_str = json.dumps(metrics, ensure_ascii=False, indent=2, default=str)
    if len(metrics_str) > _MAX_METRICS_CHARS:
        metrics_str = metrics_str[:_MAX_METRICS_CHARS] + "\n... (truncated)"

    plan_patterns = finding.get("plan_patterns") or []
    plan_patterns_str = ", ".join(plan_patterns)

    return {
        "issue_type": str(finding.get("issue_type", "")),
        "severity": str(finding.get("severity", "")),
        "node": str(finding.get("node", "")),
        "role": str(finding.get("role", "")),
        "detected_at": str(detected_at),
        "metrics_json": metrics_str,
        "query_hash": str(finding.get("query_hash") or "(khong co)"),
        "finding_id": str(finding.get("finding_id", "")),
        "topic_id": str(finding.get("topic_id", "")),
        "plan_patterns": plan_patterns_str,
    }


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:  # noqa: ARG002
        return ""
