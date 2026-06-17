"""
analysis_repo.py — Repository cho collection `ai_analyses`.

Lưu kết quả analysis bao gồm tool calls, analysis text và token usage.
1 finding có thể có nhiều analysis records (initial + follow-up turns).
"""
from __future__ import annotations

import logging
from datetime import datetime

from ...models.analysis import AnalysisResult, AnalysisStatus
from ...utils.time_utils import now_vn
from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "ai_analyses"


class AnalysisRepo:

    @property
    def _col(self):
        return MongoConnection.get_db()[COLLECTION]

    def insert(self, result: AnalysisResult) -> str:
        """Insert analysis record mới. Trả về analysis_id."""
        doc = result.model_dump()
        self._col.insert_one(doc)
        logger.debug("Inserted analysis analysis_id=%s finding_id=%s", result.analysis_id, result.finding_id)
        return result.analysis_id

    def update_completed(self, result: AnalysisResult) -> None:
        """Cập nhật toàn bộ result sau khi agentic loop kết thúc."""
        self._col.update_one(
            {"analysis_id": result.analysis_id},
            {"$set": result.model_dump()},
        )

    def update_status(self, analysis_id: str, status: AnalysisStatus, error: str | None = None) -> None:
        """Cập nhật status (và error nếu có) — dùng khi timeout hoặc fail."""
        update: dict = {"$set": {"status": status.value, "completed_at": now_vn()}}
        if error is not None:
            update["$set"]["error"] = error
        self._col.update_one({"analysis_id": analysis_id}, update)

    def find_by_id(self, analysis_id: str) -> AnalysisResult | None:
        doc = self._col.find_one({"analysis_id": analysis_id})
        if not doc:
            return None
        doc.pop("_id", None)
        return AnalysisResult(**doc)

    def find_by_finding_id(self, finding_id: str, limit: int = 10) -> list[AnalysisResult]:
        """Trả về tất cả analyses của 1 finding, mới nhất trước."""
        docs = self._col.find(
            {"finding_id": finding_id},
            sort=[("started_at", -1)],
            limit=limit,
        )
        return [AnalysisResult(**{k: v for k, v in doc.items() if k != "_id"}) for doc in docs]

    def list_recent(
        self,
        issue_type: str | None = None,
        cluster_id: str | None = None,
        node: str | None = None,
        status: str | None = None,
        since: datetime | None = None,
        limit: int = 50,
    ) -> list[AnalysisResult]:
        """List analyses với filter tùy chọn — dùng cho GET /analyses."""
        query: dict = {}
        if issue_type:
            query["finding_snapshot.issue_type"] = issue_type
        if cluster_id:
            query["finding_snapshot.cluster_id"] = cluster_id
        if node:
            query["finding_snapshot.node"] = node
        if status:
            query["status"] = status
        if since:
            query["started_at"] = {"$gte": since}

        docs = self._col.find(query, sort=[("started_at", -1)], limit=limit)
        return [AnalysisResult(**{k: v for k, v in doc.items() if k != "_id"}) for doc in docs]
