"""Legacy single-cluster role cache.

Maintenance multi-cluster now reads `cluster.node_roles` from `db_monitor.db_clusters`.
This module remains only as a compatibility shim for older imports.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class NodeInfo:
    host: str
    role: str
    detected_at: datetime

    @property
    def is_primary(self) -> bool:
        return self.role == "primary"

    @property
    def is_secondary(self) -> bool:
        return self.role == "secondary"


class NodeRoleCache:
    def __init__(self) -> None:
        self._nodes: dict[str, NodeInfo] = {}

    def initialize(self) -> None:
        return

    def refresh(self) -> None:
        return

    def resolve(self, node_targets: list[str]) -> list[tuple[str, str]]:
        result: list[tuple[str, str]] = []
        for target in node_targets:
            role = self._nodes.get(target).role if target in self._nodes else "unknown"
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
        return False
