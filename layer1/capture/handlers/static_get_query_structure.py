"""Static handler for get_query_structure."""
from __future__ import annotations

import time
from typing import Any

from ...models.findings import Finding
from ..query_analyzer import analyze_query


def run(finding: Finding) -> tuple[dict[str, Any], list[str]]:
    """Analyze query text and return a normalized result plus extracted table names."""
    query_text = finding.query_text or ""
    if not query_text:
        return ({"status": "skipped", "rows": [], "row_count": 0, "reason": "no query_text"}, [])

    start = time.monotonic()
    try:
        parsed = analyze_query(query_text)
        tables = [table["name"] for table in parsed.get("tables", []) if table.get("name")]
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
