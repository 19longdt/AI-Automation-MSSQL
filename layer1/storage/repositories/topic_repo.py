"""topic_repo.py — CRUD cho collection `monitor_topics`."""
from __future__ import annotations

import logging

from ..mongo_client import MongoConnection
from ...models.topic import MonitorTopic

logger = logging.getLogger(__name__)

COLLECTION = "monitor_topics"


class TopicRepo:

    @property
    def collection(self): ...

    def find_all_enabled(self) -> list[MonitorTopic]:
        """Trả về tất cả topics có enabled=True. Dùng khi startup để register jobs."""
        ...

    def find_by_id(self, topic_id: str) -> MonitorTopic | None:
        """Đọc 1 topic theo ID. Dùng khi reload config mỗi job run."""
        ...

    def upsert(self, topic: MonitorTopic) -> None:
        """Insert hoặc update topic. Dùng khi seed initial config."""
        ...

    def disable(self, topic_id: str) -> None:
        """Set enabled=False."""
        ...
