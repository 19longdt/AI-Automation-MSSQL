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
        sniffing: list[tuple[str, str, str, str | None]] = []
        for p in context.statement.parameters:
            if p.compiled_value and p.runtime_value and p.compiled_value != p.runtime_value:
                sniffing.append((p.name, p.compiled_value, p.runtime_value, p.data_type))
            if not p.compiled_value:
                findings.append(Finding(
                    severity=Severity.INFO,
                    category=self.category,
                    type="local_variables",
                    description=f"Không có compiled value cho `{p.name}`.",
                    recommendation="Có thể query dùng local variable, estimate có thể kém chính xác.",
                ))

        if sniffing:
            snippets: list[str] = []
            for name, compiled, runtime, data_type in sniffing[:3]:
                dtype = f" ({data_type})" if data_type else ""
                snippets.append(f"{name}{dtype} compiled={compiled!r} runtime={runtime!r}")
            if len(sniffing) > 3:
                snippets.append(f"... và {len(sniffing) - 3} params khác")
            findings.append(Finding(
                severity=Severity.WARNING,
                category=self.category,
                type="parameter_sniffing",
                description=f"Parameter sniffing trên {len(sniffing)} param: " + "; ".join(snippets),
                recommendation="Xem xét sniffing mitigation (`OPTIMIZE FOR`/`RECOMPILE`/query store hints).",
            ))
        return findings
