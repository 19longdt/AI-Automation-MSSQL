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

from ..config import maint_settings as settings
from .mongo_client import MongoConnection
from .time_utils import now_vn
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
    def is_primary(self) -> bool:
        return self.role == "primary"

    @property
    def is_secondary(self) -> bool:
        return self.role == "secondary"


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
        detected = self._detect_roles()
        if not detected:
            raise RuntimeError(
                f"Không thể detect AG node roles — tất cả nodes unreachable: {settings.mssql_nodes}"
            )
        self._nodes = detected
        self._last_refresh = now_vn()
        primary = self.get_primary_host()
        secondaries = self.get_secondary_hosts()
        logger.info(
            "Node roles initialized: primary=%s secondaries=%s",
            primary,
            secondaries,
        )
        self._persist_to_mongo()

    def refresh(self) -> None:
        """
        Refresh roles từ AG DMV. Gọi bởi APScheduler job mỗi refresh interval.
        Log WARNING nếu Primary thay đổi so với lần refresh trước (failover detected).
        Không raise — nếu tất cả nodes unreachable thì giữ cache cũ.
        """
        old_primary = self.get_primary_host()
        detected = self._detect_roles()
        if not detected:
            logger.warning(
                "Node role refresh failed — tất cả nodes unreachable. Giữ cache cũ (primary=%s).",
                old_primary,
            )
            return

        self._nodes = detected
        self._last_refresh = now_vn()
        new_primary = self.get_primary_host()

        if old_primary and new_primary and old_primary != new_primary:
            logger.warning(
                "AG FAILOVER DETECTED: primary thay đổi từ %s → %s",
                old_primary,
                new_primary,
            )
        else:
            logger.debug("Node roles refreshed: primary=%s", new_primary)

        self._persist_to_mongo()

    def resolve(self, node_targets: list[str]) -> list[tuple[str, str]]:
        """
        Resolve danh sách node targets từ topic config thành [(host, role)].

        Mapping:
          "primary"     → [(primary_host, "primary")]
          "secondary"   → [(sec1, "secondary"), (sec2, "secondary")]
          "all"         → [(node1, role1), (node2, role2), ...]
          "SQL-NODE-01" → [("SQL-NODE-01", resolved_role)]  # hostname cụ thể
        """
        result: list[tuple[str, str]] = []
        for target in node_targets:
            lower = target.lower()
            if lower == "primary":
                primary = self.get_primary_host()
                if primary:
                    result.append((primary, "primary"))
                else:
                    logger.warning("resolve('primary'): không có primary trong cache")
            elif lower == "secondary":
                result.extend((h, "secondary") for h in self.get_secondary_hosts())
            elif lower == "all":
                result.extend((n.host, n.role) for n in self._nodes.values())
            else:
                # Hostname cụ thể — lookup role từ cache, fallback "unknown"
                node_info = self._nodes.get(target)
                role = node_info.role if node_info else "unknown"
                result.append((target, role))
        return result

    def get_primary_host(self) -> str | None:
        """Trả về hostname của Primary hiện tại. None nếu cache chưa init."""
        for node in self._nodes.values():
            if node.is_primary:
                return node.host
        return None

    def get_secondary_hosts(self) -> list[str]:
        """Trả về list hostname của tất cả Secondaries."""
        return [n.host for n in self._nodes.values() if n.is_secondary]

    def get_all_nodes(self) -> list[NodeInfo]:
        """Trả về tất cả nodes trong cache."""
        return list(self._nodes.values())

    def is_stale(self, max_age_sec: int = 7200) -> bool:
        """Cache cũ hơn max_age_sec (default 2 giờ) coi là stale."""
        if self._last_refresh is None:
            return True
        elapsed = (now_vn() - self._last_refresh).total_seconds()
        return elapsed > max_age_sec

    def _detect_roles(self) -> dict[str, NodeInfo]:
        """
        Query AG DMV và trả về {ip: NodeInfo} — dùng IP thay vì hostname.

        AG DMV trả về replica_server_name là hostname của SQL Server (VD: EASYPOS-DB1),
        nhưng trong môi trường container hostname đó có thể không resolve được.
        Fix: kết nối từng node, dùng @@SERVERNAME để build mapping
        replica_hostname → IP, sau đó thay thế trước khi lưu vào cache.
        """
        now = now_vn()

        # Bước 1: Connect từng node — lấy @@SERVERNAME để map hostname → IP,
        # đồng thời lấy AG roles từ node đầu tiên trả được kết quả.
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
                            logger.debug("Role detection succeeded via node=%s", ip)
                        except Exception:
                            # Node có thể không phải AG member — tiếp tục thử node khác
                            pass
            except Exception as exc:
                logger.warning("Role detection failed on node=%s: %s", ip, exc)

        if not ag_rows:
            return {}

        # Bước 2: Build NodeInfo — thay replica hostname bằng IP nếu có trong mapping.
        # Fallback giữ nguyên hostname nếu node không reachable khi build mapping.
        nodes: dict[str, NodeInfo] = {}
        for row in ag_rows:
            connection_host = replica_to_ip.get(row.host, row.host)
            nodes[connection_host] = NodeInfo(
                host=connection_host, role=row.role, detected_at=now
            )
        return nodes

    def _persist_to_mongo(self) -> None:
        """Ghi node roles vào MongoDB `node_roles` collection (optional backup)."""
        try:
            db = MongoConnection.get_db()
            col = db["node_roles"]
            for node in self._nodes.values():
                col.update_one(
                    {"host": node.host},
                    {"$set": {"role": node.role, "detected_at": node.detected_at}},
                    upsert=True,
                )
        except Exception as exc:
            # Persist là optional — không crash nếu MongoDB down
            logger.debug("_persist_to_mongo skipped: %s", exc)
