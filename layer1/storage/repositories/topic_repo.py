"""topic_repo.py — CRUD cho collection `monitor_topics`."""
from __future__ import annotations

import logging

from ..mongo_client import MongoConnection
from ...models.topic import MonitorTopic

logger = logging.getLogger(__name__)

COLLECTION = "monitor_topics"


class TopicRepo:

    @property
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def find_all_enabled(self) -> list[MonitorTopic]:
        """Trả về tất cả topics có enabled=True. Dùng khi startup để register jobs."""
        try:
            docs = self.collection.find({"enabled": True})
            return [MonitorTopic(**doc) for doc in docs]
        except Exception as exc:
            logger.error("find_all_enabled failed: %s", exc)
            return []

    def find_by_id(self, topic_id: str) -> MonitorTopic | None:
        """Đọc 1 topic theo ID. Dùng khi reload config mỗi job run."""
        try:
            doc = self.collection.find_one({"topic_id": topic_id})
            if doc is None:
                return None
            return MonitorTopic(**doc)
        except Exception as exc:
            logger.error("find_by_id failed: topic_id=%s error=%s", topic_id, exc)
            return None

    def upsert(self, topic: MonitorTopic) -> None:
        """Insert hoặc update topic. Dùng khi seed initial config."""
        self.collection.update_one(
            {"topic_id": topic.topic_id},
            {"$set": topic.model_dump()},
            upsert=True,
        )

    def disable(self, topic_id: str) -> None:
        """Set enabled=False."""
        self.collection.update_one(
            {"topic_id": topic_id},
            {"$set": {"enabled": False}},
        )
