from __future__ import annotations

import logging
from datetime import datetime

from ..models.cluster import ClusterConfig, ClusterNodeRole
from ..utils.time_utils import now_vn
from .mssql_connection import mssql_connection

logger = logging.getLogger(__name__)

_ROLE_DETECT_SQL = """
SELECT ar.replica_server_name AS host,
       ars.role_desc AS role
FROM sys.dm_hadr_availability_replica_states ars
JOIN sys.availability_replicas ar
  ON ars.replica_id = ar.replica_id
"""


class NodeInfo:
    def __init__(self, host: str, role: str, detected_at: datetime, server_name: str = "") -> None:
        self.host = host
        self.role = role.lower()
        self.detected_at = detected_at
        self.server_name = server_name

    @property
    def is_primary(self) -> bool:
        return self.role == "primary"

    @property
    def is_secondary(self) -> bool:
        return self.role == "secondary"


class NodeRoleCache:
    def __init__(self, cluster: ClusterConfig) -> None:
        self._cluster = cluster
        self._nodes: dict[str, NodeInfo] = {}
        self._last_refresh: datetime | None = None

    @property
    def cluster_id(self) -> str:
        return self._cluster.cluster_id

    def initialize(self) -> None:
        detected = self._detect_roles()
        if not detected:
            raise RuntimeError(
                f"Could not detect AG node roles for cluster '{self._cluster.cluster_id}': {self._cluster.nodes}"
            )
        self._nodes = detected
        self._last_refresh = now_vn()
        self._persist_to_mongo()
        logger.info(
            "Node roles initialized: cluster=%s primary=%s secondaries=%s",
            self._cluster.cluster_id,
            self.get_primary_host(),
            self.get_secondary_hosts(),
        )

    def refresh(self) -> None:
        old_primary = self.get_primary_host()
        detected = self._detect_roles()
        if not detected:
            logger.warning(
                "Node role refresh failed for cluster=%s; keeping previous cache primary=%s",
                self._cluster.cluster_id,
                old_primary,
            )
            return
        self._nodes = detected
        self._last_refresh = now_vn()
        self._persist_to_mongo()
        new_primary = self.get_primary_host()
        if old_primary and new_primary and old_primary != new_primary:
            logger.warning(
                "AG failover detected: cluster=%s old_primary=%s new_primary=%s",
                self._cluster.cluster_id,
                old_primary,
                new_primary,
            )

    def resolve(self, node_targets: list[str]) -> list[tuple[str, str]]:
        result: list[tuple[str, str]] = []
        for target in node_targets:
            lower = target.lower()
            if lower == "primary":
                primary = self.get_primary_host()
                if primary:
                    result.append((primary, "primary"))
            elif lower == "secondary":
                result.extend((host, "secondary") for host in self.get_secondary_hosts())
            elif lower == "all":
                result.extend((node.host, node.role) for node in self._nodes.values())
            else:
                node_info = self._nodes.get(target)
                role = node_info.role if node_info else "unknown"
                result.append((target, role))
        return result

    def get_primary_host(self) -> str | None:
        for node in self._nodes.values():
            if node.is_primary:
                return node.host
        return None

    def get_secondary_hosts(self) -> list[str]:
        return [node.host for node in self._nodes.values() if node.is_secondary]

    def get_all_nodes(self) -> list[NodeInfo]:
        return list(self._nodes.values())

    def is_stale(self, max_age_sec: int = 7200) -> bool:
        if self._last_refresh is None:
            return True
        return (now_vn() - self._last_refresh).total_seconds() > max_age_sec

    def _detect_roles(self) -> dict[str, NodeInfo]:
        now = now_vn()
        replica_to_ip: dict[str, str] = {}
        ag_rows: list | None = None

        for ip in self._cluster.nodes:
            try:
                with mssql_connection(
                    ip,
                    conn_str=self._cluster.get_connection_string(ip),
                    timeout_sec=self._cluster.connect_timeout_sec,
                ) as conn:
                    row = conn.execute("SELECT @@SERVERNAME AS name").fetchone()
                    if row:
                        replica_to_ip[row.name] = ip
                    if ag_rows is None:
                        try:
                            ag_rows = conn.execute(_ROLE_DETECT_SQL).fetchall()
                        except Exception:
                            pass
            except Exception as exc:
                logger.warning(
                    "Role detection failed: cluster=%s node=%s error=%s",
                    self._cluster.cluster_id,
                    ip,
                    exc,
                )

        if not ag_rows:
            return {}

        # Build reverse map: IP → server_name for storing in node_roles
        ip_to_server_name = {ip: name for name, ip in replica_to_ip.items()}

        nodes: dict[str, NodeInfo] = {}
        for row in ag_rows:
            connection_host = replica_to_ip.get(row.host)
            if connection_host is None:
                # Replica listed in AG DMV but its IP was not reachable during detection.
                # Using the server name as a connection host would cause login timeouts on
                # every query run — skip it instead and let the next refresh retry.
                logger.warning(
                    "AG replica not reachable or not in cluster node list: "
                    "cluster=%s replica_server_name=%s — skipping until next role refresh",
                    self._cluster.cluster_id,
                    row.host,
                )
                continue
            nodes[connection_host] = NodeInfo(
                host=connection_host,
                role=row.role,
                detected_at=now,
                server_name=ip_to_server_name.get(connection_host, ""),
            )
        return nodes

    def _persist_to_mongo(self) -> None:
        """Ghi role info vào db_clusters.node_roles (embedded).

        Thay thế collection node_roles riêng biệt — tất cả layers đọc db_clusters
        là đủ, không cần join thêm.
        """
        try:
            from ..storage.mongo_client import MongoConnection

            now = now_vn()
            role_docs = [
                ClusterNodeRole(
                    host=node.host,
                    server_name=node.server_name,
                    role=node.role,
                    last_seen_at=node.detected_at,
                ).model_dump()
                for node in self._nodes.values()
            ]

            db = MongoConnection.get_db()
            db["db_clusters"].update_one(
                {"cluster_id": self._cluster.cluster_id},
                {
                    "$set": {
                        "node_roles": role_docs,
                        "roles_detected_at": now,
                    }
                },
            )
        except Exception as exc:
            logger.debug("Skip node role persist: cluster=%s error=%s", self._cluster.cluster_id, exc)
