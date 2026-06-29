from __future__ import annotations

import logging
import signal
import threading
from datetime import datetime

from apscheduler.executors.pool import ThreadPoolExecutor as APSThreadPoolExecutor
from apscheduler.schedulers.blocking import BlockingScheduler

from .job_manager.apm import get_apm_ids, init_apm
from .capture.capture_tool_loader import CaptureToolLoader
from .capture.diagnostic_capture import DiagnosticCapture
from .config import settings
from .detectors.registry import DetectorRegistry
from .executor.node_role_cache import NodeRoleCache
from .executor.query_executor import QueryExecutor
from .executor.topic_runner import TopicRunner
from .job_manager.health_checker import HealthChecker
from .job_manager.job_runner import JobRunner
from .models.cluster import ClusterConfig, ClusterConnectionTestRequest, ClusterConnectionTestResponse
from .models.common import Severity
from .notifications.base_notifier import NotificationDispatcher
from .notifications.telegram_notifier import TelegramNotifier
from .notifications.teams_notifier import TeamsNotifier
from .storage.indexes import create_all_indexes
from .storage.mongo_client import MongoConnection
from .storage.repositories.cluster_repo import ClusterRepo
from .storage.repositories.dedup_repo import DedupRepo
from .storage.repositories.findings_repo import FindingsRepo
from .storage.repositories.job_execution_repo import JobExecutionRepo
from .storage.repositories.raw_metrics_repo import RawMetricsRepo
from .storage.repositories.topic_repo import TopicRepo

logger = logging.getLogger(__name__)


class Layer1Service:
    def __init__(self) -> None:
        # Default max_workers=10 is too low for multi-cluster deployments.
        # With N clusters × M topics jobs can fire simultaneously; I/O-bound SQL threads
        # are cheap so 50 workers avoids queueing without meaningful CPU overhead.
        executors = {"default": APSThreadPoolExecutor(max_workers=50)}
        self._scheduler = BlockingScheduler(timezone="UTC", executors=executors)
        self._lock = threading.RLock()

        self._topic_repo: TopicRepo | None = None
        self._cluster_repo: ClusterRepo | None = None
        self._job_runner: JobRunner | None = None
        self._health_checker: HealthChecker | None = None
        self._dispatcher: NotificationDispatcher | None = None

        self._role_caches: dict[str, NodeRoleCache] = {}
        self._topic_runners: dict[str, TopicRunner] = {}
        self._clusters: dict[str, ClusterConfig] = {}

    def start(self) -> None:
        self._setup_infrastructure()
        self._register_system_jobs()
        topic_job_count = self._sync_topic_jobs(run_immediately=True)
        logger.info("Layer 1 Monitoring Service started. topic_jobs=%d", topic_job_count)
        self._scheduler.start()

    def stop(self) -> None:
        logger.info("Shutting down Layer 1 Monitoring Service...")
        self._scheduler.shutdown(wait=False)
        MongoConnection.close()

    def list_clusters(self):
        assert self._cluster_repo is not None
        return self._cluster_repo.list_responses()

    def get_cluster(self, cluster_id: str):
        assert self._cluster_repo is not None
        return self._cluster_repo.get_response(cluster_id)

    def get_cluster_config(self, cluster_id: str) -> ClusterConfig | None:
        assert self._cluster_repo is not None
        return self._cluster_repo.find_by_id(cluster_id)

    def create_cluster(self, data):
        assert self._cluster_repo is not None
        response = self._cluster_repo.create(data)
        self.refresh_clusters()
        return response

    def update_cluster(self, cluster_id: str, data):
        assert self._cluster_repo is not None
        response = self._cluster_repo.update(cluster_id, data)
        if response is not None:
            self.refresh_clusters()
        return response

    def delete_cluster(self, cluster_id: str) -> bool:
        assert self._cluster_repo is not None
        deleted = self._cluster_repo.delete(cluster_id)
        if deleted:
            self.refresh_clusters()
        return deleted

    def test_cluster_connection(self, request: ClusterConnectionTestRequest) -> ClusterConnectionTestResponse:
        import time

        from .executor.mssql_connection import mssql_connection

        if not request.nodes:
            return ClusterConnectionTestResponse(ok=False, error="nodes must not be empty")

        host = request.nodes[0]
        logger.info(
            "Testing cluster connection: host=%s port=%s database=%s username=%s password_present=%s timeout_sec=%s",
            host,
            request.port,
            request.database,
            request.username,
            bool(request.password),
            settings.cluster_test_timeout_sec,
        )
        conn_str = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={host},{request.port};"
            f"DATABASE={request.database};"
            f"UID={request.username};"
            f"PWD={request.password};"
            f"TrustServerCertificate=yes;"
        )

        started = time.monotonic()
        try:
            with mssql_connection(host, conn_str=conn_str, timeout_sec=settings.cluster_test_timeout_sec) as conn:
                conn.execute("SELECT 1")
            result = ClusterConnectionTestResponse(
                ok=True,
                latency_ms=(time.monotonic() - started) * 1000.0,
            )
            logger.info(
                "Cluster connection test completed: host=%s ok=%s latency_ms=%.2f",
                host,
                result.ok,
                result.latency_ms or 0.0,
            )
            return result
        except Exception as exc:
            logger.info(
                "Cluster connection test failed: host=%s error=%s",
                host,
                exc,
            )
            return ClusterConnectionTestResponse(ok=False, error=str(exc))

    def refresh_clusters(self) -> None:
        # Build new cluster runtime outside the lock (network calls during initialize()),
        # then swap atomically under lock so topic jobs on healthy clusters are not blocked.
        next_clusters, next_role_caches, next_topic_runners = self._build_cluster_runtime(seed_if_empty=False)
        with self._lock:
            # If a cluster that was running fails re-initialization (e.g. transient AG blip,
            # all nodes briefly unreachable during this refresh cycle), keep the existing runner
            # and cache rather than dropping it. Dropping removes the cluster's APScheduler jobs
            # entirely, causing a monitoring blackout until the next successful refresh cycle.
            for cluster_id in list(self._clusters):
                if cluster_id not in next_clusters and cluster_id in self._topic_runners:
                    logger.warning(
                        "Cluster re-init failed during refresh — keeping existing runner: cluster=%s",
                        cluster_id,
                    )
                    next_clusters[cluster_id] = self._clusters[cluster_id]
                    next_role_caches[cluster_id] = self._role_caches[cluster_id]
                    next_topic_runners[cluster_id] = self._topic_runners[cluster_id]
            self._clusters = next_clusters
            self._role_caches = next_role_caches
            self._topic_runners = next_topic_runners
            self._sync_topic_jobs(run_immediately=False)

    def refresh_node_roles(self, cluster_id: str) -> bool:
        """Force immediate role re-detection for one cluster. Returns False if cluster not found."""
        with self._lock:
            cache = self._role_caches.get(cluster_id)
        if cache is None:
            return False
        cache.refresh()
        return True

    def get_node_role_cache(self, cluster_id: str) -> NodeRoleCache | None:
        with self._lock:
            return self._role_caches.get(cluster_id)

    def _setup_infrastructure(self) -> None:
        logger.info("Connecting to MongoDB: %s", settings.mongodb_uri)
        MongoConnection.initialize(settings)
        create_all_indexes(MongoConnection.get_db())
        CaptureToolLoader.load_all()

        self._cluster_repo = ClusterRepo()
        self._topic_repo = TopicRepo()
        raw_metrics_repo = RawMetricsRepo()
        findings_repo = FindingsRepo()
        dedup_repo = DedupRepo()
        execution_repo = JobExecutionRepo()

        query_executor = QueryExecutor()
        detector_registry = DetectorRegistry.build_default()
        diagnostic_capture = DiagnosticCapture()

        notifiers = []
        if settings.teams_webhook_url:
            notifiers.append(TeamsNotifier(settings.teams_webhook_url))
        if settings.telegram_bot_token and settings.telegram_chat_id:
            notifiers.append(TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id))
        self._dispatcher = (
            NotificationDispatcher(notifiers, min_severity=Severity.WARNING.value) if notifiers else None
        )

        if settings.telegram_bot_token and settings.telegram_chat_id:
            from .notifications.telegram_bot import TelegramBot

            analyzer = None
            if settings.claude_api_key:
                from .ai.plan_analyzer import PlanAnalyzer

                analyzer = PlanAnalyzer(settings.claude_api_key, settings.haiku_model)

            TelegramBot(
                bot_token=settings.telegram_bot_token,
                chat_id=settings.telegram_chat_id,
                findings_repo=findings_repo,
                topic_repo=self._topic_repo,
                analyzer=analyzer,
                action_bot_token=settings.action_bot_token,
            ).start()

        self._job_runner = JobRunner(execution_repo)
        self._health_checker = HealthChecker(execution_repo, job_intervals={})

        # Inject cluster-specific conn_str resolver so Telegram kill actions
        # use correct credentials for each cluster instead of global env settings.
        from .services.topic_action_service import topic_action_registry
        cluster_repo_ref = self._cluster_repo
        topic_action_registry.set_conn_str_resolver(
            lambda cluster_id, host: (
                c.get_connection_string(host)
                if (c := cluster_repo_ref.find_by_id(cluster_id)) is not None
                else None
            )
        )

        self._shared_dependencies = {
            "raw_metrics_repo": raw_metrics_repo,
            "findings_repo": findings_repo,
            "dedup_repo": dedup_repo,
            "query_executor": query_executor,
            "detector_registry": detector_registry,
            "diagnostic_capture": diagnostic_capture,
        }
        next_clusters, next_role_caches, next_topic_runners = self._build_cluster_runtime(seed_if_empty=True)
        self._clusters = next_clusters
        self._role_caches = next_role_caches
        self._topic_runners = next_topic_runners
        logger.info("Active clusters loaded: %s", sorted(self._clusters.keys()))

    def _build_cluster_runtime(
        self, seed_if_empty: bool
    ) -> tuple[dict[str, ClusterConfig], dict[str, NodeRoleCache], dict[str, "TopicRunner"]]:
        """Build new cluster runtime objects WITHOUT holding self._lock.

        Network calls (NodeRoleCache.initialize → SQL Server) must happen outside the
        lock so that a slow/broken cluster does not block topic jobs on healthy clusters.
        """
        assert self._cluster_repo is not None
        assert self._topic_repo is not None

        if seed_if_empty:
            self._cluster_repo.seed_from_env(settings)

        enabled_clusters = self._cluster_repo.find_all_enabled()
        if not enabled_clusters:
            logger.warning("No enabled clusters configured. Layer 1 started idle.")
            return {}, {}, {}

        next_clusters: dict[str, ClusterConfig] = {}
        next_role_caches: dict[str, NodeRoleCache] = {}
        next_topic_runners: dict[str, TopicRunner] = {}

        for cluster in enabled_clusters:
            try:
                role_cache = NodeRoleCache(cluster)
                role_cache.initialize()
                runner = TopicRunner(
                    cluster=cluster,
                    topic_repo=self._topic_repo,
                    raw_metrics_repo=self._shared_dependencies["raw_metrics_repo"],
                    findings_repo=self._shared_dependencies["findings_repo"],
                    dedup_repo=self._shared_dependencies["dedup_repo"],
                    query_executor=self._shared_dependencies["query_executor"],
                    node_role_cache=role_cache,
                    detector_registry=self._shared_dependencies["detector_registry"],
                    dispatcher=self._dispatcher,
                    diagnostic_capture=self._shared_dependencies["diagnostic_capture"],
                    dedup_suppress_minutes=settings.dedup_suppress_minutes,
                )
                next_clusters[cluster.cluster_id] = cluster
                next_role_caches[cluster.cluster_id] = role_cache
                next_topic_runners[cluster.cluster_id] = runner
            except Exception as exc:
                logger.error("Cluster initialization failed: cluster=%s error=%s", cluster.cluster_id, exc, exc_info=True)

        logger.info("Active clusters built: %s", sorted(next_clusters.keys()))
        return next_clusters, next_role_caches, next_topic_runners

    def _register_system_jobs(self) -> None:
        self._scheduler.add_job(
            self._refresh_all_node_roles,
            trigger="interval",
            seconds=settings.node_role_refresh_sec,
            id="node_role_refresh_all",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.add_job(
            self.refresh_clusters,
            trigger="interval",
            seconds=settings.cluster_refresh_sec,
            id="cluster_refresh",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.add_job(
            self._run_health_check,
            trigger="interval",
            seconds=120,
            id="health_check",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

    def _sync_topic_jobs(self, run_immediately: bool) -> int:
        assert self._topic_repo is not None
        assert self._job_runner is not None
        assert self._health_checker is not None

        topics = self._topic_repo.find_all_enabled()
        desired_job_ids: set[str] = set()
        job_intervals: dict[str, int] = {}

        for cluster_id in self._clusters:
            for topic in topics:
                job_id = self._topic_job_id(cluster_id, topic.topic_id)
                desired_job_ids.add(job_id)
                job_intervals[job_id] = topic.schedule_sec

                # Do NOT replace an already-scheduled job unless explicitly firing immediately.
                # replace_existing=True resets APScheduler's per-job instance counter,
                # which defeats max_instances=1: the stuck old instance is no longer tracked
                # by the new job entry, so a new instance fires and also gets stuck.
                # This is what caused multiple stuck UAT instances on every cluster refresh.
                if not run_immediately and self._scheduler.get_job(job_id) is not None:
                    continue

                self._scheduler.add_job(
                    self._make_topic_job(cluster_id, topic.topic_id),
                    trigger="interval",
                    seconds=topic.schedule_sec,
                    id=job_id,
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                    next_run_time=datetime.utcnow() if run_immediately else None,
                )

        for job in list(self._scheduler.get_jobs()):
            if job.id.startswith("topic_") and job.id not in desired_job_ids:
                self._scheduler.remove_job(job.id)

        self._health_checker._job_intervals = job_intervals
        return len(desired_job_ids)

    def _make_topic_job(self, cluster_id: str, topic_id: str):
        assert self._job_runner is not None

        job_name = self._topic_job_id(cluster_id, topic_id)

        @self._job_runner.wrap(job_name)
        def job() -> int:
            with self._lock:
                runner = self._topic_runners.get(cluster_id)
            if runner is None:
                logger.warning("Skipping topic job because cluster runner is missing: cluster=%s topic=%s", cluster_id, topic_id)
                return 0
            return runner.run(topic_id)

        return job

    def _refresh_all_node_roles(self) -> None:
        # Snapshot dict under lock, then refresh each cluster outside the lock.
        # Holding the lock during SQL Server network calls would block all topic jobs
        # on healthy clusters while a broken cluster is timing out.
        with self._lock:
            caches = list(self._role_caches.items())
        for cluster_id, cache in caches:
            try:
                cache.refresh()
            except Exception as exc:
                logger.warning("Node role refresh failed: cluster=%s error=%s", cluster_id, exc)

    def _run_health_check(self) -> None:
        assert self._health_checker is not None
        issues = self._health_checker.run_check()
        for issue in issues:
            logger.warning("Health: %s", issue)

    @staticmethod
    def _topic_job_id(cluster_id: str, topic_id: str) -> str:
        return f"topic_{cluster_id}_{topic_id}"


class _ApmTraceFilter(logging.Filter):
    """Inject Elastic APM trace/transaction/span IDs into every LogRecord."""

    def filter(self, record: logging.LogRecord) -> bool:
        apm_trace, apm_txn, apm_span = get_apm_ids()
        record.apm_trace_id = apm_trace          # type: ignore[attr-defined]
        record.apm_transaction_id = apm_txn      # type: ignore[attr-defined]
        record.apm_span_id = apm_span            # type: ignore[attr-defined]
        return True


def _setup_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s - %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)
    logging.getLogger("apscheduler.schedulers.base").setLevel(logging.WARNING)

    if not settings.logstash_host:
        return

    try:
        from logstash_async.formatter import LogstashFormatter
        from logstash_async.handler import AsynchronousLogstashHandler
    except ImportError:
        logging.getLogger().error(
            "LOGSTASH_HOST configured but python-logstash-async not installed; skipping."
        )
        return

    import socket as _socket

    transport_map = {
        "udp": "logstash_async.transport.UdpTransport",
        "tcp": "logstash_async.transport.TcpTransport",
    }
    handler = AsynchronousLogstashHandler(
        host=settings.logstash_host,
        port=settings.logstash_port,
        database_path=settings.logstash_database_path or None,
        transport=transport_map.get(settings.logstash_transport, transport_map["udp"]),
    )
    handler.setFormatter(
        LogstashFormatter(
            extra_prefix=None,
            extra={
                "app_name": settings.logstash_app_name,
                "service": "layer1-monitor",
                "hostname": _socket.gethostname(),
            },
        )
    )
    handler.addFilter(_ApmTraceFilter())
    logging.getLogger().addHandler(handler)


def _setup_signal_handlers(service: Layer1Service) -> None:
    def _shutdown(signum, _frame):
        logger.info("Signal %s received, initiating graceful shutdown...", signum)
        service.stop()
        logging.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)


def main() -> None:
    _setup_logging()
    init_apm(settings)
    logger.info("Layer 1 Monitoring Service starting...")
    service = Layer1Service()
    _setup_signal_handlers(service)
    service.start()


if __name__ == "__main__":
    main()
