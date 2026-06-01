from __future__ import annotations

import xml.etree.ElementTree as ET

from ..models.parsed_plan import NodeWarning, ParsedStatement, PerThreadStat, PlanNode

SHOWPLAN_URI = "http://schemas.microsoft.com/sqlserver/2004/07/showplan"


class OperatorParser:
    def parse_into(self, statement: ParsedStatement, stmt_el: ET.Element) -> None:
        qp = stmt_el.find(f".//{self._tag('QueryPlan')}")
        if qp is None:
            return
        root_relop = qp.find(f".//{self._tag('RelOp')}")
        if root_relop is None:
            return
        statement.root_node = self.parse_node(root_relop)
        statement.has_actual_stats = statement.has_actual_stats or statement.root_node.has_actual_stats

    def parse_node(self, relop_el: ET.Element) -> PlanNode:
        runtime = relop_el.find(self._tag("RunTimeInformation"))
        index_scan = relop_el.find(f".//{self._tag('IndexScan')}")
        lookup = (
            ("Lookup" in (relop_el.get("PhysicalOp") or ""))
            or (index_scan is not None and index_scan.get("Lookup") == "1")
        )
        counters = runtime.findall(f".//{self._tag('RunTimeCountersPerThread')}") if runtime is not None else []
        actual_rows = sum(self._to_float(c.get("ActualRows")) for c in counters) if counters else None
        actual_cpu = sum(self._to_float(c.get("ActualCPUms")) for c in counters) if counters else None
        actual_reads = sum(self._to_float(c.get("ActualLogicalReads")) for c in counters) if counters else None
        actual_elapsed = max((self._to_float(c.get("ActualElapsedms")) for c in counters), default=0.0) if counters else None

        node = PlanNode(
            node_id=self._to_int(relop_el.get("NodeId")),
            physical_op=relop_el.get("PhysicalOp", ""),
            logical_op=relop_el.get("LogicalOp", ""),
            estimated_cost=self._to_float(relop_el.get("EstimatedTotalSubtreeCost")),
            estimate_rows=self._to_float(relop_el.get("EstimateRows")),
            table_cardinality=self._to_float(relop_el.get("TableCardinality")),
            estimate_rows_without_row_goal=self._to_float(relop_el.get("EstimateRowsWithoutRowGoal")),
            parallel=(relop_el.get("Parallel") == "1"),
            lookup=lookup,
            actual_rows=actual_rows,
            actual_executions=(sum(self._to_float(c.get("ActualExecutions")) for c in counters) if counters else None),
            actual_elapsed_ms=actual_elapsed,
            actual_cpu_ms=actual_cpu,
            actual_logical_reads=actual_reads,
            actual_physical_reads=(sum(self._to_float(c.get("ActualPhysicalReads")) for c in counters) if counters else None),
            has_actual_stats=bool(counters),
            predicate=self._first_scalar(relop_el, "Predicate"),
            seek_predicates=self._first_scalar(relop_el, "SeekPredicates"),
            output_columns=None,
            table_name=self._table(relop_el),
            index_name=self._index(relop_el),
            index_kind=self._index_kind(relop_el),
            partitioned=(relop_el.get("Partitioned") == "1"),
            warnings=self._parse_warnings(relop_el),
            scalar_udfs=self._parse_udfs(relop_el),
            per_thread_stats=self._parse_threads(counters),
        )

        child_relop_map: dict[int, ET.Element] = {}
        for child in relop_el:
            child_tag = self._strip_tag(child.tag)
            if child_tag == "RelOp":
                nid = self._to_int(child.get("NodeId"))
                child_relop_map[nid] = child
                continue
            for grandchild in child:
                if self._strip_tag(grandchild.tag) == "RelOp":
                    nid = self._to_int(grandchild.get("NodeId"))
                    child_relop_map[nid] = grandchild
        for child_el in child_relop_map.values():
            node.children.append(self.parse_node(child_el))
        return node

    def _parse_warnings(self, relop_el: ET.Element) -> list[NodeWarning]:
        warnings: list[NodeWarning] = []
        wn = relop_el.find(self._tag("Warnings"))
        if wn is None:
            return warnings
        for child in wn:
            warnings.append(NodeWarning(name=self._strip_tag(child.tag), attributes={k: v for k, v in child.attrib.items()}))
        return warnings

    def _parse_udfs(self, relop_el: ET.Element) -> list[str]:
        out: list[str] = []
        for udf in relop_el.findall(f".//{self._tag('UserDefinedFunction')}"):
            name = udf.get("FunctionName") or udf.get("Name")
            if name:
                out.append(name)
        return out

    def _parse_threads(self, counters: list[ET.Element]) -> list[PerThreadStat]:
        out: list[PerThreadStat] = []
        for c in counters:
            out.append(
                PerThreadStat(
                    thread=self._to_int(c.get("Thread")),
                    actual_rows=self._to_float(c.get("ActualRows")),
                    actual_elapsed_ms=self._to_float(c.get("ActualElapsedms")),
                    actual_logical_reads=self._to_float(c.get("ActualLogicalReads")),
                )
            )
        return out

    def _first_scalar(self, relop_el: ET.Element, name: str) -> str | None:
        container = relop_el.find(f".//{self._tag(name)}")
        if container is None:
            return None
        parts = [
            el.get("ScalarString", "")
            for el in container.iter(self._tag("ScalarOperator"))
            if el.get("ScalarString")
        ]
        return "; ".join(parts) if parts else None

    def _table(self, relop_el: ET.Element) -> str | None:
        obj = relop_el.find(f".//{self._tag('Object')}")
        if obj is None:
            return None
        schema = (obj.get("Schema") or "").strip("[]")
        table = (obj.get("Table") or "").strip("[]")
        if not table:
            return None
        return f"{schema}.{table}" if schema else table

    def _index(self, relop_el: ET.Element) -> str | None:
        obj = relop_el.find(f".//{self._tag('Object')}")
        if obj is None:
            return None
        return (obj.get("Index") or "").strip("[]") or None

    def _index_kind(self, relop_el: ET.Element) -> str | None:
        obj = relop_el.find(f".//{self._tag('Object')}")
        if obj is None:
            return None
        kind = (obj.get("IndexKind") or "").strip()
        return kind or None

    def _strip_tag(self, tag: str) -> str:
        return tag.split("}", 1)[-1] if "}" in tag else tag

    def _tag(self, name: str) -> str:
        return f"{{{SHOWPLAN_URI}}}{name}"

    def _to_int(self, value: str | None) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    def _to_float(self, value: str | None) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
