"""
plan_analyzer.py — Gọi Claude API để phân tích finding.

Prompt được build hoàn toàn từ topic.analysis_config trong MongoDB —
không hardcode logic phân tích nào trong Python.

Flow:
  1. Nhận finding + analysis_config từ topic
  2. Build prompt: context + focus_metrics + include_fields (sql_text, xml_plan...)
  3. Gọi Claude API (sync, dùng anthropic SDK)
  4. Trả về text phân tích → TelegramBot gửi về user
"""
from __future__ import annotations

import logging

import anthropic

from ..models.findings import Finding
from ..models.topic import AnalysisConfig

logger = logging.getLogger(__name__)

# Giới hạn mỗi large field (xml_query_plan có thể vài MB) để không vượt context
_MAX_FIELD_BYTES = 8192


class PlanAnalyzer:

    def __init__(self, api_key: str, model: str) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def analyze(self, finding: Finding, analysis_config: AnalysisConfig) -> str:
        """
        Gọi Claude API, trả về text phân tích dạng plain text.
        Raise nếu API lỗi — caller (TelegramBot) xử lý exception.
        """
        prompt = self._build_prompt(finding, analysis_config)
        logger.info(
            "PlanAnalyzer: calling Claude for finding=%s topic=%s",
            finding.finding_id[:8], finding.topic_id,
        )
        message = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text

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
            "Yêu cầu (ngắn gọn, Tiếng Việt, KHÔNG dùng markdown):",
            "1. Root cause là gì?",
            "2. Các vấn đề phát hiện được?",
            "3. Action items cụ thể, ưu tiên theo impact.",
        ]
        return "\n".join(lines)
