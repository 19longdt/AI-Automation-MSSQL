"""Mongo handler for get_analysis_history."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from ...models.findings import Finding
from ...storage.mongo_client import MongoConnection


def run(finding: Finding, affected_tables: list[str]) -> dict[str, Any]:
    """Attach top recurring insight records for the same issue_type/node."""
    _ = affected_tables
    db = MongoConnection.get_db()
    try:
        insights = list(
            db["issue_insights"].find(
                {"issue_type": str(finding.issue_type), "node": finding.node},
                projection={
                    "_id": 0,
                    "issue_type": 1,
                    "root_cause_summary": 1,
                    "recurrence_count": 1,
                    "updated_at": 1,
                },
                sort=[("recurrence_count", -1)],
                limit=5,
            )
        )
        for doc in insights:
            if isinstance(doc.get("updated_at"), datetime):
                doc["updated_at"] = doc["updated_at"].isoformat()
        return {"status": "ok", "rows": insights, "row_count": len(insights), "duration_ms": 0}
    except Exception as exc:
        return {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}
