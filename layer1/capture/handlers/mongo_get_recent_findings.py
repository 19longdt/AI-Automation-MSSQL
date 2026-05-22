"""Mongo handler for get_recent_findings."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from ...models.findings import Finding
from ...storage.mongo_client import MongoConnection
from ...utils.time_utils import now_vn


def run(finding: Finding, affected_tables: list[str]) -> dict[str, Any]:
    """Attach recent findings on same node + issue_type in the last 24 hours."""
    _ = affected_tables
    db = MongoConnection.get_db()
    try:
        since = now_vn() - timedelta(hours=24)
        docs = list(
            db["findings"].find(
                {"detected_at": {"$gte": since}, "node": finding.node, "issue_type": str(finding.issue_type)},
                projection={"_id": 0, "finding_id": 1, "severity": 1, "detected_at": 1, "status": 1},
                sort=[("detected_at", -1)],
                limit=10,
            )
        )
        for doc in docs:
            if isinstance(doc.get("detected_at"), datetime):
                doc["detected_at"] = doc["detected_at"].isoformat()
        return {"status": "ok", "rows": docs, "row_count": len(docs), "duration_ms": 0}
    except Exception as exc:
        return {"status": "error", "rows": [], "row_count": 0, "error": str(exc)}
