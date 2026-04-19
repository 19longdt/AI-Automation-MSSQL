"""
node_role_cache.py — Detect và cache Primary/Secondary roles từ AG cluster.

Trong AG cluster, Primary có thể failover bất kỳ lúc nào.
KHÔNG hardcode node nào là Primary — detect dynamically từ DMV
và cache in-memory + MongoDB.

Lifecycle:
  Startup: query sys.dm_hadr_availability_replica_states → cache roles
  Refresh: mỗi node_role_refresh_sec (default 1 giờ), chạy như APScheduler job
  Resolve: topic config nodes=["primary"] → resolve thành hostname thực tế từ cache

Query detect role (chạy trên BẤT KỲ node nào reachable):
  SELECT ar.replica_server_name, ars.role_desc
  FROM sys.dm_hadr_availability_replica_states ars
  JOIN sys.availability_replicas ar ON ars.replica_id = ar.replica_id
"""
from __future__ import annotations

import logging
from datetime import datetime

from ..config import settings
from .mssql_connection import mssql_connection

logger = logging.getLogger(__name__)

# Query lấy role — chạy trên bất kỳ node nào trong AG cluster
_ROLE_DETECT_SQL = """
SELECT ar.replica_server_name AS host,
       ars.role_desc AS role
FROM sys.dm_hadr_availability_replica_states ars
JOIN sys.availability_replicas ar
  ON ars.replica_id = ar.replica_id
"""


class NodeInfo:
    """Thông tin 1 node trong cache."""

    def __init__(self, host: str, role: str, detected_at: datetime) -> None:
        self.host = host
        self.role = role.lower()  # "primary" | "secondary"
        self.detected_at = detected_at

    @property
    def is_primary(self) -> bool: ...

    @property
    def is_secondary(self) -> bool: ...


class NodeRoleCache:
    """
    In-memory cache cho AG node roles.
    Thread-safe: chỉ đọc cache khi resolve, chỉ ghi khi refresh.
    Refresh chạy trên 1 thread riêng (APScheduler job).
    """

    def __init__(self) -> None:
        self._nodes: dict[str, NodeInfo] = {}
        self._last_refresh: datetime | None = None

    def initialize(self) -> None:
        """
        Gọi 1 lần khi startup. Thử query từng node cho đến khi 1 node trả về
        role info cho toàn cluster. Raise nếu KHÔNG có node nào reachable.
        """
        ...

    def refresh(self) -> None:
        """
        Refresh roles từ AG DMV. Gọi bởi APScheduler job mỗi refresh interval.
        Log WARNING nếu Primary thay đổi so với lần refresh trước (failover detected).
        Không raise — nếu tất cả nodes unreachable thì giữ cache cũ.
        """
        ...

    def resolve(self, node_targets: list[str]) -> list[tuple[str, str]]:
        """
        Resolve danh sách node targets từ topic config thành [(host, role)].

        Mapping:
          "primary"     → [(primary_host, "primary")]
          "secondary"   → [(sec1, "secondary"), (sec2, "secondary")]
          "all"         → [(node1, role1), (node2, role2), ...]
          "SQL-NODE-01" → [("SQL-NODE-01", resolved_role)]  # hostname cụ thể
        """
        ...

    def get_primary_host(self) -> str | None:
        """Trả về hostname của Primary hiện tại. None nếu cache chưa init."""
        ...

    def get_secondary_hosts(self) -> list[str]:
        """Trả về list hostname của tất cả Secondaries."""
        ...

    def get_all_nodes(self) -> list[NodeInfo]:
        """Trả về tất cả nodes trong cache."""
        ...

    def is_stale(self, max_age_sec: int = 7200) -> bool:
        """Cache cũ hơn max_age_sec (default 2 giờ) coi là stale."""
        ...

    def _detect_roles(self) -> dict[str, NodeInfo]:
        """Query AG DMV trên first reachable node, trả về {host: NodeInfo}."""
        ...

    def _persist_to_mongo(self) -> None:
        """Ghi node roles vào MongoDB `node_roles` collection (optional backup)."""
        ...
