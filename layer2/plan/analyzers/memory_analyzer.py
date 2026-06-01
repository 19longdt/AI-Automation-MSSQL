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

        used_pct = (mg.max_used_kb / mg.granted_kb * 100) if mg.granted_kb > 0 and mg.max_used_kb is not None else None

        if mg.granted_kb > 0 and mg.max_used_kb is not None and mg.max_used_kb >= int(mg.granted_kb * 0.9):
            findings.append(Finding(
                severity=Severity.WARNING,
                category=self.category,
                type="memory_spill_risk",
                description=(
                    f"Memory grant gần trần: dùng {mg.max_used_kb}KB / cấp {mg.granted_kb}KB ({used_pct:.0f}%) - "
                    "nguy cơ spill sang TempDB."
                ),
                recommendation="Rà lại row estimate và statistics cho các operator `Sort`/`Hash`. Nếu spill xảy ra, tăng memory grant hoặc sửa plan.",
            ))

        if mg.granted_kb > 0 and mg.max_used_kb is not None and mg.max_used_kb < int(mg.granted_kb * 0.5):
            findings.append(Finding(
                severity=Severity.WARNING,
                category=self.category,
                type="memory_wasted_grant",
                description=(
                    f"Memory grant overestimate: chỉ dùng {mg.max_used_kb}KB / cấp {mg.granted_kb}KB ({used_pct:.0f}%) - "
                    "lãng phí workspace memory."
                ),
                recommendation="Kiểm tra statistics và cardinality: estimate hàng quá cao dẫn đến grant thừa. Sửa stats để cấp đúng mức cần.",
            ))

        if mg.grant_wait_ms > 0:
            findings.append(Finding(
                severity=Severity.CRITICAL if mg.grant_wait_ms >= 5000 else Severity.WARNING,
                category=self.category,
                type="memory_grant_wait",
                description=f"Memory grant wait {mg.grant_wait_ms}ms - query phải chờ để được cấp bộ nhớ, có thể do server memory pressure.",
                recommendation="Server đang dưới áp lực memory: tối ưu query nặng memory, xem xét điều chỉnh `max server memory` hoặc resource pool.",
            ))

        if mg.granted_kb >= 1024 * 1024:
            findings.append(Finding(
                severity=Severity.CRITICAL if mg.granted_kb >= 4 * 1024 * 1024 else Severity.WARNING,
                category=self.category,
                type="memory_large_grant",
                description=f"Large memory grant: {mg.granted_kb // 1024}MB được cấp - query chiếm lượng lớn workspace memory.",
                recommendation="Xem plan shape (`Sort`/`Hash` nhiều không), ước lượng hàng có chính xác không. Grant lớn có thể chèn ép query khác.",
            ))

        return findings
