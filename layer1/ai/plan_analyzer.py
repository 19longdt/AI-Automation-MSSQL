"""
plan_analyzer.py — Gọi Claude API để phân tích finding.

Prompt được build hoàn toàn từ topic.analysis_config trong MongoDB —
không hardcode logic phân tích nào trong Python.

Flow:
  1. Nhận finding + analysis_config từ topic
  2. Build prompt: context + focus_metrics + include_fields (sql_text, xml_plan...)
  3. Gọi Claude API (sync, dùng anthropic SDK)
  4. Trả về AnalysisResponse (text + metadata: tokens, model, cost)
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import anthropic

from ..models.findings import Finding
from ..models.topic import AnalysisConfig

logger = logging.getLogger(__name__)

# Giới hạn mỗi large field (xml_query_plan có thể vài MB) để không vượt context
_MAX_FIELD_BYTES = 8192


@dataclass
class AnalysisResponse:
    """Response từ PlanAnalyzer — text + metadata."""
    analysis_text: str
    model: str
    input_tokens: int
    output_tokens: int
    duration_ms: int
    cost_usd: float = 0.0  # Haiku cost tính sau


class PlanAnalyzer:

    # Haiku pricing (per 1M tokens)
    _HAIKU_INPUT_PRICE = 0.80 / 1_000_000
    _HAIKU_OUTPUT_PRICE = 4.0 / 1_000_000

    def __init__(self, api_key: str, model: str) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def analyze(self, finding: Finding, analysis_config: AnalysisConfig) -> AnalysisResponse:
        """
        Gọi Claude API, trả về AnalysisResponse (text + metadata).
        Raise nếu API lỗi — caller (TelegramBot) xử lý exception.
        """
        prompt = self._build_prompt(finding, analysis_config)
        logger.info(
            "PlanAnalyzer: calling Claude model=%s for finding=%s topic=%s",
            self._model, finding.finding_id[:8], finding.topic_id,
        )
        start_time = time.time()
        message = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        duration_ms = int((time.time() - start_time) * 1000)

        analysis_text = message.content[0].text
        input_tokens = message.usage.input_tokens
        output_tokens = message.usage.output_tokens

        # Tính chi phí cho Haiku
        cost_usd = (input_tokens * self._HAIKU_INPUT_PRICE +
                   output_tokens * self._HAIKU_OUTPUT_PRICE)

        return AnalysisResponse(
            analysis_text=analysis_text,
            model=self._model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            duration_ms=duration_ms,
            cost_usd=cost_usd,
        )

    def _build_prompt(self, finding: Finding, cfg: AnalysisConfig) -> str:
        lines = [
            "Bạn là chuyên gia SQL Server performance tuning.",
            f"Context: {cfg.context}",
            "",
            f"Issue: {finding.issue_type.value} | Severity: {finding.severity.value}",
            f"Node: {finding.node} ({finding.role}) | Topic: {finding.topic_id}",
            "",
        ]

        # Highlight các metric quan trọng theo config
        if cfg.focus_metrics:
            lines.append("Key Metrics:")
            for k in cfg.focus_metrics:
                v = finding.metrics.get(k)
                if v is not None:
                    lines.append(f"  {k}: {v}")
            lines.append("")

        # Đính kèm các field lớn (sql_text, xml_query_plan...)
        for field in cfg.include_fields:
            v = finding.metrics.get(field)
            if v:
                content = str(v)[:_MAX_FIELD_BYTES]
                truncated = len(str(v)) > _MAX_FIELD_BYTES
                lines.append(f"{field}{'  [truncated]' if truncated else ''}:")
                lines.append(content)
                lines.append("")

        lines += [
            "Trả lời theo đúng định dạng sau (giữ nguyên 2 dòng đầu và dấu ---):",
            "ROOT_CAUSE: <1 câu ngắn gọn — vấn đề chính>",
            "QUICK_FIX: <1 hành động ưu tiên cao nhất>",
            "---",
            "Phân tích chi tiết (Tiếng Việt, KHÔNG dùng markdown):",
            "1. Root cause chi tiết là gì?",
            "2. Các vấn đề phát hiện được?",
            "3. Action items cụ thể, ưu tiên theo impact.",
        ]
        return "\n".join(lines)
