"""findings_repo.py — Repository cho collection `findings`."""
from __future__ import annotations

import logging
from datetime import datetime

from ..mongo_client import MongoConnection
from ...models.common import IssueType, Severity
from ...models.findings import Finding

logger = logging.getLogger(__name__)

COLLECTION = "findings"


class FindingsRepo:

    @property
    def collection(self): ...

    def insert(self, finding: Finding) -> str:
        """Insert 1 finding, trả về inserted _id."""
        ...

    def update_status(self, finding_id: str, status: str, ai_analysis_id: str | None = None) -> None: ...

    def find_recent_by_type(
        self,
        issue_type: IssueType,
        node: str,
        since: datetime,
        limit: int = 50,
    ) -> list[Finding]: ...

    def find_pending_ai_analysis(self, limit: int = 20) -> list[Finding]:
        """Trả về findings có status='new' để Layer 2 xử lý."""
        ...
