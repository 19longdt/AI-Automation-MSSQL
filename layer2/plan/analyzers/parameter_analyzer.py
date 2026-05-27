from __future__ import annotations

from ..models.parsed_plan import PlanContext
from ..models.result import Finding, Severity
from .base import AbstractAnalyzer


class ParameterAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "parameter"

    def _is_applicable(self, context: PlanContext) -> bool:
        return bool(context.statement.parameters)

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        for p in context.statement.parameters:
            if p.compiled_value and p.runtime_value and p.compiled_value != p.runtime_value:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="parameter_sniffing",
                    description=f"Compiled value khác runtime value cho {p.name}.",
                    recommendation="Xem xét sniffing mitigation (recompile/optimize for/query store hints).",
                ))
            if not p.compiled_value:
                findings.append(Finding(
                    severity=Severity.INFO,
                    category=self.category,
                    type="local_variables",
                    description=f"Không có compiled value cho {p.name}.",
                    recommendation="Có th? query dùng local variable, estimate có th? kém chính xác.",
                ))
        return findings
