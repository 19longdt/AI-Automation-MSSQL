from __future__ import annotations

from ..models.parsed_plan import PlanContext
from ..models.result import Action, Finding, Severity
from .base import AbstractAnalyzer


class IndexAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "index"

    def _is_applicable(self, context: PlanContext) -> bool:
        return bool(context.statement.missing_indexes)

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        for idx in context.statement.missing_indexes:
            table = f"{idx.schema}.{idx.table}".strip(".")
            severity = Severity.CRITICAL if idx.impact >= 50 else Severity.WARNING
            key_cols = [*idx.equality_columns, *idx.inequality_columns]
            include_cols = idx.include_columns
            name = "_".join(([idx.table] + key_cols)[:4]) or "auto"
            ddl = None
            if table and key_cols:
                keys = ", ".join(f"[{c}]" for c in key_cols)
                includes = ", ".join(f"[{c}]" for c in include_cols)
                ddl = f"CREATE NONCLUSTERED INDEX [IX_{name}] ON [{idx.schema or 'dbo'}].[{idx.table}] ({keys})"
                if includes:
                    ddl += f" INCLUDE ({includes})"
                ddl += ";"
            findings.append(Finding(
                severity=severity,
                category=self.category,
                type="missing_index",
                description=f"Missing index suggestion for {table} impact={idx.impact:.1f}.",
                recommendation="Ðánh giá workload tru?c khi t?o index d? tránh over-indexing.",
                action=Action(type="create_index", description="T?o index theo g?i ý plan", ddl=ddl) if ddl else None,
            ))
            if len(include_cols) > 5 or len(key_cols) > 4:
                findings.append(Finding(
                    severity=Severity.INFO,
                    category=self.category,
                    type="wide_index_suggestion",
                    description=f"Wide index suggestion on {table}.",
                    recommendation="Cân d?i l?i ích d?c và chi phí maintenance/write.",
                ))
        return findings
