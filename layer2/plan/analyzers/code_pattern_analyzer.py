from __future__ import annotations

from ..models.parsed_plan import PlanContext, PlanNode
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
        for node in self._flatten(context.statement.root_node):
            if node.scalar_udfs:
                findings.append(Finding(
                    severity=Severity.CRITICAL,
                    category=self.category,
                    type="scalar_udf",
                    description=f"Scalar UDF detected at NodeId={node.node_id}.",
                    recommendation="Uu tiên rewrite sang inline TVF ho?c set-based logic.",
                ))
            if node.estimate_rows_without_row_goal > node.estimate_rows > 0:
                findings.append(Finding(
                    severity=Severity.INFO,
                    category=self.category,
                    type="row_goal",
                    description=f"Row goal active t?i NodeId={node.node_id}.",
                    recommendation="Ki?m tra TOP/EXISTS/FAST N có làm plan l?ch cho full-scan workload không.",
                ))
        return findings

    def _flatten(self, root: PlanNode | None) -> list[PlanNode]:
        if root is None:
            return []
        out = [root]
        for c in root.children:
            out.extend(self._flatten(c))
        return out
