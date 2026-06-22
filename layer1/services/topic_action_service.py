from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Callable

from ..models.findings import Finding
from ..models.topic_constants import TOPIC_BLOCKING, TOPIC_SLOW_SESSIONS
from .session_service import kill_session, kill_session_with_conn_str


class TopicActionHandler(ABC):
    """Template Method cho action theo topic."""

    def __init__(self, topic_id: str) -> None:
        self.topic_id = topic_id

    def supports(self, finding: Finding, command: str) -> bool:
        allowed = set(self.topic_commands()) | set(self.command_aliases().keys())
        return finding.topic_id == self.topic_id and command in allowed

    def topic_commands(self) -> list[str]:
        """Các command hiển thị thêm trên alert cho topic này."""
        return []

    def execute(self, finding: Finding, command: str, conn_str: str | None = None) -> dict:
        """Template method: validate -> resolve target -> execute action."""
        if finding.topic_id != self.topic_id:
            return {
                "ok": False,
                "status": 400,
                "code": "topic_not_allowed",
                "message": f"Command {command} is only allowed for topic {self.topic_id}",
            }

        allowed = set(self.topic_commands()) | set(self.command_aliases().keys())
        if command not in allowed:
            return {
                "ok": False,
                "status": 400,
                "code": "unsupported_command",
                "message": f"Unsupported command: {command}",
            }

        normalized = self.command_aliases().get(command, command)
        target = self.resolve_target(finding, normalized)
        if not target.get("ok"):
            return target
        return self.execute_target(finding, normalized, target["value"], conn_str=conn_str)

    def command_aliases(self) -> dict[str, str]:
        return {}

    @abstractmethod
    def resolve_target(self, finding: Finding, command: str) -> dict:
        ...

    @abstractmethod
    def execute_target(self, finding: Finding, command: str, target_value: int, conn_str: str | None = None) -> dict:
        ...


class SlowSessionsActionHandler(TopicActionHandler):
    def __init__(self) -> None:
        super().__init__(topic_id=TOPIC_SLOW_SESSIONS)

    def topic_commands(self) -> list[str]:
        return ["/kill-session", "/kill-blocking"]

    def command_aliases(self) -> dict[str, str]:
        return {"/kill_blocking": "/kill-blocking"}

    def resolve_target(self, finding: Finding, command: str) -> dict:
        metric_key = "blocking_session_id" if command == "/kill-blocking" else "session_id"
        session_id = _coerce_positive_int(finding.metrics.get(metric_key))
        if session_id is None:
            return {
                "ok": False,
                "status": 400,
                "code": "invalid_metric",
                "metric_key": metric_key,
                "message": f"Invalid or missing metrics.{metric_key}",
            }
        return {"ok": True, "value": session_id, "metric_key": metric_key}

    def execute_target(self, finding: Finding, command: str, target_value: int, conn_str: str | None = None) -> dict:
        # Slow session finding thuộc node nào thì kill đúng node đó, tránh kill nhầm SPID trên node khác.
        if conn_str:
            result = kill_session_with_conn_str(target_value, host=finding.node, conn_str=conn_str)
        else:
            result = kill_session(target_value, hosts=[finding.node])
        result["metric_key"] = "blocking_session_id" if command == "/kill-blocking" else "session_id"
        result["target_node"] = finding.node
        return result


class BlockingActionHandler(TopicActionHandler):
    """Kill HEAD BLOCKER — session gây ra blocking chain (khác slow_sessions kill victim).

    An toàn nhất khi metrics.head_blocker_is_idle=true + open_txn>0 (forgotten
    transaction — app đã treo, kill không mất gì); active blocker kill sẽ rollback.
    Alert đã hiển thị đủ context để DBA tự quyết định.
    """

    def __init__(self) -> None:
        super().__init__(topic_id=TOPIC_BLOCKING)

    def topic_commands(self) -> list[str]:
        return ["/kill-head-blocker"]

    def command_aliases(self) -> dict[str, str]:
        return {"/kill_head_blocker": "/kill-head-blocker"}

    def resolve_target(self, finding: Finding, command: str) -> dict:
        session_id = _coerce_positive_int(finding.metrics.get("head_blocker_session_id"))
        if session_id is None:
            return {
                "ok": False,
                "status": 400,
                "code": "invalid_metric",
                "metric_key": "head_blocker_session_id",
                "message": "Invalid or missing metrics.head_blocker_session_id",
            }
        return {"ok": True, "value": session_id, "metric_key": "head_blocker_session_id"}

    def execute_target(self, finding: Finding, command: str, target_value: int, conn_str: str | None = None) -> dict:
        # Kill đúng node phát hiện blocking — SPID chỉ có nghĩa trong phạm vi 1 instance
        if conn_str:
            result = kill_session_with_conn_str(target_value, host=finding.node, conn_str=conn_str)
        else:
            result = kill_session(target_value, hosts=[finding.node])
        result["metric_key"] = "head_blocker_session_id"
        result["target_node"] = finding.node
        return result


class TopicActionRegistry:
    def __init__(self) -> None:
        self._handlers: list[TopicActionHandler] = [
            SlowSessionsActionHandler(),
            BlockingActionHandler(),
        ]
        # Injected at startup by Layer1Service so actions use cluster-specific credentials.
        # Signature: (cluster_id: str, host: str) -> str | None
        self._conn_str_resolver: Callable[[str, str], str | None] | None = None

    def set_conn_str_resolver(self, resolver: Callable[[str, str], str | None]) -> None:
        self._conn_str_resolver = resolver

    def commands_for_topic(self, topic_id: str) -> list[str]:
        for handler in self._handlers:
            if handler.topic_id == topic_id:
                return handler.topic_commands()
        return []

    def execute(self, finding: Finding, command: str) -> dict:
        conn_str: str | None = None
        if self._conn_str_resolver and finding.cluster_id:
            conn_str = self._conn_str_resolver(finding.cluster_id, finding.node)
        for handler in self._handlers:
            if handler.supports(finding, command):
                return handler.execute(finding, command, conn_str=conn_str)
        return {
            "ok": False,
            "status": 400,
            "code": "unsupported_command",
            "message": f"No handler for topic={finding.topic_id} command={command}",
        }


topic_action_registry = TopicActionRegistry()


def _coerce_positive_int(value: object) -> int | None:
    try:
        if value is None:
            return None
        parsed = int(str(value).strip())
        return parsed if parsed > 0 else None
    except Exception:
        return None
