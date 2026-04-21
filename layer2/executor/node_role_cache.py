"""
node_role_cache.py — Detect và cache AG node roles cho Layer 2.

Phiên bản rút gọn từ layer1 — không có APScheduler, không persist MongoDB.
Layer 2 chỉ cần cache để validate node input từ Claude tool calls.

Refresh: gọi refresh() thủ công từ main.py theo interval hoặc khi detect stale.
"""
from __future__ import annotations

import logging
from datetime import datetime

from ..config import settings
from ..utils.time_utils import now_vn
from .mssql_connection import mssql_connection

logger = logging.getLogger(__name__)

_ROLE_DETECT_SQL = """
SELECT ar.replica_server_name AS host,
       ars.role_desc          AS role
FROM sys.dm_hadr_availability_replica_states ars
JOIN sys.availability_replicas ar ON ars.replica_id = ar.replica_id
"""


class NodeInfo:
    def __init__(self, host: str, role: str, detected_at: datetime) -> None:
        self.host = host
        self.role = role.lower()
        self.detected_at = detected_at

    @property
    def is_primary(self) -> bool:
        return self.role == "primary"


class NodeRoleCache:
    """In-memory cache cho AG node roles — thread-safe read, single-writer refresh."""

    def __init__(self) -> None:
        self._nodes: dict[str, NodeInfo] = {}
        self._last_refresh: datetime | None = None

    def initialize(self) -> None:
        """Gọi 1 lần khi startup. Raise nếu không có node nào reachable."""
        detected = self._detect_roles()
        if not detected:
            raise RuntimeError(
                f"Không thể detect AG node roles — tất cả nodes unreachable: {settings.mssql_nodes}"
            )
        self._nodes = detected
        self._last_refresh = now_vn()
        logger.info(
            "Node roles initialized: primary=%s secondaries=%s",
            self.get_primary_host(),
            self.get_secondary_hosts(),
        )

    def refresh(self) -> None:
        """Refresh roles. Không raise — giữ cache cũ nếu tất cả nodes unreachable."""
        old_primary = self.get_primary_host()
        detected = self._detect_roles()
        if not detected:
            logger.warning("Node role refresh failed — giữ cache cũ (primary=%s).", old_primary)
            return
        self._nodes = detected
        self._last_refresh = now_vn()
        new_primary = self.get_primary_host()
        if old_primary and new_primary and old_primary != new_primary:
            logger.warning("AG FAILOVER DETECTED: %s → %s", old_primary, new_primary)
        else:
            logger.debug("Node roles refreshed: primary=%s", new_primary)

    def is_valid_node(self, host: str) -> bool:
        """Kiểm tra host có trong cluster hay không — dùng để validate Claude tool input."""
        return host in self._nodes or host in settings.mssql_nodes

    def get_primary_host(self) -> str | None:
        for node in self._nodes.values():
            if node.is_primary:
                return node.host
        return None

    def get_secondary_hosts(self) -> list[str]:
        return [n.host for n in self._nodes.values() if not n.is_primary]

    def get_all_hosts(self) -> list[str]:
        return list(self._nodes.keys())

    def get_role(self, host: str) -> str:
        node = self._nodes.get(host)
        return node.role if node else "unknown"

    def is_stale(self, max_age_sec: int = 7200) -> bool:
        if self._last_refresh is None:
            return True
        return (now_vn() - self._last_refresh).total_seconds() > max_age_sec

    def _detect_roles(self) -> dict[str, NodeInfo]:
        now = now_vn()
        replica_to_ip: dict[str, str] = {}
        ag_rows: list | None = None

        for ip in settings.mssql_nodes:
            try:
                with mssql_connection(ip) as conn:
                    row = conn.execute("SELECT @@SERVERNAME AS name").fetchone()
                    if row:
                        replica_to_ip[row.name] = ip
                    if ag_rows is None:
                        try:
                            ag_rows = conn.execute(_ROLE_DETECT_SQL).fetchall()
                        except Exception:
                            pass
            except Exception as exc:
                logger.warning("Role detection skipped node=%s: %s", ip, exc)

        if not ag_rows:
            return {}

        nodes: dict[str, NodeInfo] = {}
        for row in ag_rows:
            connection_host = replica_to_ip.get(row.host, row.host)
            nodes[connection_host] = NodeInfo(
                host=connection_host, role=row.role, detected_at=now
            )
        return nodes
