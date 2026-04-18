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


class NotificationDispatcher:
    """Dispatch finding tới tất cả configured channels."""

    def __init__(self, notifiers: list[BaseNotifier], min_severity: str) -> None:
        self._notifiers = notifiers
        self._min_severity = min_severity

    def dispatch(self, finding: Finding) -> None:
        """Gửi tới tất cả channels nếu severity >= min_severity."""
        ...

    def dispatch_health(self, message: str) -> None:
        """Gửi health alert tới tất cả channels (không filter severity)."""
        ...
