"""
orchestrator.py — Agentic loop chính cho Layer 2 AI Analysis Agent.

Flow mỗi analysis:
  1. Load finding từ MongoDB `findings` (Layer 1 output)
  2. Select skill theo issue_type via SkillLoader
  3. Build system prompt: base + specialization + db_context (với prompt cache)
  4. Build messages: fresh hoặc multi-turn follow-up từ session
  5. Agentic loop: Claude API ↔ ToolExecutor ↔ DiagnosticExecutor
  6. Parse <insight> JSON block, strip khỏi analysis_text
  7. Tính cost_usd từ token usage thực tế
  8. Upsert InsightData → MongoDB `issue_insights`
  9. Update AnalysisResult → MongoDB `ai_analyses`
  10. Create/update Telegram session nếu channel='telegram'

Timeout: settings.agent_timeout_sec hard-limit cho toàn bộ loop.
Max rounds: skill.max_tool_rounds — sau đó force end_turn (bỏ truyền tools).
Exceptions: KHÔNG propagate — luôn trả về AnalysisResult với status=FAILED/TIMEOUT.
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
from ..storage.mongo_client import MongoConnection
from ..storage.repositories.analysis_repo import AnalysisRepo
from ..storage.repositories.insight_repo import InsightRepo
from ..storage.repositories.session_repo import SessionRepo
from ..utils.cost_calculator import calculate_cost
from ..utils.time_utils import now_vn
from .context_builder import ContextBuilder
from .skill_loader import SkillLoader
from .tool_executor import ToolExecutor
from .tool_registry import build_claude_tools

logger = logging.getLogger(__name__)

_INSIGHT_RE = re.compile(r"<insight>(.*?)</insight>", re.DOTALL)
_FINDINGS_COLLECTION = "findings"


class AgentOrchestrator:
    """
    Điều phối toàn bộ agentic loop từ AnalysisRequest đến AnalysisResult.
    Thread-safe: mỗi run() dùng local state hoàn toàn.
    """

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

    # ── Public interface ────────────────────────────────────────────────────────

    def run(self, request: AnalysisRequest) -> AnalysisResult:
        """
        Execute full analysis. Never raises — always returns AnalysisResult.

        status=COMPLETED  → analysis_text có, cost_usd tính xong, insight upserted.
        status=FAILED     → error field mô tả lỗi.
        status=TIMEOUT    → error field nêu elapsed time.
        """
        result = AnalysisResult(finding_id=request.finding_id)
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

    # ── Core flow ───────────────────────────────────────────────────────────────

    def _execute(self, request: AnalysisRequest, result: AnalysisResult) -> None:
        wall_start = time.monotonic()

        # 1. Load finding (raises ValueError nếu không tìm thấy)
        finding = _load_finding(request.finding_id)
        result.finding_snapshot = finding

        issue_type = str(finding.get("issue_type", ""))
        node = finding.get("node", "")
        detected_at = finding.get("detected_at") or now_vn()

        # 2. Select skill
        skill = self._skill_loader.get_skill(issue_type)
        result.skill_id = skill.skill_id
        result.model = skill.model or settings.claude_model

        # 3. Persist RUNNING sớm để callers có thể poll status
        result.status = AnalysisStatus.RUNNING
        self._analysis_repo.insert(result)
        logger.info(
            "Analysis started analysis_id=%s finding_id=%s skill=%s model=%s node=%s",
            result.analysis_id, request.finding_id, skill.skill_id,
            skill.model or settings.claude_model, node,
        )

        # 4. Build system prompt (prompt cache block 1 = base_system_prompt)
        system = self._context_builder.build_system_prompt(skill)

        # 5. Build initial messages — fresh hoặc multi-turn follow-up
        messages, session = self._build_messages(request, skill, finding)

        # 6. Agentic loop (accumulates tokens into result)
        self._agentic_loop(result, skill, system, messages)

        # 7. Parse <insight> block — strips it from analysis_text
        insight = _extract_insight(result)

        if insight:
            result.root_cause_summary = insight.root_cause_summary
            high_priority = [a.description for a in insight.actions if a.priority == "high"]
            result.top_actions = high_priority[:2] if high_priority else [a.description for a in insight.actions[:2]]

        # 8. Tính cost từ token usage thực tế
        result.cost_usd = calculate_cost(
            settings.claude_model,
            result.input_tokens,
            result.output_tokens,
            result.cache_read_tokens,
            result.cache_creation_tokens,
        )

        # 9. Upsert insight vào issue_insights
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
            except Exception as exc:
                logger.error("InsightRepo.upsert failed analysis_id=%s: %s", result.analysis_id, exc)

        # 10. Finalize result
        result.total_duration_ms = int((time.monotonic() - wall_start) * 1000)
        result.completed_at = now_vn()
        self._analysis_repo.update_completed(result)

        logger.info(
            "Analysis done analysis_id=%s status=%s cost_usd=%.6f duration_ms=%d tokens(in=%d out=%d cache_r=%d cache_w=%d)",
            result.analysis_id, result.status.value, result.cost_usd,
            result.total_duration_ms,
            result.input_tokens, result.output_tokens,
            result.cache_read_tokens, result.cache_creation_tokens,
        )

        # 11. Session management (Telegram only)
        if request.channel == "telegram" and result.analysis_text:
            _update_session(self._session_repo, request, result, session)

    # ── Agentic loop ────────────────────────────────────────────────────────────

    def _agentic_loop(
        self,
        result: AnalysisResult,
        skill: Any,
        system: list[dict],
        messages: list[dict],
    ) -> None:
        """
        Lặp Claude ↔ tools cho đến khi end_turn hoặc giới hạn.

        Sau khi dùng hết remaining_tool_rounds, gọi Claude không truyền tools
        → Claude không thể gọi tool nữa → buộc phải trả end_turn với analysis.
        """
        remaining_rounds = skill.max_tool_rounds
        all_tools = build_claude_tools()
        loop_start = time.monotonic()

        while True:
            # Hard timeout
            elapsed = time.monotonic() - loop_start
            if elapsed > settings.agent_timeout_sec:
                logger.warning("Agent timeout %.1fs analysis_id=%s", elapsed, result.analysis_id)
                result.status = AnalysisStatus.TIMEOUT
                result.error = f"Timeout sau {elapsed:.0f}s (limit={settings.agent_timeout_sec}s)"
                return

            # Khi hết rounds: không truyền tools → Claude phải kết luận
            call_kwargs: dict[str, Any] = {
                "model": skill.model or settings.claude_model,
                "max_tokens": skill.max_tokens,
                "system": system,
                "messages": messages,
            }
            if remaining_rounds > 0:
                call_kwargs["tools"] = all_tools

            response = self._client.messages.create(**call_kwargs)

            # Tích lũy token usage
            usage = response.usage
            result.input_tokens += usage.input_tokens
            result.output_tokens += usage.output_tokens
            result.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0)
            result.cache_creation_tokens += getattr(usage, "cache_creation_input_tokens", 0)

            # Append assistant turn
            messages.append({"role": "assistant", "content": response.content})

            # Kết thúc khi không phải tool_use hoặc hết rounds
            if response.stop_reason != "tool_use" or remaining_rounds <= 0:
                result.analysis_text = _extract_text_blocks(response.content)
                result.status = AnalysisStatus.COMPLETED
                return

            # Thực thi tool calls
            remaining_rounds -= 1
            tool_results: list[dict[str, Any]] = []

            for block in response.content:
                if not hasattr(block, "type") or block.type != "tool_use":
                    continue
                record, serialized = self._execute_one_tool(block)
                result.tool_calls.append(record)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": serialized,
                })

            messages.append({"role": "user", "content": tool_results})

    def _execute_one_tool(self, block: Any) -> tuple[ToolCallRecord, str]:
        """Execute 1 tool_use block. Trả về (ToolCallRecord, serialized_result_string)."""
        t0 = time.monotonic()
        tool_result = self._tool_executor.execute(block.name, dict(block.input))
        duration_ms = int((time.monotonic() - t0) * 1000)

        serialized = self._tool_executor.serialize_result(tool_result)
        error_msg = tool_result.get("error") if isinstance(tool_result, dict) else None

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

    # ── Message building ─────────────────────────────────────────────────────────

    def _build_messages(
        self,
        request: AnalysisRequest,
        skill: Any,
        finding: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        """
        Build danh sách messages cho API call đầu tiên.

        Fresh analysis (follow_up_text=None):
            messages = [{"role": "user", "content": <từ template>}]

        Multi-turn follow-up (follow_up_text không None, telegram_message_id có):
            messages = <session turns> + [{"role": "user", "content": follow_up_text}]

        Trả về (messages, session_doc_or_None).
        """
        session: dict[str, Any] | None = None

        if request.follow_up_text and request.telegram_message_id:
            session = self._session_repo.find_by_telegram_message_id(
                request.telegram_message_id
            )

        if session and request.follow_up_text:
            messages = _turns_to_messages(session["turns"])
            messages.append({"role": "user", "content": request.follow_up_text})
            return messages, session

        # Fresh: build từ finding template
        user_content = self._context_builder.build_user_message(skill, finding)
        return [{"role": "user", "content": user_content}], None


# ── Module-level helpers ──────────────────────────────────────────────────────────


def _load_finding(finding_id: str) -> dict[str, Any]:
    """Load finding document từ MongoDB `findings` collection (Layer 1 output)."""
    col = MongoConnection.get_db()[_FINDINGS_COLLECTION]
    doc = col.find_one({"finding_id": finding_id})
    if doc is None:
        raise ValueError(f"Finding '{finding_id}' không tìm thấy trong MongoDB.")
    doc.pop("_id", None)
    return doc


def _extract_insight(result: AnalysisResult) -> InsightData | None:
    """
    Tìm và parse <insight>JSON</insight> từ analysis_text.
    Nếu tìm thấy: strip block ra khỏi result.analysis_text để không gửi cho DBA.
    """
    if not result.analysis_text:
        return None

    match = _INSIGHT_RE.search(result.analysis_text)
    if not match:
        logger.warning("Không tìm thấy <insight> block analysis_id=%s", result.analysis_id)
        return None

    try:
        data = json.loads(match.group(1).strip())
        insight = InsightData(
            root_cause_category=data.get("root_cause_category", "unknown"),
            root_cause_summary=data.get("root_cause_summary", ""),
            affected_tables=data.get("affected_tables", []),
            affected_indexes=data.get("affected_indexes", []),
            affected_queries=data.get("affected_queries", []),
            actions=[InsightAction(**a) for a in data.get("actions", [])],
            systemic=bool(data.get("systemic", False)),
        )
        # Strip <insight> block — DBA nhận analysis_text không có block này
        before = result.analysis_text[: match.start()].rstrip()
        result.analysis_text = before.strip()
        return insight
    except Exception as exc:
        logger.warning("Parse <insight> JSON failed analysis_id=%s: %s", result.analysis_id, exc)
        return None


def _extract_text_blocks(content: list[Any]) -> str:
    """Ghép tất cả text blocks từ Claude response.content thành 1 string."""
    parts = [
        block.text
        for block in content
        if hasattr(block, "type") and block.type == "text"
    ]
    return "\n".join(parts).strip()


def _turns_to_messages(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert session.turns sang Anthropic messages format."""
    return [
        {"role": t["role"], "content": t["content"]}
        for t in turns
        if t.get("role") in ("user", "assistant") and t.get("content")
    ]


def _update_session(
    session_repo: SessionRepo,
    request: AnalysisRequest,
    result: AnalysisResult,
    session: dict[str, Any] | None,
) -> None:
    """Tạo session mới hoặc append turns vào session hiện tại."""
    try:
        if session is None:
            session_repo.create(
                finding_id=request.finding_id,
                channel=request.channel,
                first_turn_text=result.analysis_text,
                analysis_id=result.analysis_id,
                telegram_message_id=request.telegram_message_id,
            )
        else:
            session_repo.append_turns(
                session_id=session["session_id"],
                user_text=request.follow_up_text or "",
                assistant_text=result.analysis_text,
                analysis_id=result.analysis_id,
            )
    except Exception as exc:
        logger.error("Session update failed analysis_id=%s: %s", result.analysis_id, exc)
