"""
blocking_detector.py — Phân tích blocking chain depth và deadlock events.

Nhận raw query results (blocking sessions, deadlock XML) từ topic queries.
Tính chain depth, identify head blocker, parse deadlock graph.
"""
from __future__ import annotations

import logging

from ..models.topic import MonitorTopic
from ..models.metrics import QueryResult
from ..models.findings import Finding

logger = logging.getLogger(__name__)


class BlockingChainDetector:

    def detect(self, results: list[QueryResult], topic: MonitorTopic) -> list[Finding]:
        """
        Phân tích blocking data từ query results:
          1. Build blocking chain graph từ session rows
          2. Tính chain depth, identify head blocker
          3. Parse deadlock XML nếu có
          4. So sánh với thresholds trong topic config
        """
        ...

    def _build_chain(self, rows: list[dict]) -> dict:
        """Build blocking chain graph: {blocked_session: blocking_session}."""
        ...

    def _calculate_chain_depth(self, chain: dict) -> int:
        """Tính max chain depth từ graph."""
        ...

    def _parse_deadlock_graph(self, deadlock_xml: str) -> dict:
        """Parse deadlock XML từ System Health XEvent."""
        ...
