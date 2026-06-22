"""
insight_repo.py — Repository cho collection `issue_insights`.

Không TTL — lưu vĩnh viễn để aggregate long-term trends ngay cả sau khi
ai_analyses bị xóa sau 90 ngày.

Upsert logic:
  Key = (root_cause_category, affected_tables sorted).
  Nếu cùng pattern đã tồn tại → increment recurrence_count, merge actions mới.
  Nếu chưa tồn tại → insert mới với recurrence_count=1.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

from ...models.analysis import InsightAction, InsightData
from ...utils.time_utils import now_vn
from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "issue_insights"


class InsightRepo:

    @property
    def _col(self):
        return MongoConnection.get_db()[COLLECTION]

    def upsert(
        self,
        analysis_id: str,
        finding_id: str,
        issue_type: str,
        cluster_id: str,
        node: str,
        detected_at: datetime,
        insight: InsightData,
    ) -> str:
        """
        Upsert insight theo (root_cause_category, affected_tables).

        - Nếu chưa có: insert mới, recurrence_count=1.
        - Nếu đã có: increment recurrence_count, merge actions chưa có.

        Trả về insight_id (mới hoặc existing).
        """
        # Key để nhận diện cùng pattern
        affected_tables_sorted = sorted(insight.affected_tables)

        existing = self._col.find_one({
            "root_cause_category": insight.root_cause_category,
            "affected_tables": affected_tables_sorted,
        })

        if existing is None:
            return self._insert_new(
                analysis_id, finding_id, issue_type, cluster_id, node, detected_at, insight,
                affected_tables_sorted,
            )
        else:
            self._increment_recurrence(existing, analysis_id, finding_id, detected_at, insight)
            return str(existing["insight_id"])

    def _insert_new(
        self,
        analysis_id: str,
        finding_id: str,
        issue_type: str,
        cluster_id: str,
        node: str,
        detected_at: datetime,
        insight: InsightData,
        affected_tables_sorted: list[str],
    ) -> str:
        insight_id = str(uuid4())
        doc = {
            "insight_id": insight_id,
            "analysis_id": analysis_id,
            "finding_id": finding_id,
            "cluster_id": cluster_id,
            "detected_at": detected_at,
            "issue_type": issue_type,
            "node": node,
            "root_cause_category": insight.root_cause_category,
            "root_cause_summary": insight.root_cause_summary,
            "affected_tables": affected_tables_sorted,
            "affected_indexes": insight.affected_indexes,
            "affected_queries": insight.affected_queries,
            "actions": [a.model_dump() for a in insight.actions],
            "systemic": insight.systemic,
            "recurrence_count": 1,
            "created_at": now_vn(),
            "updated_at": now_vn(),
        }
        self._col.insert_one(doc)
        logger.debug(
            "New insight inserted insight_id=%s root_cause=%s",
            insight_id, insight.root_cause_category,
        )
        return insight_id

    def _increment_recurrence(
        self,
        existing: dict[str, Any],
        analysis_id: str,
        finding_id: str,
        detected_at: datetime,
        insight: InsightData,
    ) -> None:
        """Tăng recurrence_count và merge actions mới (theo description để tránh duplicate)."""
        existing_descriptions = {
            a["description"] for a in existing.get("actions", [])
        }
        new_actions = [
            a.model_dump()
            for a in insight.actions
            if a.description not in existing_descriptions
        ]

        update: dict[str, Any] = {
            "$inc": {"recurrence_count": 1},
            "$set": {
                "updated_at": now_vn(),
                "last_analysis_id": analysis_id,
                "last_finding_id": finding_id,
                "last_detected_at": detected_at,
            },
        }
        if new_actions:
            update["$push"] = {"actions": {"$each": new_actions}}

        self._col.update_one({"insight_id": existing["insight_id"]}, update)
        logger.debug(
            "Recurrence incremented insight_id=%s count=%d new_actions=%d",
            existing["insight_id"],
            existing.get("recurrence_count", 1) + 1,
            len(new_actions),
        )

    def mark_action_resolved(self, insight_id: str, action_index: int, resolved: bool) -> bool:
        """Toggle resolved flag cho 1 action. Trả về False nếu không tìm thấy."""
        resolved_at = now_vn() if resolved else None
        result = self._col.update_one(
            {"insight_id": insight_id},
            {"$set": {
                f"actions.{action_index}.resolved": resolved,
                f"actions.{action_index}.resolved_at": resolved_at,
                "updated_at": now_vn(),
            }},
        )
        return result.matched_count > 0

    def find_by_id(self, insight_id: str) -> dict[str, Any] | None:
        doc = self._col.find_one({"insight_id": insight_id})
        if doc:
            doc.pop("_id", None)
        return doc

    def list_insights(
        self,
        issue_type: str | None = None,
        cluster_id: str | None = None,
        table: str | None = None,
        root_cause: str | None = None,
        resolved: bool | None = None,
        priority: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """List insights với filter tùy chọn — dùng cho GET /insights."""
        query: dict = {}
        if issue_type:
            query["issue_type"] = issue_type
        if cluster_id:
            query["cluster_id"] = cluster_id
        if table:
            query["affected_tables"] = table
        if root_cause:
            query["root_cause_category"] = root_cause
        if resolved is not None:
            query["actions.resolved"] = resolved
        if priority:
            query["actions.priority"] = priority

        docs = self._col.find(query, sort=[("recurrence_count", -1)], limit=limit)
        return [{k: v for k, v in doc.items() if k != "_id"} for doc in docs]

    def get_summary(self, since: datetime) -> dict[str, Any]:
        """
        Tổng hợp cho /summary command và GET /insights/summary.

        Trả về:
          top_root_causes:    list {root_cause_category, count, tables}
          top_tables:         list {table, incident_count}
          unresolved_arch:    list insights có action type=architecture, resolved=False
          unresolved_backlog: count actions high priority, resolved=False
        """
        pipeline_root_causes = [
            {"$match": {"detected_at": {"$gte": since}}},
            {"$group": {
                "_id": "$root_cause_category",
                "count": {"$sum": "$recurrence_count"},
                "tables": {"$addToSet": "$affected_tables"},
            }},
            {"$sort": {"count": -1}},
            {"$limit": 10},
        ]

        pipeline_tables = [
            {"$match": {"detected_at": {"$gte": since}}},
            {"$unwind": "$affected_tables"},
            {"$group": {
                "_id": "$affected_tables",
                "incident_count": {"$sum": "$recurrence_count"},
            }},
            {"$sort": {"incident_count": -1}},
            {"$limit": 10},
        ]

        top_root_causes = list(self._col.aggregate(pipeline_root_causes))
        top_tables = list(self._col.aggregate(pipeline_tables))

        # Unresolved architectural actions
        unresolved_arch = list(self._col.find(
            {
                "actions": {"$elemMatch": {"type": "architecture", "resolved": False}},
                "detected_at": {"$gte": since},
            },
            sort=[("recurrence_count", -1)],
            limit=10,
        ))
        for doc in unresolved_arch:
            doc.pop("_id", None)

        # Count high priority unresolved actions
        pipeline_backlog = [
            {"$unwind": "$actions"},
            {"$match": {"actions.resolved": False, "actions.priority": "high"}},
            {"$count": "total"},
        ]
        backlog_result = list(self._col.aggregate(pipeline_backlog))
        unresolved_backlog_count = backlog_result[0]["total"] if backlog_result else 0

        return {
            "top_root_causes": [
                {
                    "root_cause_category": r["_id"],
                    "count": r["count"],
                    "tables": [t for group in r["tables"] for t in group],
                }
                for r in top_root_causes
            ],
            "top_tables": [
                {"table": r["_id"], "incident_count": r["incident_count"]}
                for r in top_tables
            ],
            "unresolved_architecture_actions": unresolved_arch,
            "unresolved_high_priority_count": unresolved_backlog_count,
        }
