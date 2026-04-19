"""findings_repo.py — Repository cho collection `findings`."""
from __future__ import annotations

import logging
from datetime import datetime

from ..mongo_client import MongoConnection
from ...models.common import IssueType
from ...models.findings import Finding

logger = logging.getLogger(__name__)

COLLECTION = "findings"


class FindingsRepo:

    @property
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def insert(self, finding: Finding) -> str:
        """Insert 1 finding, trả về inserted _id."""
        doc = finding.model_dump()
        result = self.collection.insert_one(doc)
        return str(result.inserted_id)

    def update_status(
        self,
        finding_id: str,
        status: str,
        ai_analysis_id: str | None = None,
    ) -> None:
        update: dict = {"$set": {"status": status}}
        if ai_analysis_id is not None:
            update["$set"]["ai_analysis_id"] = ai_analysis_id
        self.collection.update_one({"finding_id": finding_id}, update)

    def find_recent_by_type(
        self,
        issue_type: IssueType,
        node: str,
        since: datetime,
        limit: int = 50,
    ) -> list[Finding]:
        docs = self.collection.find(
            {
                "issue_type": issue_type.value,
                "node": node,
                "detected_at": {"$gte": since},
            },
            limit=limit,
            sort=[("detected_at", -1)],
        )
        return [Finding(**doc) for doc in docs]

    def find_by_id_prefix(self, prefix: str) -> Finding | None:
        """Tìm finding theo 8+ ký tự đầu của finding_id. Dùng cho /analyze command."""
        import re
        doc = self.collection.find_one(
            {"finding_id": {"$regex": f"^{re.escape(prefix)}"}}
        )
        if not doc:
            return None
        doc.pop("_id", None)
        return Finding(**doc)

    def find_pending_ai_analysis(self, limit: int = 20) -> list[Finding]:
        """Trả về findings có status='new' để Layer 2 xử lý."""
        docs = self.collection.find(
            {"status": "new"},
            limit=limit,
            sort=[("detected_at", 1)],
        )
        return [Finding(**doc) for doc in docs]
