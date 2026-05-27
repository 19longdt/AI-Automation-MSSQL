from __future__ import annotations

from ..models.parsed_plan import PlanContext
from ..models.result import Finding, Severity
from .base import AbstractAnalyzer


class MemoryAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "memory"

    def _is_applicable(self, context: PlanContext) -> bool:
        return context.statement.memory_grant is not None

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        mg = context.statement.memory_grant
        if mg is None:
            return findings

        if mg.granted_kb > 0 and mg.max_used_kb is not None and mg.max_used_kb >= int(mg.granted_kb * 0.9):
            findings.append(Finding(
                severity=Severity.WARNING,
                category=self.category,
                type="memory_spill_risk",
                description=f"Memory grant g?n tr?n: used={mg.max_used_kb}KB granted={mg.granted_kb}KB.",
                recommendation="Rà l?i row estimate/statistics và các operator Sort/Hash d? gi?m spill risk.",
            ))

        if mg.granted_kb > 0 and mg.max_used_kb is not None and mg.max_used_kb < int(mg.granted_kb * 0.5):
            findings.append(Finding(
                severity=Severity.WARNING,
                category=self.category,
                type="memory_wasted_grant",
                description=f"Memory grant overestimate: used={mg.max_used_kb}KB granted={mg.granted_kb}KB.",
                recommendation="Ki?m tra th?ng kê và cardinality d? gi?m lãng phí workspace memory.",
            ))

        if mg.grant_wait_ms > 0:
            findings.append(Finding(
                severity=Severity.CRITICAL if mg.grant_wait_ms >= 5000 else Severity.WARNING,
                category=self.category,
                type="memory_grant_wait",
                description=f"Grant wait {mg.grant_wait_ms}ms.",
                recommendation="Server có memory pressure; t?i uu query n?ng memory ho?c di?u ch?nh c?u hình grant.",
            ))

        if mg.granted_kb >= 1024 * 1024:
            findings.append(Finding(
                severity=Severity.CRITICAL if mg.granted_kb >= 4 * 1024 * 1024 else Severity.WARNING,
                category=self.category,
                type="memory_large_grant",
                description=f"Large memory grant {mg.granted_kb // 1024}MB.",
                recommendation="Xem plan shape (Sort/Hash) và u?c lu?ng hàng d? gi?m peak grant.",
            ))

        return findings
