from __future__ import annotations

import re

from ..models.parsed_plan import PlanContext
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
        total_cost = context.statement.total_cost
        for node in self._flatten(context.statement.root_node):
            op = node.physical_op
            if op == "Key Lookup" or node.lookup:
                rows = node.actual_rows if node.actual_rows is not None else node.estimate_rows
                cost_pct = node.estimated_cost / total_cost if total_cost > 0 else 0
                severity = Severity.CRITICAL if (rows > 1000 or cost_pct > 0.05) else Severity.WARNING
                findings.append(Finding(
                    severity=severity,
                    category=self.category,
                    type="key_lookup",
                    description=f"Key Lookup tại `NodeId={node.node_id}`, bảng=`{node.table_name or 'unknown'}` - SQL Server đọc thêm cột ngoài index dẫn đến 2 lần I/O.",
                    recommendation="Tạo covering index bằng cách `INCLUDE` các cột được truy xuất thêm vào index hiện tại, tránh lookup.",
                    action=Action(type="create_index", description="Covering index để giảm lookup", ddl=None),
                ))
            if op == "RID Lookup":
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="rid_lookup",
                    description=f"RID Lookup tại `NodeId={node.node_id}` - bảng dạng heap (không có clustered index), SQL đọc thêm cột qua RowID.",
                    recommendation="Cân nhắc tạo clustered index cho heap table để loại bỏ RID Lookup và giảm I/O.",
                ))
            if op == "Sort" and total_cost > 0 and node.estimated_cost / total_cost > 0.2:
                pct = node.estimated_cost / total_cost
                metric = f"Sort #{node.node_id} | Cost: {node.estimated_cost:.2f} | {pct:.1%} of total | Est rows: {node.estimate_rows:g}"
                if node.actual_rows is not None:
                    metric += f" -> Act rows: {node.actual_rows:g}"
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="sort_expensive",
                    description=f"`Sort #{node.node_id}` chiếm khoảng {pct:.0%} estimated cost - operation sort tốn kém, dữ liệu chưa được sắp xếp sẵn. {metric}",
                    recommendation="Xem xét index theo `ORDER BY`/`GROUP BY` để dữ liệu đọc ra đã có thứ tự, loại bỏ Sort operation.",
                ))
            if op == "Hash Match":
                findings.append(Finding(
                    severity=Severity.INFO,
                    category=self.category,
                    type="hash_match_join_hint",
                    description=(
                        f"`Hash Match` tại `NodeId={node.node_id}` | Cost: {node.estimated_cost:.2f} | "
                        f"Est rows: {node.estimate_rows:g} - có thể là dấu hiệu join đang phải băm dữ liệu."
                    ),
                    recommendation="Kiểm tra index trên cột join để optimizer có thể chọn seek/join hiệu quả hơn khi phù hợp.",
                ))
            if op in ("Index Scan", "Table Scan", "Clustered Index Scan") and node.predicate:
                cost_pct = node.estimated_cost / total_cost if total_cost > 0 else 0
                if cost_pct > 0.1 or node.estimate_rows > 1000:
                    findings.append(Finding(
                        severity=Severity.WARNING,
                        category=self.category,
                        type="scan_with_predicate",
                        description=f"`{op}` với predicate tại `NodeId={node.node_id}` - scan toàn bộ index/bảng rồi lọc, thay vì seek trực tiếp vào dòng cần.",
                        recommendation="Đánh giá lại index và selectivity: tạo index phù hợp để chuyển từ Scan sang Seek khi predicate có selectivity cao.",
                    ))
            if node.estimate_rows > 0 and node.actual_rows is not None:
                ratio = node.actual_rows / node.estimate_rows
                if ratio >= 10 or ratio <= 0.1:
                    severity = Severity.CRITICAL if (ratio >= 100 or ratio <= 0.01) else Severity.WARNING
                    op_label = node.physical_op
                    if node.table_name:
                        op_label += f" [{node.table_name}]"
                    if ratio > 1:
                        findings.append(Finding(
                            severity=severity,
                            category=self.category,
                            type="row_underestimate",
                            description=(
                                f"`{op_label}` (`NodeId={node.node_id}`): under-estimate {ratio:.0f}× — "
                                f"optimizer ước lượng {node.estimate_rows:g} hàng nhưng thực tế {node.actual_rows:g} hàng."
                            ),
                            recommendation=(
                                "Under-estimate dẫn đến memory grant quá nhỏ → nguy cơ Hash/Sort spill ra TempDB. "
                                "Kiểm tra: (1) `UPDATE STATISTICS WITH FULLSCAN` cho bảng liên quan, "
                                "(2) parameter sniffing nếu compiled value khác runtime value, "
                                "(3) implicit type conversion làm histogram không dùng được."
                            ),
                        ))
                    else:
                        over_factor = (1 / ratio) if ratio > 0 else node.estimate_rows
                        findings.append(Finding(
                            severity=severity,
                            category=self.category,
                            type="row_overestimate",
                            description=(
                                f"`{op_label}` (`NodeId={node.node_id}`): over-estimate {over_factor:.0f}× — "
                                f"optimizer ước lượng {node.estimate_rows:g} hàng nhưng thực tế {node.actual_rows:g} hàng."
                            ),
                            recommendation=(
                                "Over-estimate dẫn đến memory grant quá lớn, lãng phí workspace memory. "
                                "Kiểm tra: (1) `UPDATE STATISTICS WITH FULLSCAN`, "
                                "(2) filtered index/statistics nếu query có predicate chọn lọc cao, "
                                "(3) Row Goal có thể bị ảnh hưởng bởi TOP/EXISTS."
                            ),
                        ))
            if any(w.name == "SpillToTempDb" for w in node.warnings):
                findings.append(Finding(
                    severity=Severity.CRITICAL,
                    category=self.category,
                    type="spill_to_tempdb",
                    description=f"SpillToTempDb tại `NodeId={node.node_id}` (`{node.physical_op}`) - bộ nhớ không đủ, dữ liệu tràn ra đĩa (TempDB).",
                    recommendation="Tối ưu row estimate và memory grant: sửa statistics, kiểm tra `Sort`/`Hash` spill path, tăng query memory nếu cần.",
                ))
            pred = (node.predicate or "") + " " + (node.seek_predicates or "")
            if "CONVERT_IMPLICIT" in pred:
                matches = re.findall(r"CONVERT_IMPLICIT\([^)]{0,100}\)", pred)
                expr_hint = matches[0][:150] if matches else "(xem predicate)"
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="non_sargable_implicit",
                    description=f"`CONVERT_IMPLICIT` tại `NodeId={node.node_id}`: `{expr_hint}` - SQL Server ép kiểu dữ liệu ngầm, không thể dùng index seek.",
                    recommendation="Đồng bộ kiểu dữ liệu giữa parameter và cột (tránh `VARCHAR` vs `NVARCHAR`, `INT` vs `BIGINT`) để index seek hoạt động.",
                ))
        return findings
