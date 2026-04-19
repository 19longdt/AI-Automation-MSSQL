"""
base_notifier.py — Abstract base cho tất cả notification channels.

Alert được gửi sau khi detector tạo finding và dedup_repo xác nhận
chưa alert trong suppress window. Severity filter áp dụng ở đây.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from ..models.findings import Finding

logger = logging.getLogger(__name__)


class BaseNotifier(ABC):

    @abstractmethod
    def send(self, finding: Finding) -> bool:
        """Gửi alert, trả về True nếu thành công. Không raise exception."""
        ...

    @abstractmethod
    def send_health_issue(self, message: str) -> bool:
        """Gửi alert về infra health (stuck job, missed job, MongoDB down)."""
        ...

    def _format_finding(self, finding: Finding) -> str:
        """Format finding thành message text cho channel cụ thể."""
        ...

    def send_startup(self, _nodes: list[str], _topic_count: int) -> bool:
        """Gửi thông báo deploy mới khi service khởi động. Override nếu channel hỗ trợ."""
        return True


class NotificationDispatcher:
    """Dispatch finding tới tất cả configured channels."""

    def __init__(self, notifiers: list[BaseNotifier], min_severity: str) -> None:
        self._notifiers = notifiers
        self._min_severity = min_severity

    def dispatch(self, finding: Finding) -> None:
        """Gửi tới tất cả channels nếu severity >= min_severity."""
        from ..models.common import Severity
        if not finding.severity.is_at_least(Severity(self._min_severity)):
            logger.debug(
                "Severity filter: %s < %s — notification skipped (issue_type=%s node=%s)",
                finding.severity.value, self._min_severity,
                finding.issue_type.value, finding.node,
            )
            return
        for notifier in self._notifiers:
            try:
                ok = notifier.send(finding)
                if ok:
                    logger.info(
                        "Notification sent via %s: issue_type=%s node=%s",
                        type(notifier).__name__, finding.issue_type.value, finding.node,
                    )
                else:
                    logger.warning(
                        "Notification failed via %s: issue_type=%s node=%s",
                        type(notifier).__name__, finding.issue_type.value, finding.node,
                    )
            except Exception as exc:
                logger.error("Notifier %s failed: %s", type(notifier).__name__, exc)

    def dispatch_health(self, message: str) -> None:
        """Gửi health alert tới tất cả channels (không filter severity)."""
        for notifier in self._notifiers:
            try:
                notifier.send_health_issue(message)
            except Exception as exc:
                logger.error("Notifier %s health dispatch failed: %s", type(notifier).__name__, exc)

    def dispatch_startup(self, nodes: list[str], topic_count: int) -> None:
        """Gửi thông báo deploy mới tới tất cả channels khi service khởi động."""
        for notifier in self._notifiers:
            try:
                notifier.send_startup(nodes, topic_count)
            except Exception as exc:
                logger.error("Notifier %s startup dispatch failed: %s", type(notifier).__name__, exc)
