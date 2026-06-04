"""
orchestrator.py - Main agentic loop for Layer 2 AI analysis.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import anthropic

from ..config import settings
from ..models.analysis import (
    AnalysisRequest,
    AnalysisResult,
    AnalysisStatus,
    InsightAction,
    InsightData,
    ToolCallRecord,
)
from ..models.skill import AnalysisSkill
from ..storage.mongo_client import MongoConnection
from ..storage.repositories.analysis_repo import AnalysisRepo
from ..storage.repositories.insight_repo import InsightRepo
from ..storage.repositories.session_repo import SessionRepo
from ..utils.cost_calculator import calculate_cost
from ..utils.time_utils import now_vn
from .context_builder import ContextBuilder
from .skill_loader import SkillLoader
from .tool_executor import ToolExecutor
from .tool_registry import build_tools_for_skill

logger = logging.getLogger(__name__)

_INSIGHT_RE = re.compile(r"<\s*insight\s*>(.*?)<\s*/\s*insight\s*>", re.IGNORECASE | re.DOTALL)
_INSIGHT_ESCAPED_RE = re.compile(
    r"&lt;\s*insight\s*&gt;(.*?)&lt;\s*/\s*insight\s*&gt;",
    re.IGNORECASE | re.DOTALL,
)
_INSIGHT_JSON_FALLBACK_RE = re.compile(
    r"(\{[\s\S]*?\"root_cause_category\"[\s\S]*?\"actions\"[\s\S]*?\})",
    re.IGNORECASE,
)
_FINDINGS_COLLECTION = "findings"


class AgentOrchestrator:
    """Coordinates one end-to-end analysis run."""

    def __init__(
        self,
        skill_loader: SkillLoader,
        context_builder: ContextBuilder,
        tool_executor: ToolExecutor,
    ) -> None:
        self._skill_loader = skill_loader
        self._context_builder = context_builder
        self._tool_executor = tool_executor
        self._analysis_repo = AnalysisRepo()
        self._insight_repo = InsightRepo()
        self._session_repo = SessionRepo()
        self._client = anthropic.Anthropic(api_key=settings.claude_api_key)

    def run(self, request: AnalysisRequest) -> AnalysisResult:
        result = AnalysisResult(finding_id=request.finding_id)
        logger.debug(
            "Run requested finding_id=%s channel=%s requested_by=%s follow_up=%s telegram_msg_id=%s",
            request.finding_id,
            request.channel,
            request.requested_by,
            bool(request.follow_up_text),
            request.telegram_message_id,
        )
        try:
            self._execute(request, result)
        except Exception as exc:
            logger.error(
                "Orchestrator unhandled error analysis_id=%s finding_id=%s: %s",
                result.analysis_id, request.finding_id, exc, exc_info=True,
            )
            result.status = AnalysisStatus.FAILED
            result.error = str(exc)
            result.completed_at = now_vn()
            try:
                self._analysis_repo.update_completed(result)
            except Exception:
                pass
        return result

    def _execute(self, request: AnalysisRequest, result: AnalysisResult) -> None:
        wall_start = time.monotonic()

        finding = _load_finding(request.finding_id)
        result.finding_snapshot = finding
        logger.debug(
            "Finding loaded analysis_id=%s finding_id=%s issue_type=%s node=%s keys=%s",
            result.analysis_id,
            request.finding_id,
            finding.get("issue_type", ""),
            finding.get("node", ""),
            sorted(finding.keys()),
        )

        issue_type = str(finding.get("issue_type", ""))
        node = finding.get("node", "")
        detected_at = finding.get("detected_at") or now_vn()

        skill = self._skill_loader.get_skill(issue_type)
        result.skill_id = skill.skill_id
        result.model = skill.model or settings.claude_model
        logger.debug(
            "Skill selected analysis_id=%s skill_id=%s required_tools=%s optional_tools=%s max_rounds=%d max_tokens=%d budget=%.4f",
            result.analysis_id,
            skill.skill_id,
            skill.required_tools,
            skill.optional_tools,
            skill.max_tool_rounds,
            skill.max_tokens,
            skill.max_cost_usd,
        )

        result.status = AnalysisStatus.RUNNING
        self._analysis_repo.insert(result)
        logger.info(
            "Analysis started analysis_id=%s finding_id=%s skill=%s model=%s node=%s",
            result.analysis_id, request.finding_id, skill.skill_id, result.model, node,
        )

        system = self._context_builder.build_system_prompt(skill)
        messages, session = self._build_messages(request, skill, finding)
        logger.debug(
            "Prompt built analysis_id=%s system_blocks=%d system_chars=%d messages=%d message_chars=%d session_reused=%s",
            result.analysis_id,
            len(system),
            _total_system_chars(system),
            len(messages),
            _total_message_chars(messages),
            bool(session),
        )

        is_follow_up = bool(session)
        self._agentic_loop(result, skill, system, messages, is_follow_up=is_follow_up)
        logger.debug(
            "Agentic loop finished analysis_id=%s status=%s tool_calls=%d analysis_chars=%d",
            result.analysis_id,
            result.status.value,
            len(result.tool_calls),
            len(result.analysis_text or ""),
        )

        insight = _extract_insight(result)
        if insight is None and result.analysis_text and result.status == AnalysisStatus.COMPLETED:
            insight = self._retry_missing_insight(result, skill, system, messages)

        if insight:
            logger.debug(
                "Insight parsed analysis_id=%s category=%s actions=%d systemic=%s",
                result.analysis_id,
                insight.root_cause_category,
                len(insight.actions),
                insight.systemic,
            )
            result.root_cause_summary = insight.root_cause_summary
            high_priority = [a.description for a in insight.actions if a.priority == "high"]
            result.top_actions = high_priority[:2] if high_priority else [a.description for a in insight.actions[:2]]
        else:
            logger.debug("Insight absent analysis_id=%s", result.analysis_id)

        result.cost_usd = calculate_cost(
            result.model,
            result.input_tokens,
            result.output_tokens,
            result.cache_read_tokens,
            result.cache_creation_tokens,
        )

        if insight:
            try:
                self._insight_repo.upsert(
                    analysis_id=result.analysis_id,
                    finding_id=request.finding_id,
                    issue_type=issue_type,
                    node=node,
                    detected_at=detected_at,
                    insight=insight,
                )
                logger.debug("Insight upserted analysis_id=%s", result.analysis_id)
            except Exception as exc:
                logger.error("InsightRepo.upsert failed analysis_id=%s: %s", result.analysis_id, exc)

        result.total_duration_ms = int((time.monotonic() - wall_start) * 1000)
        result.completed_at = now_vn()
        self._analysis_repo.update_completed(result)

        logger.info(
            "Analysis done analysis_id=%s status=%s cost_usd=%.6f duration_ms=%d tokens(in=%d out=%d cache_r=%d cache_w=%d)",
            result.analysis_id, result.status.value, result.cost_usd, result.total_duration_ms,
            result.input_tokens, result.output_tokens, result.cache_read_tokens, result.cache_creation_tokens,
        )


    def _agentic_loop(
        self,
        result: AnalysisResult,
        skill: AnalysisSkill,
        system: list[dict],
        messages: list[dict],
        is_follow_up: bool = False,
    ) -> None:
        remaining_rounds = skill.max_tool_rounds
        skill_tools = build_tools_for_skill(skill)
        loop_start = time.monotonic()
        budget_exceeded = False
        grace_tool_rounds = 0
        round_no = 0

        while True:
            round_no += 1
            elapsed = time.monotonic() - loop_start
            if elapsed > settings.agent_timeout_sec:
                logger.warning("Agent timeout %.1fs analysis_id=%s", elapsed, result.analysis_id)
                result.status = AnalysisStatus.TIMEOUT
                result.error = f"Timeout sau {elapsed:.0f}s (limit={settings.agent_timeout_sec}s)"
                return

            call_kwargs: dict[str, Any] = {
                "model": skill.model or settings.claude_model,
                "max_tokens": skill.max_tokens,
                "system": system,
                "messages": messages,
            }
            tools_allowed = (
                remaining_rounds > 0
                and skill_tools
                and (not budget_exceeded or grace_tool_rounds > 0)
            )
            if tools_allowed:
                call_kwargs["tools"] = skill_tools
            logger.debug(
                "Loop round analysis_id=%s round=%d tools_allowed=%s remaining_rounds=%d grace_tool_rounds=%d messages=%d",
                result.analysis_id,
                round_no,
                tools_allowed,
                remaining_rounds,
                grace_tool_rounds,
                len(messages),
            )

            response = self._client.messages.create(**call_kwargs)
            usage = response.usage
            result.input_tokens += usage.input_tokens
            result.output_tokens += usage.output_tokens
            result.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0)
            result.cache_creation_tokens += getattr(usage, "cache_creation_input_tokens", 0)
            logger.debug(
                "Claude response analysis_id=%s round=%d stop_reason=%s usage(in=%d out=%d cache_r=%d cache_w=%d)",
                result.analysis_id,
                round_no,
                response.stop_reason,
                usage.input_tokens,
                usage.output_tokens,
                getattr(usage, "cache_read_input_tokens", 0),
                getattr(usage, "cache_creation_input_tokens", 0),
            )

            current_cost = calculate_cost(
                result.model,
                result.input_tokens,
                result.output_tokens,
                result.cache_read_tokens,
                result.cache_creation_tokens,
            )
            if current_cost > skill.max_cost_usd and not budget_exceeded:
                logger.warning(
                    "Cost budget exceeded analysis_id=%s current=$%.4f budget=$%.4f; allowing one final tool round",
                    result.analysis_id, current_cost, skill.max_cost_usd,
                )
                budget_exceeded = True
                grace_tool_rounds = 1

            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "max_tokens":
                result.analysis_text = _extract_text_blocks(response.content)
                result.status = AnalysisStatus.COMPLETED
                logger.warning(
                    "Response truncated at max_tokens analysis_id=%s round=%d chars=%d — insight likely missing",
                    result.analysis_id, round_no, len(result.analysis_text or ""),
                )
                return

            if response.stop_reason != "tool_use":
                if not is_follow_up:
                    missing = self._get_missing_required_tools(skill, result)
                    logger.debug(
                        "Assistant end_turn analysis_id=%s round=%d missing_required=%s",
                        result.analysis_id,
                        round_no,
                        sorted(missing),
                    )
                    if missing and remaining_rounds > 0 and tools_allowed:
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    "Ban chua goi cac tools bat buoc sau: "
                                    + ", ".join(sorted(missing))
                                    + ". Hay goi chung truoc khi ket luan."
                                ),
                            }
                        )
                        remaining_rounds = 1
                        continue
                    if missing and budget_exceeded:
                        logger.warning(
                            "Budget exceeded with missing required tools analysis_id=%s missing=%s",
                            result.analysis_id, sorted(missing),
                        )

                result.analysis_text = _extract_text_blocks(response.content)
                result.status = AnalysisStatus.COMPLETED
                logger.info(
                    "Analysis text extracted analysis_id=%s chars=%d is_follow_up=%s preview=%r",
                    result.analysis_id,
                    len(result.analysis_text or ""),
                    is_follow_up,
                    (result.analysis_text or "")[:300],
                )
                return

            remaining_rounds -= 1
            if budget_exceeded and grace_tool_rounds > 0:
                grace_tool_rounds -= 1
            tool_results: list[dict[str, Any]] = []
            for block in response.content:
                if not hasattr(block, "type") or block.type != "tool_use":
                    continue
                tool_input = dict(getattr(block, "input", {}))
                logger.info(
                    "Tool call analysis_id=%s round=%d tool=%s params=%s",
                    result.analysis_id,
                    round_no,
                    getattr(block, "name", ""),
                    json.dumps(tool_input, ensure_ascii=False, default=str),
                )
                record, serialized = self._execute_one_tool(block)
                result.tool_calls.append(record)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": serialized,
                    }
                )

            messages.append({"role": "user", "content": tool_results})
            logger.debug(
                "Tool results appended analysis_id=%s round=%d tool_results=%d",
                result.analysis_id,
                round_no,
                len(tool_results),
            )

    def _retry_missing_insight(
        self,
        result: AnalysisResult,
        skill: AnalysisSkill,
        system: list[dict],
        messages: list[dict],
    ) -> InsightData | None:
        logger.info("Insight missing, retrying analysis_id=%s", result.analysis_id)
        retry_messages = list(messages)
        retry_messages.append(
            {
                "role": "user",
                "content": (
                    "Response thieu block <insight>JSON</insight> bat buoc. "
                    "Chi viet duy nhat block nay — khong phan tich lai, khong them text khac:\n"
                    "<insight>\n{ ... JSON ... }\n</insight>"
                ),
            }
        )

        retry_response = self._client.messages.create(
            model=skill.model or settings.claude_model,
            max_tokens=min(skill.max_tokens, 1500),
            system=system,
            messages=retry_messages,
        )
        usage = retry_response.usage
        result.input_tokens += usage.input_tokens
        result.output_tokens += usage.output_tokens
        result.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0)
        result.cache_creation_tokens += getattr(usage, "cache_creation_input_tokens", 0)

        retry_text = _extract_text_blocks(retry_response.content)
        logger.debug(
            "Insight retry response analysis_id=%s stop_reason=%s retry_chars=%d",
            result.analysis_id,
            retry_response.stop_reason,
            len(retry_text or ""),
        )
        if retry_text:
            result.analysis_text = (result.analysis_text.rstrip() + "\n\n" + retry_text).strip()
        return _extract_insight(result)

    def _get_missing_required_tools(self, skill: AnalysisSkill, result: AnalysisResult) -> set[str]:
        called_successfully = {
            tc.tool_name
            for tc in result.tool_calls
            if not tc.error and not _tool_output_has_error(tc.output)
        }
        return set(skill.required_tools) - called_successfully

    def _execute_one_tool(self, block: Any) -> tuple[ToolCallRecord, str]:
        t0 = time.monotonic()
        tool_result = self._tool_executor.execute(block.name, dict(block.input))
        duration_ms = int((time.monotonic() - t0) * 1000)

        serialized = self._tool_executor.serialize_result(tool_result)
        error_msg = tool_result.get("error") if isinstance(tool_result, dict) else None
        if error_msg:
            logger.warning(
                "Tool error tool=%s duration_ms=%d error=%s",
                block.name, duration_ms, error_msg,
            )
        else:
            row_count = len(tool_result) if isinstance(tool_result, list) else None
            logger.info(
                "Tool ok tool=%s duration_ms=%d rows=%s chars=%d",
                block.name, duration_ms, row_count, len(serialized),
            )

        return (
            ToolCallRecord(
                tool_name=block.name,
                input=dict(block.input),
                output=tool_result,
                duration_ms=duration_ms,
                error=error_msg,
            ),
            serialized,
        )

    def _build_messages(
        self,
        request: AnalysisRequest,
        skill: AnalysisSkill,
        finding: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        session: dict[str, Any] | None = None

        if request.follow_up_text and request.telegram_message_id:
            session = self._session_repo.find_by_telegram_message_id(request.telegram_message_id)

        if session and request.follow_up_text:
            messages = _turns_to_messages(session["turns"])
            messages.append({"role": "user", "content": request.follow_up_text})
            logger.debug(
                "Follow-up session restored telegram_message_id=%s turns=%d",
                request.telegram_message_id,
                len(session.get("turns", [])),
            )
            return messages, session

        user_content = self._context_builder.build_user_message(skill, finding)
        logger.debug("Fresh message built chars=%d", len(user_content or ""))
        return [{"role": "user", "content": user_content}], None


def _load_finding(finding_id: str) -> dict[str, Any]:
    col = MongoConnection.get_db()[_FINDINGS_COLLECTION]
    doc = col.find_one({"finding_id": finding_id})
    if doc is None:
        raise ValueError(f"Finding '{finding_id}' khong tim thay trong MongoDB.")
    doc.pop("_id", None)
    logger.debug("Finding found finding_id=%s", finding_id)
    return doc


def _extract_insight(result: AnalysisResult) -> InsightData | None:
    if not result.analysis_text:
        return None

    text = result.analysis_text

    for pattern in (_INSIGHT_RE, _INSIGHT_ESCAPED_RE):
        match = pattern.search(text)
        if not match:
            continue
        data = _parse_json_fragment(match.group(1).strip())
        if data is None:
            logger.warning("Parse <insight> JSON failed analysis_id=%s", result.analysis_id)
            return None
        result.analysis_text = _strip_insight_segment(text, match.start(), match.end())
        logger.debug("Insight tag parsed analysis_id=%s", result.analysis_id)
        return _build_insight_data(data, result.analysis_id)

    fallback = _extract_insight_json_fallback(text)
    if fallback is None:
        logger.warning("Khong tim thay <insight> block analysis_id=%s", result.analysis_id)
        return None

    data, start, end = fallback
    result.analysis_text = _strip_insight_segment(text, start, end)
    logger.info("Insight parsed by JSON fallback analysis_id=%s", result.analysis_id)
    return _build_insight_data(data, result.analysis_id)


def _extract_text_blocks(content: list[Any]) -> str:
    parts = [block.text for block in content if hasattr(block, "type") and block.type == "text"]
    return "\n".join(parts).strip()


def _tool_output_has_error(output: Any) -> bool:
    return isinstance(output, dict) and bool(output.get("error"))


def _turns_to_messages(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"role": t["role"], "content": t["content"]}
        for t in turns
        if t.get("role") in ("user", "assistant") and t.get("content")
    ]



def _parse_json_fragment(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    if text.startswith("```"):
        fence = re.match(r"^```[a-zA-Z0-9_-]*\s*", text)
        if fence:
            text = text[fence.end():]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    if "{" in text and "}" in text:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start:end + 1]

    try:
        data = json.loads(text)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _extract_insight_json_fallback(text: str) -> tuple[dict[str, Any], int, int] | None:
    matches = list(_INSIGHT_JSON_FALLBACK_RE.finditer(text))
    for match in reversed(matches):
        data = _parse_json_fragment(match.group(1))
        if not data:
            continue
        if "root_cause_category" not in data or "actions" not in data:
            continue
        return data, match.start(), match.end()
    return None


def _strip_insight_segment(text: str, start: int, end: int) -> str:
    before = text[:start].rstrip()
    after = text[end:].lstrip()
    if before and after:
        return f"{before}\n\n{after}".strip()
    return (before or after).strip()


def _build_insight_data(data: dict[str, Any], analysis_id: str) -> InsightData | None:
    try:
        return InsightData(
            root_cause_category=data.get("root_cause_category", "unknown"),
            root_cause_summary=data.get("root_cause_summary", ""),
            affected_tables=data.get("affected_tables", []),
            affected_indexes=data.get("affected_indexes", []),
            affected_queries=data.get("affected_queries", []),
            actions=[InsightAction(**a) for a in data.get("actions", [])],
            systemic=bool(data.get("systemic", False)),
        )
    except Exception as exc:
        logger.warning("Build InsightData failed analysis_id=%s: %s", analysis_id, exc)
        return None


def _total_system_chars(system_blocks: list[dict[str, Any]]) -> int:
    return sum(len(str(b.get("text", ""))) for b in system_blocks)


def _total_message_chars(messages: list[dict[str, Any]]) -> int:
    total = 0
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            total += len(content)
        elif isinstance(content, list):
            for part in content:
                total += len(str(part))
        else:
            total += len(str(content or ""))
    return total
