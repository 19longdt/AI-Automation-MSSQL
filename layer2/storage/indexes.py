"""
indexes.py — Khởi tạo MongoDB indexes cho Layer 2 collections.

Gọi 1 lần sau khi MongoConnection.initialize() thành công.
create_index() với existing index là idempotent — safe để gọi mỗi lần restart.

Collections Layer 2:
  ai_analyses:        90 ngày TTL — kết quả phân tích + tool calls
  issue_insights:     không TTL   — structured insights, lịch sử dài hạn
  db_context:         không TTL   — singleton schema/AG/RG context
  analysis_sessions:  8 giờ TTL   — multi-turn conversation state (Telegram)
"""
from __future__ import annotations

import logging

from pymongo import ASCENDING, DESCENDING
from pymongo.database import Database
from pymongo.operations import IndexModel

logger = logging.getLogger(__name__)

# TTL values (giây)
TTL_AI_ANALYSES_SEC = 90 * 24 * 3600
TTL_ANALYSIS_SESSIONS_SEC = 8 * 3600   # 8 giờ từ last_activity_at


def create_all_indexes(db: Database) -> None:
    """
    Tạo tất cả indexes và TTL cho Layer 2 collections.
    Idempotent — safe để gọi mỗi lần restart.
    """
    _create_ai_analyses_indexes(db)
    _create_issue_insights_indexes(db)
    _create_db_context_indexes(db)
    _create_analysis_sessions_indexes(db)
    logger.info("MongoDB Layer 2 indexes created/verified.")


def _create_ai_analyses_indexes(db: Database) -> None:
    """
    (finding_id), (skill_id, started_at), (status, started_at), TTL on started_at.
    finding_id unique=False — 1 finding có thể được phân tích nhiều lần (follow-up).
    """
    col = db["ai_analyses"]
    col.create_indexes([
        IndexModel(
            [("finding_id", ASCENDING), ("started_at", DESCENDING)],
            name="finding_time",
        ),
        IndexModel(
            [("skill_id", ASCENDING), ("started_at", DESCENDING)],
            name="skill_time",
        ),
        IndexModel(
            [("status", ASCENDING), ("started_at", DESCENDING)],
            name="status_time",
        ),
        IndexModel(
            [("started_at", ASCENDING)],
            expireAfterSeconds=TTL_AI_ANALYSES_SEC,
            name="ttl_started_at",
        ),
    ])


def _create_issue_insights_indexes(db: Database) -> None:
    """
    Không TTL — lưu vĩnh viễn để aggregate long-term trends.
    Upsert key: (root_cause_category, affected_tables) — xem insight_repo.py.
    """
    col = db["issue_insights"]
    col.create_indexes([
        IndexModel(
            [("root_cause_category", ASCENDING), ("detected_at", DESCENDING)],
            name="root_cause_time",
        ),
        IndexModel(
            [("affected_tables", ASCENDING), ("detected_at", DESCENDING)],
            name="tables_time",
        ),
        IndexModel(
            [("systemic", ASCENDING), ("detected_at", DESCENDING)],
            name="systemic_time",
        ),
        IndexModel(
            [("actions.resolved", ASCENDING), ("actions.priority", ASCENDING)],
            name="actions_resolved_priority",
        ),
        IndexModel(
            [("recurrence_count", DESCENDING)],
            name="recurrence_count_desc",
        ),
        IndexModel(
            [("issue_type", ASCENDING), ("detected_at", DESCENDING)],
            name="issue_type_time",
        ),
    ])


def _create_db_context_indexes(db: Database) -> None:
    """
    Singleton document với context_id='main'.
    Unique index để enforce singleton + fast lookup.
    """
    col = db["db_context"]
    col.create_indexes([
        IndexModel(
            [("context_id", ASCENDING)],
            unique=True,
            name="unique_context_id",
        ),
    ])


def _create_analysis_sessions_indexes(db: Database) -> None:
    """
    TTL 8h trên last_activity_at — session tự xóa sau 8h không hoạt động.
    Index trên telegram_message_id để bot lookup nhanh khi DBA reply.
    """
    col = db["analysis_sessions"]
    col.create_indexes([
        IndexModel(
            [("telegram_message_id", ASCENDING)],
            sparse=True,
            name="telegram_message_id",
        ),
        IndexModel(
            [("finding_id", ASCENDING)],
            name="finding_id",
        ),
        IndexModel(
            [("status", ASCENDING), ("last_activity_at", DESCENDING)],
            name="status_activity",
        ),
        # TTL index trên last_activity_at — 8h từ lần activity cuối
        IndexModel(
            [("last_activity_at", ASCENDING)],
            expireAfterSeconds=TTL_ANALYSIS_SESSIONS_SEC,
            name="ttl_last_activity_at",
        ),
    ])
