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
        table_cardinality: dict[str, float] = {}
        for node in self._flatten(context.statement.root_node):
            if not node.table_name or node.table_cardinality <= 0:
                continue
            key = node.table_name.lower()
            table_cardinality[key] = max(table_cardinality.get(key, 0.0), node.table_cardinality)

        for s in context.statement.stats_usage:
            mod = s.modification_count or 0
            table_key = (s.table or "").lower()
            card = table_cardinality.get(table_key, 0.0)
            mod_ratio = (mod / card) if card > 0 else None
            if mod > 0 and s.last_update and mod_ratio is not None and mod_ratio > 0.1:
                severity = Severity.CRITICAL if mod_ratio > 0.3 else Severity.WARNING
                findings.append(Finding(
                    severity=severity,
                    category=self.category,
                    type="stale_statistics",
                    description=(
                        f"Statistics {s.statistic} trên {s.table} có {mod} lần thay đổi "
                        f"(~{mod_ratio:.1%} so với table cardinality {card:,.0f}) kể từ lần cập nhật cuối - ước lượng hàng có thể sai."
                    ),
                    recommendation=f"Cập nhật statistics: UPDATE STATISTICS {s.table} {s.statistic} WITH FULLSCAN; Đặt lịch maintenance hoặc bật auto_update_stats_async.",
                ))
            if s.sampling_percent is not None and s.sampling_percent < 20:
                findings.append(Finding(
                    severity=Severity.WARNING if s.sampling_percent < 5 else Severity.INFO,
                    category=self.category,
                    type="low_sampling",
                    description=f"Sampling thấp ({s.sampling_percent:.0f}%) cho statistics {s.statistic} - ước lượng cardinality kém chính xác với dữ liệu lệch.",
                    recommendation="Cân nhắc UPDATE STATISTICS WITH FULLSCAN cho bảng lớn hoặc phân bố lệch để tăng chất lượng statistics.",
                ))
            if not s.last_update:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="never_updated_statistics",
                    description=f"Statistics {s.statistic} chưa từng được cập nhật (LastUpdate = NULL) - cardinality estimate dựa trên số liệu rất cũ hoặc mặc định.",
                    recommendation=f"Chạy UPDATE STATISTICS {s.table}; ngay. Kiểm tra auto_update_statistics có bật không.",
                ))
        return findings
