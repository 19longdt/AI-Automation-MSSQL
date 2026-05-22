"""Mongo handler for get_table_context."""
from __future__ import annotations

from typing import Any

from ...models.findings import Finding
from ...storage.mongo_client import MongoConnection


def run(finding: Finding, affected_tables: list[str]) -> dict[str, Any]:
    """Attach business-context matches for affected tables."""
    _ = finding
    db = MongoConnection.get_db()
    try:
        context_doc = db["db_context"].find_one({"context_id": "main"}, {"business_context": 1, "_id": 0})
        if context_doc and affected_tables:
            context_text = str(context_doc.get("business_context", ""))
            matched = [
                {"table_name": table, "found_in_context": table.lower() in context_text.lower()}
                for table in affected_tables[:3]
            ]
            return {"status": "ok", "rows": matched, "row_count": len(matched), "duration_ms": 0}
        return {"status": "skipped", "rows": [], "row_count": 0, "reason": "no db_context or no tables"}
    except Exception as exc:
        return {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}
