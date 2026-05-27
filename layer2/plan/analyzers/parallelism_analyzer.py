from __future__ import annotations

from ..models.parsed_plan import PlanContext
from ..models.result import Finding, Severity
from .base import AbstractAnalyzer


class ParallelismAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "parallelism"

    def _is_applicable(self, context: PlanContext) -> bool:
        return True

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        stmt = context.statement
        if stmt.total_cost >= 1 and stmt.dop <= 1 and stmt.non_parallel_reason:
            actionable = stmt.non_parallel_reason not in {"EstimatedDOPIsOne", "NoParallelPlansInDesktopOrExpressEdition"}
            findings.append(Finding(
                severity=Severity.WARNING if actionable else Severity.INFO,
                category=self.category,
                type="serial_plan_actionable" if actionable else "serial_plan_passive",
                description=f"Serial plan reason: {stmt.non_parallel_reason}.",
                recommendation="Rà MAXDOP/query shape/UDF/table variable tùy reason c? th?.",
            ))

        qt = stmt.query_time
        if qt and stmt.dop > 1 and qt.elapsed_time > 0:
            speedup = qt.cpu_time / qt.elapsed_time
            efficiency = ((speedup - 1) / (stmt.dop - 1)) * 100 if stmt.dop > 1 else 100.0
            if efficiency < 40:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="ineffective_parallelism",
                    description=f"Parallel efficiency th?p: {efficiency:.1f}% (DOP={stmt.dop}).",
                    recommendation="Ki?m tra skew/waits và cân nh?c gi?m DOP ho?c d?i plan shape.",
                ))
        return findings
