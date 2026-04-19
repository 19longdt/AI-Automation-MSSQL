"""
topic_runner.py — Orchestrate 1 topic run: load config → resolve nodes → query → detect → notify.

Đây là trung tâm của data flow. Mỗi APScheduler job gọi TopicRunner.run(topic_id).
Config reload mỗi run: đọc lại topic config từ MongoDB → pick up query/threshold changes
mà không cần restart service.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..models.topic import MonitorTopic
from ..models.metrics import QueryResult, RawMetric
from ..models.findings import Finding
from ..storage.repositories.topic_repo import TopicRepo
from ..storage.repositories.raw_metrics_repo import RawMetricsRepo
from ..storage.repositories.findings_repo import FindingsRepo
from ..storage.repositories.dedup_repo import DedupRepo
from ..notifications.base_notifier import NotificationDispatcher
from ..detectors.registry import DetectorRegistry
from .query_executor import QueryExecutor
from .node_role_cache import NodeRoleCache

logger = logging.getLogger(__name__)


class TopicRunner:
    """
    Chạy 1 topic: load config → resolve nodes → execute queries → detect → notify.
    1 instance TopicRunner dùng chung cho tất cả topics.
    """

    def __init__(
        self,
        topic_repo: TopicRepo,
        raw_metrics_repo: RawMetricsRepo,
        findings_repo: FindingsRepo,
        dedup_repo: DedupRepo,
        query_executor: QueryExecutor,
        node_role_cache: NodeRoleCache,
        detector_registry: DetectorRegistry,
        dispatcher: NotificationDispatcher | None,
        dedup_suppress_minutes: int = 30,
    ) -> None:
        self._topic_repo = topic_repo
        self._raw_metrics_repo = raw_metrics_repo
        self._findings_repo = findings_repo
        self._dedup_repo = dedup_repo
        self._executor = query_executor
        self._role_cache = node_role_cache
        self._detectors = detector_registry
        self._dispatcher = dispatcher
        self._dedup_suppress_min = dedup_suppress_minutes

    def run(self, topic_id: str) -> int:
        """
        Chạy 1 topic, trả về số findings tạo được.

        Flow:
          1. Load topic config từ MongoDB (reload mỗi run)
          2. Check enabled — skip nếu disabled
          3. Resolve nodes từ role cache
          4. Execute queries parallel per node
          5. Save raw_metrics
          6. Run detector (nếu configured)
          7. Save findings + dedup + notify

        Không raise exception — mọi lỗi log ERROR và return 0.
        """
        ...

    def _execute_on_nodes(
        self,
        topic: MonitorTopic,
        resolved_nodes: list[tuple[str, str]],
    ) -> list[QueryResult]:
        """
        Execute topic.queries trên tất cả resolved_nodes song song.
        ThreadPoolExecutor với max_workers = len(resolved_nodes).
        Mỗi node trong thread riêng với connection riêng.
        """
        ...

    def _save_raw_metrics(self, results: list[QueryResult]) -> int:
        """Convert QueryResult → RawMetric, batch insert vào MongoDB."""
        ...

    def _run_detector(self, topic: MonitorTopic, results: list[QueryResult]) -> list[Finding]:
        """Gọi detector nếu topic.detector_type != None."""
        ...

    def _process_findings(self, findings: list[Finding]) -> int:
        """Save findings, check dedup, dispatch notifications. Return count."""
        ...
