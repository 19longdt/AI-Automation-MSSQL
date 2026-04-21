"""
session_repo.py — Repository cho collection `analysis_sessions`.

TTL 8h trên last_activity_at — session tự xóa sau 8h không hoạt động.

Chỉ lưu text turns, KHÔNG lưu raw tool call/result blocks.
Tool calls đầy đủ đã có trong ai_analyses.tool_calls[].
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from ...utils.time_utils import now_vn
from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "analysis_sessions"


class SessionRepo:

    @property
    def _col(self):
        return MongoConnection.get_db()[COLLECTION]

    def create(
        self,
        finding_id: str,
        channel: str,
        first_turn_text: str,
        analysis_id: str,
        telegram_message_id: int | None = None,
    ) -> str:
        """
        Tạo session mới sau lần phân tích đầu tiên.
        Trả về session_id.
        """
        session_id = str(uuid4())
        now = now_vn()
        doc = {
            "session_id": session_id,
            "finding_id": finding_id,
            "channel": channel,
            "telegram_message_id": telegram_message_id,
            "turns": [
                {
                    "role": "assistant",
                    "content": first_turn_text,
                    "analysis_id": analysis_id,
                }
            ],
            "turn_count": 1,
            "status": "active",
            "created_at": now,
            "last_activity_at": now,
        }
        self._col.insert_one(doc)
        logger.debug("Session created session_id=%s finding_id=%s", session_id, finding_id)
        return session_id

    def find_by_telegram_message_id(self, message_id: int) -> dict[str, Any] | None:
        """Lookup session khi DBA reply vào analysis message."""
        doc = self._col.find_one({"telegram_message_id": message_id, "status": "active"})
        if doc:
            doc.pop("_id", None)
        return doc

    def find_by_id(self, session_id: str) -> dict[str, Any] | None:
        doc = self._col.find_one({"session_id": session_id})
        if doc:
            doc.pop("_id", None)
        return doc

    def append_turns(
        self,
        session_id: str,
        user_text: str,
        assistant_text: str,
        analysis_id: str,
    ) -> None:
        """Append user turn + assistant turn sau follow-up. Cập nhật last_activity_at."""
        new_turns = [
            {"role": "user", "content": user_text, "analysis_id": None},
            {"role": "assistant", "content": assistant_text, "analysis_id": analysis_id},
        ]
        self._col.update_one(
            {"session_id": session_id},
            {
                "$push": {"turns": {"$each": new_turns}},
                "$inc": {"turn_count": 2},
                "$set": {"last_activity_at": now_vn()},
            },
        )

    def close(self, session_id: str) -> None:
        """Đóng session thủ công (ví dụ: DBA gõ /done)."""
        self._col.update_one(
            {"session_id": session_id},
            {"$set": {"status": "closed", "last_activity_at": now_vn()}},
        )
