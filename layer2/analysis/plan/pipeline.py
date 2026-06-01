from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from pydantic import Field

from ...plan.models.result import (
    FindingGroup,
    PlanAnalysisResult,
    Severity,
    StatementResult,
)
from ...plan.service import PlanAnalysisService
from ..base import AnalysisOutput, AnalysisPipeline, ToolSnapshot
from ..types import AnalysisType


class PlanAnalysisOutput(AnalysisOutput):
    """Full output cho plan XML analysis — dùng cho Layer 3 UI.

    Kế thừa AnalysisOutput (có tool_snapshot cho AI Agent / Layer 1),
    bổ sung statements + counters cho UI rendering.
    """

    analysis_type: AnalysisType = AnalysisType.PLAN_XML
    statements: list[StatementResult] = Field(default_factory=list)
    total_findings: int = 0
    critical_count: int = 0
    warning_count: int = 0
    has_actual_stats: bool = False


class PlanAnalysisPipeline(AnalysisPipeline[str]):
    """Pipeline phân tích XML execution plan.

    Input : plan_xml (str)
    Output: PlanAnalysisOutput
      - tool_snapshot  → Layer 1 stores / AI Agent reads
      - statements     → Layer 3 UI renders
    """

    def __init__(self, service: PlanAnalysisService) -> None:
        self._service = service

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.PLAN_XML

    def run(self, plan_xml: str) -> PlanAnalysisOutput:
        start = time.monotonic()
        result = self._service.analyze(plan_xml)
        duration_ms = (time.monotonic() - start) * 1000

        return PlanAnalysisOutput(
            tool_snapshot=self._build_tool_snapshot(result, duration_ms),
            statements=result.statements,
            total_findings=result.total_findings,
            critical_count=result.critical_count,
            warning_count=result.warning_count,
            has_actual_stats=result.has_actual_stats,
            analyzed_at=datetime.now(timezone.utc),
            analysis_duration_ms=int(duration_ms),
        )

    # ── ToolSnapshot builder ───────────────────────────────────────────────────

    def _build_tool_snapshot(
        self, result: PlanAnalysisResult, duration_ms: float
    ) -> ToolSnapshot:
        all_groups = [g for s in result.statements for g in s.finding_groups]
        signals = self._extract_signals(result)

        return ToolSnapshot(
            status="ok",
            duration_ms=round(duration_ms, 1),
            row_count=len(result.statements),
            findings=all_groups,
            signals=signals,
            summary=self._build_summary(result, all_groups, signals),
            recommendations=self._build_recommendations(all_groups),
        )

    def _extract_signals(self, result: PlanAnalysisResult) -> dict[str, Any]:
        """Trích xuất key metrics dạng số cho AI pattern-matching."""
        signals: dict[str, Any] = {
            "critical_count": result.critical_count,
            "warning_count": result.warning_count,
            "statement_count": len(result.statements),
            "has_actual_stats": result.has_actual_stats,
        }

        if not result.statements:
            return signals

        stmt = result.statements[0]

        signals["total_cost"] = round(stmt.total_cost, 4)
        signals["dop"] = stmt.dop
        signals["ce_model"] = stmt.ce_model_version

        if stmt.compilation:
            if stmt.compilation.compile_cpu_ms:
                signals["compile_cpu_ms"] = stmt.compilation.compile_cpu_ms
            if stmt.compilation.early_abort_reason:
                signals["early_abort_reason"] = stmt.compilation.early_abort_reason

        if stmt.memory_grant:
            mg = stmt.memory_grant
            signals["memory_granted_kb"] = mg.granted_kb
            if mg.grant_wait_ms:
                signals["memory_wait_ms"] = mg.grant_wait_ms
            if mg.max_used_kb and mg.granted_kb:
                signals["memory_use_pct"] = round(mg.max_used_kb / mg.granted_kb * 100, 1)

        spill_count = sum(1 for op in stmt.top_operators if op.has_spill)
        if spill_count:
            signals["spill_count"] = spill_count

        worst_ratio = max(
            (
                op.actual_rows / op.estimated_rows
                for op in stmt.top_operators
                if op.actual_rows is not None and op.estimated_rows > 0
            ),
            default=0.0,
        )
        if worst_ratio >= 10:
            signals["max_row_est_ratio"] = round(worst_ratio, 1)

        if stmt.missing_indexes:
            signals["missing_index_count"] = len(stmt.missing_indexes)
            signals["max_missing_index_impact"] = round(
                max(m.impact for m in stmt.missing_indexes), 1
            )

        if stmt.wait_stats:
            top_wait = max(stmt.wait_stats, key=lambda w: w.ms)
            signals["top_wait_type"] = top_wait.type
            signals["top_wait_ms"] = top_wait.ms
            signals["top_wait_category"] = top_wait.category

        sniffing = [
            p
            for p in stmt.parameters
            if p.compiled_value and p.runtime_value and p.compiled_value != p.runtime_value
        ]
        if sniffing:
            signals["parameter_sniffing_count"] = len(sniffing)
            signals["sniffing_params"] = [p.name for p in sniffing[:3]]

        return signals

    def _build_summary(
        self,
        result: PlanAnalysisResult,
        groups: list[FindingGroup],
        signals: dict[str, Any],
    ) -> str:
        parts: list[str] = []

        if result.critical_count:
            critical_types = list(
                dict.fromkeys(g.type for g in groups if g.severity == Severity.CRITICAL)
            )[:3]
            parts.append(
                f"{result.critical_count} vấn đề nghiêm trọng: {', '.join(critical_types)}."
            )

        if signals.get("spill_count"):
            parts.append(f"{signals['spill_count']} spill ra TempDB.")

        ratio = signals.get("max_row_est_ratio", 0)
        if ratio >= 10:
            parts.append(f"Row estimate sai {ratio}× — nghi parameter sniffing hoặc stale stats.")

        if signals.get("missing_index_count"):
            parts.append(
                f"{signals['missing_index_count']} missing index"
                f", impact cao nhất {signals.get('max_missing_index_impact', 0):.0f}%."
            )

        if signals.get("memory_wait_ms", 0) > 1000:
            parts.append(f"Memory grant wait {signals['memory_wait_ms']}ms.")

        if not parts:
            if result.warning_count:
                parts.append(f"Plan OK, {result.warning_count} cảnh báo nhỏ.")
            else:
                parts.append("Không phát hiện vấn đề đáng kể.")

        return " ".join(parts)

    def _build_recommendations(self, groups: list[FindingGroup]) -> list[str]:
        recs: list[str] = []
        for g in groups:
            action = g.shared_action or (g.instances[0].action if g.instances else None)
            if action and action.description:
                recs.append(action.description)
            if len(recs) >= 5:
                break
        return recs

    @classmethod
    def create(cls) -> "PlanAnalysisPipeline":
        return cls(service=PlanAnalysisService.create())
