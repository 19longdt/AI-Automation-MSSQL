from __future__ import annotations

from ..models.parsed_plan import PlanContext
from ..models.result import Finding, Severity
from .base import AbstractAnalyzer


class CodePatternAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "code"

    def _is_applicable(self, context: PlanContext) -> bool:
        return True

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        seen_udfs: set[str] = set()
        for node in self._flatten(context.statement.root_node):
            if node.scalar_udfs:
                new_udfs = [udf for udf in node.scalar_udfs if udf not in seen_udfs]
                if new_udfs:
                    seen_udfs.update(new_udfs)
                    findings.append(Finding(
                        severity=Severity.CRITICAL,
                        category=self.category,
                        type="scalar_udf",
                        description=f"Phát hiện `Scalar UDF` {', '.join(f'`{u}`' for u in new_udfs)} tại `NodeId={node.node_id}` - hàm UDF vô hướng chạy tuần tự từng hàng, không thể song song hóa.",
                        recommendation="Viết lại dưới dạng inline Table-Valued Function (`iTVF`) hoặc set-based logic để SQL Server có thể tối ưu và song song hóa.",
                    ))
            if node.estimate_rows_without_row_goal > node.estimate_rows > 0:
                findings.append(Finding(
                    severity=Severity.INFO,
                    category=self.category,
                    type="row_goal",
                    description=f"Row goal active tại `NodeId={node.node_id}` - optimizer chọn plan tối ưu cho N hàng đầu, nhưng có thể kém hiệu quả khi cần nhiều hơn.",
                    recommendation="Kiểm tra `TOP`/`EXISTS`/`FAST N` hint: nếu thực tế lấy nhiều hàng hơn dự kiến, row goal plan sẽ scan nhiều hơn cần.",
                ))
        return findings
