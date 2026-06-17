"""
topic_runner.py — Orchestrate 1 topic run: load config → resolve nodes → query → detect → notify.

Đây là trung tâm của data flow. Mỗi APScheduler job gọi TopicRunner.run(topic_id).
Config reload mỗi run: đọc lại topic config từ MongoDB → pick up query/threshold changes
mà không cần restart service.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..capture.diagnostic_capture import DiagnosticCapture
from ..models.cluster import ClusterConfig
from ..models.common import AlertStatus, Severity
from ..models.topic import MonitorTopic
from ..models.metrics import QueryResult, RawMetric
from ..models.findings import Finding
from ..storage.repositories.topic_repo import TopicRepo
from ..storage.repositories.raw_metrics_repo import RawMetricsRepo
from ..storage.repositories.findings_repo import FindingsRepo
from ..storage.repositories.dedup_repo import DedupRepo
from ..notifications.base_notifier import NotificationDispatcher
from ..detectors.registry import DetectorRegistry
from ..utils.time_utils import now_vn
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
        cluster: ClusterConfig,
        topic_repo: TopicRepo,
        raw_metrics_repo: RawMetricsRepo,
        findings_repo: FindingsRepo,
        dedup_repo: DedupRepo,
        query_executor: QueryExecutor,
        node_role_cache: NodeRoleCache,
        detector_registry: DetectorRegistry,
        dispatcher: NotificationDispatcher | None,
        diagnostic_capture: DiagnosticCapture | None = None,
        dedup_suppress_minutes: int = 30,
    ) -> None:
        self._cluster = cluster
        self._topic_repo = topic_repo
        self._raw_metrics_repo = raw_metrics_repo
        self._findings_repo = findings_repo
        self._dedup_repo = dedup_repo
        self._executor = query_executor
        self._role_cache = node_role_cache
        self._detectors = detector_registry
        self._dispatcher = dispatcher
        self._diagnostic_capture = diagnostic_capture
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
        try:
            topic = self._topic_repo.find_by_id(topic_id)
            if topic is None:
                logger.warning("Topic not found: cluster=%s topic=%s", self._cluster.cluster_id, topic_id)
                return 0
            if not topic.enabled:
                logger.info("Topic disabled, skipping: cluster=%s topic=%s", self._cluster.cluster_id, topic_id)
                return 0

            resolved_nodes = self._role_cache.resolve(topic.nodes)
            if not resolved_nodes:
                logger.warning(
                    "No nodes resolved: cluster=%s topic=%s nodes_config=%s",
                    self._cluster.cluster_id, topic_id, topic.nodes,
                )
                return 0

            results = self._execute_on_nodes(topic, resolved_nodes)
            self._save_raw_metrics(results)

            findings = self._run_detector(topic, results)
            return self._process_findings(findings, topic)

        except Exception as exc:
            logger.error(
                "TopicRunner.run failed: topic=%s error=%s", topic_id, exc, exc_info=True
            )
            return 0

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
        all_results: list[QueryResult] = []
        with ThreadPoolExecutor(max_workers=len(resolved_nodes)) as pool:
            futures = {
                pool.submit(
                    self._executor.execute_batch,
                    topic.queries,
                    host,
                    topic.topic_id,
                    role,
                    self._cluster.cluster_id,
                    self._cluster.get_connection_string(host),
                    self._cluster.connect_timeout_sec,
                ): (host, role)
                for host, role in resolved_nodes
            }
            for future in as_completed(futures):
                host, role = futures[future]
                try:
                    node_results = future.result()
                    all_results.extend(node_results)
                except Exception as exc:
                    logger.error(
                        "Thread failed: topic=%s node=%s error=%s",
                        topic.topic_id, host, exc,
                    )
        return all_results

    def _save_raw_metrics(self, results: list[QueryResult]) -> int:
        """Convert QueryResult → RawMetric, batch insert vào MongoDB."""
        metrics = [
            RawMetric(
                topic_id=r.topic_id,
                cluster_id=r.cluster_id,
                query_id=r.query_id,
                node=r.node,
                role=r.role,
                collected_at=r.executed_at,
                rows=r.rows,
                row_count=r.row_count,
                duration_ms=r.duration_ms,
            )
            for r in results
            if r.success
        ]
        if metrics:
            return self._raw_metrics_repo.insert_batch(metrics)
        return 0

    def _run_detector(self, topic: MonitorTopic, results: list[QueryResult]) -> list[Finding]:
        """Gọi detector nếu topic.detector_type != None."""
        if not topic.detector_type:
            return []
        try:
            return self._detectors.detect(topic.detector_type, results, topic)
        except Exception as exc:
            logger.error(
                "Detector failed: topic=%s type=%s error=%s",
                topic.topic_id, topic.detector_type, exc, exc_info=True,
            )
            return []

    def _process_findings(self, findings: list[Finding], topic: MonitorTopic | None = None) -> int:
        """Compute alert state, optionally capture diagnostics, then persist findings."""
        count = 0
        for finding in findings:
            try:
                if not finding.cluster_id:
                    finding.cluster_id = self._cluster.cluster_id
                finding.finding_hash = finding.compute_finding_hash()
                status, error = self._compute_alert_state(finding)
                finding.alert_status = status
                finding.alert_error = error
                if status == AlertStatus.SENT:
                    finding.alert_sent_at = now_vn()
                    self._dedup_repo.mark_alerted(finding.finding_hash)

                # Capture diagnostics only for CRITICAL findings with capture tools enabled.
                if (
                    finding.severity == Severity.CRITICAL
                    and self._diagnostic_capture is not None
                    and topic is not None
                    and topic.capture_tools
                ):
                    try:
                        finding.has_diagnostics = self._diagnostic_capture.capture(finding, topic)
                    except Exception:
                        logger.error(
                            "DiagnosticCapture failed: finding=%s topic=%s",
                            finding.finding_id,
                            getattr(topic, "topic_id", "?"),
                            exc_info=True,
                        )

                self._findings_repo.insert(finding)
                count += 1
            except Exception as exc:
                logger.error(
                    "Process finding failed: issue_type=%s node=%s error=%s",
                    finding.issue_type, finding.node, exc, exc_info=True,
                )
        return count

    def _compute_alert_state(self, finding: Finding) -> tuple[AlertStatus, str | None]:
        """Quyết định alert state cho finding.

        Returns (alert_status, alert_error). alert_status ∈ AlertStatus:
          SKIPPED_NO_DISPATCHER | SUPPRESSED | SENT | FAILED | SKIPPED_SEVERITY.

        Thứ tự: no_dispatcher → dedup check → dispatch.
        Chỉ mark dedup sau khi dispatch thành công (status=sent), để đảm bảo
        luôn có ít nhất 1 alert thực sự được gửi trước khi suppress alert trùng.
        """
        if not self._dispatcher:
            logger.warning(
                "No dispatcher configured — notification skipped: topic=%s issue_type=%s node=%s",
                finding.topic_id, finding.issue_type.value, finding.node,
            )
            return (AlertStatus.SKIPPED_NO_DISPATCHER, "no dispatcher configured")

        if self._dedup_repo.was_alerted_recently(
            finding.finding_hash, self._dedup_suppress_min
        ):
            logger.debug(
                "Dedup suppressed: topic=%s issue_type=%s node=%s suppress_min=%d",
                finding.topic_id, finding.issue_type.value, finding.node, self._dedup_suppress_min,
            )
            return (AlertStatus.SUPPRESSED, f"within suppress window {self._dedup_suppress_min}min")

        logger.info(
            "Dispatching notification: issue_type=%s severity=%s node=%s",
            finding.issue_type.value, finding.severity.value, finding.node,
        )
        dispatch_status, dispatch_error = self._dispatcher.dispatch(finding)
        try:
            return (AlertStatus(dispatch_status), dispatch_error)
        except ValueError:
            logger.error("Unknown alert status from dispatcher: %s", dispatch_status)
            return (AlertStatus.FAILED, f"unknown dispatcher status: {dispatch_status}")
