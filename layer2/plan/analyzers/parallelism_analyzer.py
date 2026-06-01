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
                description=(
                    f"Plan serial (DOP=1) do {stmt.non_parallel_reason} - "
                    + ("query có chi phí lớn nhưng chạy đơn luồng." if actionable else "đây là hành vi bình thường theo thiết kế.")
                ),
                recommendation=(
                    "Rà `MAXDOP` setting, UDF inline-able không, table variable có thể đổi sang temp table, loại bỏ non_parallel_reason."
                    if actionable
                    else "Không cần can thiệp; lý do serial là policy (DOP=1 ước lượng) hoặc edition."
                ),
            ))

        qt = stmt.query_time
        if qt and stmt.dop > 1 and qt.elapsed_time > 0:
            speedup = qt.cpu_time / qt.elapsed_time
            efficiency = ((speedup - 1) / (stmt.dop - 1)) * 100
            if efficiency < 40:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="ineffective_parallelism",
                    description=(
                        f"Hiệu quả song song thấp: {efficiency:.1f}% (DOP={stmt.dop}) - "
                        f"DOP: {stmt.dop} | CPU: {qt.cpu_time}ms | Elapsed: {qt.elapsed_time}ms | "
                        f"Efficiency: ({speedup:.2f}-1)/({stmt.dop}-1)x100 = {efficiency:.1f}%"
                    ),
                    recommendation="Kiểm tra skew data (một thread gánh quá nhiều hàng), chờ `CXPACKET`. Cân nhắc giảm `DOP` hoặc đổi plan shape.",
                ))
        return findings
