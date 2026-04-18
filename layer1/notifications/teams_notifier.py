"""teams_notifier.py — Microsoft Teams notification qua Incoming Webhook."""
from __future__ import annotations

import logging

import pymsteams

from .base_notifier import BaseNotifier
from ..models.findings import Finding

logger = logging.getLogger(__name__)


class TeamsNotifier(BaseNotifier):

    def __init__(self, webhook_url: str) -> None:
        self._webhook_url = webhook_url

    def send(self, finding: Finding) -> bool:
        """
        Gửi adaptive card với severity color coding:
          CRITICAL → đỏ, WARNING → vàng, INFO → xanh.
        Kèm node, issue_type, metrics summary, và link tới MongoDB finding.
        """
        ...

    def send_health_issue(self, message: str) -> bool: ...

    def _build_card(self, finding: Finding) -> pymsteams.connectorcard: ...
