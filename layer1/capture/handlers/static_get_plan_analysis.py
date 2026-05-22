"""Static handler for get_plan_analysis."""
from __future__ import annotations

import time
from typing import Any

from ...models.findings import Finding
from ..plan_analyzer import analyze_plan


def run(finding: Finding) -> tuple[dict[str, Any], list[str]]:
    """Analyze plan XML and return a normalized result plus extracted table names."""
    plan_xml = (finding.metrics or {}).get("query_plan_xml") or ""
    if not plan_xml:
        return ({"status": "skipped", "rows": [], "row_count": 0, "reason": "no query_plan_xml"}, [])

    start = time.monotonic()
    try:
        parsed = analyze_plan(plan_xml)
        tables = [
            operator["table"].split(".")[-1]
            for operator in parsed.get("top_operators", [])
            if operator.get("table")
        ]
        return (
            {
                "status": "ok",
                "rows": [parsed],
                "row_count": 1,
                "duration_ms": round((time.monotonic() - start) * 1000, 1),
            },
            tables,
        )
    except Exception as exc:
        return ({"status": "error", "rows": [], "row_count": 0, "error": str(exc)}, [])
