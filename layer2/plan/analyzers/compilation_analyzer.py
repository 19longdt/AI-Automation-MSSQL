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
                description=f"Compile CPU cao: {stmt.compile_cpu_ms}ms - optimizer tốn nhiều tài nguyên để chọn plan.",
                recommendation="Rà độ phức tạp query: giảm số bảng join, đơn giản hóa predicate, cân nhắc tách truy vấn lớn thành nhiều bước nhỏ.",
            ))
        if stmt.early_abort_reason == "MemoryLimitExceeded":
            findings.append(Finding(
                severity=Severity.CRITICAL,
                category=self.category,
                type="compile_memory_exceeded",
                description="Optimizer dừng sớm (early abort) do vượt giới hạn bộ nhớ trong quá trình tối ưu hóa - plan có thể không tối ưu.",
                recommendation="Giảm độ phức tạp query: bớt join không cần thiết, rà biểu thức `ORDER BY`/`GROUP BY`, kiểm tra view nesting sâu.",
            ))
        if stmt.ce_model_version == 70:
            findings.append(Finding(
                severity=Severity.INFO,
                category=self.category,
                type="ce_model_legacy",
                description="Cardinality Estimation model 70 (SQL Server 2012 legacy) - ước lượng số hàng có thể kém chính xác với dữ liệu hiện đại.",
                recommendation="Đánh giá tác động khi nâng `compatibility level` lên 150 (SQL 2019 CE). Dùng Query Store để so sánh plan trước/sau.",
            ))
        if stmt.optm_level == "TRIVIAL":
            findings.append(Finding(
                severity=Severity.INFO,
                category=self.category,
                type="trivial_plan",
                description="Plan được compile ở mức `TRIVIAL` - optimizer bỏ qua nhiều bước tối ưu hóa.",
                recommendation="Nếu query chậm, kiểm tra missing index hoặc statistics để optimizer chọn `FULL` optimization.",
            ))
        return findings
