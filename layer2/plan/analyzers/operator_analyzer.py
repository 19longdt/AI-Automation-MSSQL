from __future__ import annotations

from ..models.parsed_plan import PlanContext, PlanNode
from ..models.result import Action, Finding, Severity
from .base import AbstractAnalyzer


class OperatorAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "operator"

    def _is_applicable(self, context: PlanContext) -> bool:
        return context.statement.root_node is not None

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        for node in self._flatten(context.statement.root_node):
            op = node.physical_op
            if op == "Key Lookup":
                findings.append(Finding(
                    severity=Severity.CRITICAL,
                    category=self.category,
                    type="key_lookup",
                    description=f"Key Lookup detected at NodeId={node.node_id} table={node.table_name or 'unknown'}.",
                    recommendation="T?o covering index b?ng INCLUDE cho các c?t du?c truy xu?t thêm.",
                    action=Action(type="create_index", description="Covering index d? gi?m lookup", ddl=None),
                ))
            if op == "RID Lookup":
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="rid_lookup",
                    description=f"RID Lookup detected at NodeId={node.node_id}.",
                    recommendation="Cân nh?c clustered index cho heap table.",
                ))
            if op == "Sort" and context.statement.total_cost > 0 and node.estimated_cost / context.statement.total_cost > 0.2:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="sort_expensive",
                    description=f"Sort chi?m kho?ng {node.estimated_cost / context.statement.total_cost:.0%} estimated cost.",
                    recommendation="Xem xét index theo ORDER BY/GROUP BY d? gi?m sort cost.",
                ))
            if op in ("Index Scan", "Table Scan", "Clustered Index Scan") and node.predicate:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="scan_with_predicate",
                    description=f"{op} có predicate t?i NodeId={node.node_id}.",
                    recommendation="Ðánh giá l?i index/selectivity d? chuy?n scan sang seek khi phù h?p.",
                ))
            if node.estimate_rows > 0 and node.actual_rows is not None:
                ratio = (node.actual_rows / node.estimate_rows) if node.estimate_rows else 1.0
                if ratio >= 10 or ratio <= 0.1:
                    findings.append(Finding(
                        severity=Severity.WARNING,
                        category=self.category,
                        type="row_estimate_mismatch",
                        description=f"Row estimate mismatch t?i NodeId={node.node_id}: ratio={ratio:.2f}.",
                        recommendation="Ki?m tra statistics/parameter sniffing/implicit conversion.",
                    ))
            if any(w.name == "SpillToTempDb" for w in node.warnings):
                findings.append(Finding(
                    severity=Severity.CRITICAL,
                    category=self.category,
                    type="spill_to_tempdb",
                    description=f"SpillToTempDb t?i NodeId={node.node_id} ({node.physical_op}).",
                    recommendation="T?i uu estimate và memory grant; ki?m tra Sort/Hash spill path.",
                ))
            pred = (node.predicate or "") + " " + (node.seek_predicates or "")
            if "CONVERT_IMPLICIT" in pred:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="non_sargable_implicit",
                    description=f"CONVERT_IMPLICIT detected at NodeId={node.node_id}.",
                    recommendation="Ð?ng b? datatype gi?a parameter/column d? không ch?n index seek.",
                ))
        return findings

    def _flatten(self, root: PlanNode | None) -> list[PlanNode]:
        if root is None:
            return []
        out = [root]
        for c in root.children:
            out.extend(self._flatten(c))
        return out
