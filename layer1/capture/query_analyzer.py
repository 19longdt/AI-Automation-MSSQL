"""
query_analyzer.py - Best-effort structural SQL summarizer for Layer 2.
"""
from __future__ import annotations

import re
from typing import Any

_SPACE_RE = re.compile(r"\s+")
_FROM_RE = re.compile(
    r"\bFROM\s+(?:\[?(?P<schema>\w+)\]?\.)?\[?(?P<table>\w+)\]?(?:\s+(?:AS\s+)?(?P<alias>\w+))?",
    re.IGNORECASE,
)
_JOIN_RE = re.compile(
    r"\b(?P<join_type>(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN)\s+"
    r"(?:\[?(?P<schema>\w+)\]?\.)?\[?(?P<table>\w+)\]?",
    re.IGNORECASE,
)
_WHERE_RE = re.compile(r"\bWHERE\b(?P<where>.*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bOPTION\b|$)", re.IGNORECASE | re.DOTALL)
_ORDER_RE = re.compile(r"\bORDER\s+BY\b(?P<order>.*?)(?:\bOPTION\b|$)", re.IGNORECASE | re.DOTALL)
_GROUP_RE = re.compile(r"\bGROUP\s+BY\b(?P<group>.*?)(?:\bORDER\s+BY\b|\bOPTION\b|$)", re.IGNORECASE | re.DOTALL)
_FUNCTION_ON_COL_RE = re.compile(
    r"\b(?P<fn>YEAR|MONTH|DAY|DATEPART|DATEDIFF|CONVERT|CAST|ISNULL|COALESCE)\s*\(\s*(?P<col>[\w\.\[\]]+)",
    re.IGNORECASE,
)


def analyze_query(sql: str) -> dict[str, Any]:
    """Extract coarse structural signals from one SQL statement."""
    if not sql or not sql.strip():
        return {"error": "Empty query text"}

    normalized = _normalize_sql(sql)
    tables = _extract_tables(normalized)
    joins = _extract_joins(normalized)
    where_clause = _extract_clause(_WHERE_RE, normalized, 500)
    order_by = _extract_clause(_ORDER_RE, normalized, 200)
    group_by = _extract_clause(_GROUP_RE, normalized, 200)
    function_calls = _extract_function_on_columns(normalized)

    return {
        "query_type": _detect_query_type(normalized),
        "tables": tables,
        "joins": joins,
        "where_clause": where_clause,
        "order_by": order_by,
        "group_by": group_by,
        "function_calls": function_calls[:10],
        "has_partition_filter": any("norm_quarter" in part.lower() for part in [where_clause, order_by, group_by] if part),
    }


def _normalize_sql(sql: str) -> str:
    text = sql.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    return _SPACE_RE.sub(" ", text).strip()


def _extract_tables(sql: str) -> list[dict[str, str]]:
    tables: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()

    from_match = _FROM_RE.search(sql)
    if from_match:
        item = _table_dict(from_match.group("schema"), from_match.group("table"), from_match.group("alias"))
        key = (item["schema"], item["name"], item["alias"])
        if item["name"] and key not in seen:
            seen.add(key)
            tables.append(item)

    for match in _JOIN_RE.finditer(sql):
        item = _table_dict(match.group("schema"), match.group("table"), "")
        key = (item["schema"], item["name"], item["alias"])
        if item["name"] and key not in seen:
            seen.add(key)
            tables.append(item)

    return tables


def _extract_joins(sql: str) -> list[dict[str, str]]:
    joins: list[dict[str, str]] = []
    for match in _JOIN_RE.finditer(sql):
        schema = match.group("schema") or "dbo"
        table = match.group("table") or ""
        joins.append(
            {
                "type": _SPACE_RE.sub(" ", (match.group("join_type") or "").upper()).strip(),
                "table": f"{schema}.{table}" if table else "",
            }
        )
    return joins


def _extract_clause(pattern: re.Pattern[str], sql: str, limit: int) -> str:
    match = pattern.search(sql)
    if not match:
        return ""
    text = match.group(match.lastgroup or 1).strip()
    return text[:limit] if len(text) > limit else text


def _extract_function_on_columns(sql: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    for match in _FUNCTION_ON_COL_RE.finditer(sql):
        results.append(
            {
                "function": (match.group("fn") or "").upper(),
                "column": match.group("col") or "",
            }
        )
    return results


def _detect_query_type(sql: str) -> str:
    upper = sql.upper().lstrip()
    for keyword in ("SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "EXEC", "WITH"):
        if upper.startswith(keyword):
            return keyword
    return "OTHER"


def _table_dict(schema: str | None, table: str | None, alias: str | None) -> dict[str, str]:
    return {
        "schema": schema or "dbo",
        "name": table or "",
        "alias": alias or "",
    }
