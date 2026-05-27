from __future__ import annotations

from ..models.parsed_plan import PlanContext
from ..models.result import Finding, Severity
from .base import AbstractAnalyzer


class CompilationAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "compilation"

    def _is_applicable(self, context: PlanContext) -> bool:
        return True

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        stmt = context.statement
        if stmt.compile_cpu_ms > 1000:
            findings.append(Finding(
                severity=Severity.CRITICAL if stmt.compile_cpu_ms > 5000 else Severity.WARNING,
                category=self.category,
                type="high_compile_cpu",
                description=f"Compile CPU cao: {stmt.compile_cpu_ms}ms.",
                recommendation="Rà d? ph?c t?p query và cân nh?c tách truy v?n/don gi?n hóa predicate.",
            ))
        if stmt.early_abort_reason == "MemoryLimitExceeded":
            findings.append(Finding(
                severity=Severity.CRITICAL,
                category=self.category,
                type="compile_memory_exceeded",
                description="Optimizer early-abort do MemoryLimitExceeded.",
                recommendation="Gi?m d? ph?c t?p query và rà join/order expressions.",
            ))
        if stmt.ce_model_version == 70:
            findings.append(Finding(
                severity=Severity.INFO,
                category=self.category,
                type="ce_model_legacy",
                description="Cardinality Estimation model 70 (legacy).",
                recommendation="Ðánh giá compatibility level/CE behavior cho workload hi?n t?i.",
            ))
        return findings
