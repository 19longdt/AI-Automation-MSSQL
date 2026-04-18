"""
leader_repo.py — MongoDB operations cho Leader Election.

Dùng findOneAndUpdate với upsert để atomic election — đảm bảo chỉ 1 instance
giành được leader dù nhiều instances cùng race lúc startup hoặc failover.
"""
from __future__ import annotations

import logging
from datetime import datetime

from ..mongo_client import MongoConnection
from ...models.job import LeaderInfo

logger = logging.getLogger(__name__)

COLLECTION = "cluster_leader"


class LeaderRepo:

    @property
    def collection(self): ...

    def try_become_leader(self, leader_id: str, leader_host: str, ttl_sec: int) -> bool:
        """
        Thử ghi leader document. Trả về True nếu thành công (là leader mới).
        Dùng filter {singleton_key: "leader"} + upsert để atomic.
        Nếu document đã tồn tại (leader khác đang alive) → trả về False.
        """
        ...

    def update_heartbeat(self, leader_id: str, ttl_sec: int) -> bool:
        """
        Update heartbeat_at và expires_at. Trả về False nếu leader_id không khớp
        (trường hợp leadership bị mất — không nên xảy ra nhưng cần handle).
        """
        ...

    def get_current_leader(self) -> LeaderInfo | None:
        """Trả về None nếu không có leader (document đã TTL expire)."""
        ...

    def release_leadership(self, leader_id: str) -> None:
        """Xóa leader document khi instance shutdown gracefully."""
        ...
