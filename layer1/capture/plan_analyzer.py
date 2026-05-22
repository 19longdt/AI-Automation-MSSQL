"""
plan_analyzer.py - Deterministic SQL Server execution-plan XML summarizer.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

SHOWPLAN_NS = {"sp": "http://schemas.microsoft.com/sqlserver/2004/07/showplan"}
SHOWPLAN_URI = SHOWPLAN_NS["sp"]

_INTERESTING_OPERATORS = {
    "Index Scan",
    "Table Scan",
    "Clustered Index Scan",
    "Index Seek",
    "Clustered Index Seek",
    "Key Lookup",
    "RID Lookup",
    "Sort",
    "Hash Match",
    "Nested Loops",
    "Merge Join",
}


def analyze_plan(plan_xml: str) -> dict[str, Any]:
    """Parse SQL Server Showplan XML and extract a compact summary."""
    if not plan_xml or not plan_xml.strip():
        return {"error": "Empty plan XML"}

    try:
        root = ET.fromstring(plan_xml)
    except ET.ParseError as exc:
        return {"error": f"XML parse error: {exc}"}

    return {
        "top_operators": _extract_operators(root),
        "warnings": _extract_warnings(root),
        "partition_info": _extract_partition_info(root),
        "implicit_conversions": _extract_conversions(root),
        "missing_index_hints": _extract_missing_indexes(root),
        "parallelism": _extract_parallelism(root),
        "spill_warnings": _extract_spills(root),
        "estimated_cost": _extract_total_cost(root),
    }


def _extract_operators(root: ET.Element) -> list[dict[str, Any]]:
    operators: list[dict[str, Any]] = []
    for relop in root.iter(_tag("RelOp")):
        op_type = relop.get("PhysicalOp", "")
        if op_type not in _INTERESTING_OPERATORS:
            continue

        estimated_rows = _to_float(relop.get("EstimateRows"))
        estimated_cost = _to_float(relop.get("EstimatedTotalSubtreeCost"))
        actual_rows = _first_float(
            relop.get("ActualRows"),
            relop.get("ActualRowsRead"),
        )
        table_name, index_name = _extract_object_info(relop)

        item: dict[str, Any] = {
            "type": op_type,
            "table": table_name,
            "index": index_name,
            "estimated_rows": estimated_rows,
            "estimated_cost": round(estimated_cost, 4),
        }
        if actual_rows is not None:
            item["actual_rows"] = actual_rows
            if estimated_rows > 0:
                item["estimate_ratio"] = round(actual_rows / estimated_rows, 2)
        operators.append(item)

    operators.sort(key=lambda x: x.get("estimated_cost", 0.0), reverse=True)
    return operators[:10]


def _extract_warnings(root: ET.Element) -> list[str]:
    warnings: set[str] = set()
    for warning_node in root.iter(_tag("Warnings")):
        for child in warning_node:
            warnings.add(_strip_tag(child.tag))
            for attr_name, attr_value in child.attrib.items():
                if attr_value and attr_value not in ("0", "false", "False"):
                    warnings.add(f"{_strip_tag(child.tag)}:{attr_name}")
    return sorted(warnings)


def _extract_partition_info(root: ET.Element) -> dict[str, Any] | None:
    for relop in root.iter(_tag("RelOp")):
        actual = relop.get("ActualPartitionsAccessed")
        estimated = relop.get("EstimatedPartitionCount")
        if actual or estimated:
            parts = actual or estimated or ""
            return {
                "partitions_accessed": parts,
                "estimated_partition_count": _to_int(estimated),
                "likely_full_scan": ".." in parts,
            }
    return None


def _extract_conversions(root: ET.Element) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for scalar in root.iter(_tag("ScalarOperator")):
        scalar_string = scalar.get("ScalarString", "")
        if "CONVERT_IMPLICIT" in scalar_string:
            results.append({"expression": scalar_string[:300]})
    return results[:5]


def _extract_missing_indexes(root: ET.Element) -> list[dict[str, Any]]:
    hints: list[dict[str, Any]] = []
    for group in root.iter(_tag("MissingIndexGroup")):
        impact = _to_float(group.get("Impact"))
        for index in group.iter(_tag("MissingIndex")):
            database = index.get("Database", "").strip("[]")
            schema = index.get("Schema", "").strip("[]")
            table = index.get("Table", "").strip("[]")
            entry = {
                "database": database,
                "schema": schema,
                "table": table,
                "impact": impact,
                "equality_columns": [],
                "inequality_columns": [],
                "include_columns": [],
            }
            for group_cols in index.iter(_tag("ColumnGroup")):
                usage = group_cols.get("Usage", "").lower()
                cols = [
                    col.get("Name", "").strip("[]")
                    for col in group_cols.iter(_tag("Column"))
                    if col.get("Name")
                ]
                if usage == "equality":
                    entry["equality_columns"] = cols
                elif usage == "inequality":
                    entry["inequality_columns"] = cols
                elif usage == "include":
                    entry["include_columns"] = cols
            hints.append(entry)
    hints.sort(key=lambda x: x.get("impact", 0.0), reverse=True)
    return hints[:5]


def _extract_parallelism(root: ET.Element) -> dict[str, Any]:
    query_plan = root.find(f".//{_tag('QueryPlan')}")
    dop = _to_int(query_plan.get("DegreeOfParallelism") if query_plan is not None else None)

    exchange_ops = 0
    for relop in root.iter(_tag("RelOp")):
        if relop.get("PhysicalOp") == "Parallelism":
            exchange_ops += 1

    return {
        "dop": dop,
        "parallel_operator_count": exchange_ops,
        "is_parallel": bool(dop and dop > 1 or exchange_ops > 0),
    }


def _extract_spills(root: ET.Element) -> list[dict[str, Any]]:
    spills: list[dict[str, Any]] = []
    for relop in root.iter(_tag("RelOp")):
        op_type = relop.get("PhysicalOp", "")
        warning_node = relop.find(_tag("Warnings"))
        if warning_node is None:
            continue
        warning_names = [_strip_tag(child.tag) for child in warning_node]
        if any(name in {"SpillToTempDb", "HashSpillDetails", "SortSpillDetails"} for name in warning_names):
            table_name, index_name = _extract_object_info(relop)
            spills.append(
                {
                    "operator": op_type,
                    "table": table_name,
                    "index": index_name,
                    "warnings": warning_names,
                }
            )
    return spills[:10]


def _extract_total_cost(root: ET.Element) -> float | None:
    stmt = root.find(f".//{_tag('StmtSimple')}")
    if stmt is not None:
        value = stmt.get("StatementSubTreeCost")
        if value is not None:
            return round(_to_float(value), 4)
    query_plan = root.find(f".//{_tag('QueryPlan')}")
    if query_plan is not None:
        value = query_plan.get("CachedPlanSize")
        if value is not None:
            return round(_to_float(value), 4)
    return None


def _extract_object_info(relop: ET.Element) -> tuple[str, str]:
    for obj in relop.iter(_tag("Object")):
        schema = obj.get("Schema", "").strip("[]")
        table = obj.get("Table", "").strip("[]")
        index = obj.get("Index", "").strip("[]")
        if table:
            full = f"{schema}.{table}" if schema else table
            return full, index
    return "", ""


def _tag(name: str) -> str:
    return f"{{{SHOWPLAN_URI}}}{name}"


def _strip_tag(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _first_float(*values: Any) -> float | None:
    for value in values:
        try:
            if value is None:
                continue
            return float(value)
        except (TypeError, ValueError):
            continue
    return None
