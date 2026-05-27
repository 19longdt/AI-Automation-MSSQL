from __future__ import annotations

from ..models.parsed_plan import PlanContext
from ..models.result import Finding, Severity
from .base import AbstractAnalyzer


class StatisticsAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "statistics"

    def _is_applicable(self, context: PlanContext) -> bool:
        return bool(context.statement.stats_usage)

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        for s in context.statement.stats_usage:
            if (s.modification_count or 0) > 10000 and s.last_update:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="stale_statistics",
                    description=f"Statistics {s.statistic} trên {s.table} có modification_count cao ({s.modification_count}).",
                    recommendation="C?p nh?t statistics d? c?i thi?n cardinality estimate.",
                ))
            if s.sampling_percent is not None and s.sampling_percent < 20:
                findings.append(Finding(
                    severity=Severity.INFO,
                    category=self.category,
                    type="low_sampling",
                    description=f"Sampling th?p ({s.sampling_percent}%) cho {s.statistic}.",
                    recommendation="Cân nh?c FULLSCAN cho b?ng l?n ho?c phân b? l?ch.",
                ))
            if not s.last_update:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="never_updated_statistics",
                    description=f"Statistics {s.statistic} chua có LastUpdate.",
                    recommendation="Ch?y UPDATE STATISTICS cho object liên quan.",
                ))
        return findings
