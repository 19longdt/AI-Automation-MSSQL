"""
scheduler.py — Entry point của Layer 1 Monitoring Service.

Config-driven architecture: SQL queries và thresholds cấu hình trong MongoDB.
Python app chỉ là generic executor — schedule, query, detect, notify.

Startup:
  1. Load env vars (MSSQL nodes, MongoDB URI)
  2. Kết nối MongoDB, tạo indexes
  3. Detect node roles (Primary/Secondary) → cache
  4. Đọc monitor_topics enabled → đăng ký APScheduler jobs
  5. Start scheduler (blocking)

Chạy: python -m layer1.scheduler
"""
from __future__ import annotations

import logging
import signal
from datetime import datetime

from apscheduler.schedulers.blocking import BlockingScheduler

from .config import settings
from .capture.capture_tool_loader import CaptureToolLoader
from .capture.diagnostic_capture import DiagnosticCapture
from .executor.node_role_cache import NodeRoleCache
from .executor.query_executor import QueryExecutor
from .executor.topic_runner import TopicRunner
from .models.common import Severity
from .detectors.registry import DetectorRegistry
from .job_manager.job_runner import JobRunner
from .job_manager.health_checker import HealthChecker
from .storage.mongo_client import MongoConnection
from .storage.indexes import create_all_indexes
from .storage.repositories.topic_repo import TopicRepo
from .storage.repositories.raw_metrics_repo import RawMetricsRepo
from .storage.repositories.findings_repo import FindingsRepo
from .storage.repositories.dedup_repo import DedupRepo
from .storage.repositories.job_execution_repo import JobExecutionRepo
from .notifications.base_notifier import NotificationDispatcher
from .notifications.teams_notifier import TeamsNotifier
from .notifications.telegram_notifier import TelegramNotifier

logger = logging.getLogger(__name__)


class Layer1Service:
    """
    Orchestrator chính.
    Đọc topics từ MongoDB → đăng ký 1 APScheduler job per topic → start.
    """

    def __init__(self) -> None:
        self._scheduler = BlockingScheduler(timezone="UTC")

        # Infrastructure — khởi tạo trong _setup_infrastructure()
        self._role_cache: NodeRoleCache | None = None
        self._topic_runner: TopicRunner | None = None
        self._job_runner: JobRunner | None = None
        self._topic_repo: TopicRepo | None = None
        self._health_checker: HealthChecker | None = None
        self._dispatcher: NotificationDispatcher | None = None

    def start(self) -> None:
        """Setup toàn bộ dependencies, register jobs, start scheduler."""
        self._setup_infrastructure()
        topic_count = self._register_jobs()
        # if self._dispatcher:
        #     self._dispatcher.dispatch_startup(
        #         nodes=settings.mssql_nodes,
        #         topic_count=topic_count,
        #     )
        logger.info("Layer 1 Monitoring Service started — scheduler running.")
        self._scheduler.start()  # blocking

    def stop(self) -> None:
        """Graceful shutdown — gọi khi nhận SIGTERM/SIGINT."""
        logger.info("Shutting down Layer 1 Monitoring Service...")
        self._scheduler.shutdown(wait=False)
        MongoConnection.close()

    def _setup_infrastructure(self) -> None:
        """
        Khởi tạo theo thứ tự:
          1. MongoDB connection + indexes
          2. Node role cache (detect AG roles)
          3. Repositories
          4. Executor + detector registry
          5. TopicRunner (inject tất cả dependencies)
          6. JobRunner (execution tracking)
          7. Notifications
        """
        # 1. MongoDB
        logger.info("Connecting to MongoDB: %s", settings.mongodb_uri)
        MongoConnection.initialize(settings)
        create_all_indexes(MongoConnection.get_db())
        # Load capture tool definitions early and fail fast if seed data is missing.
        CaptureToolLoader.load_all()

        # 2. Node role cache
        logger.info("Detecting AG node roles from: %s", settings.mssql_nodes)
        self._role_cache = NodeRoleCache()
        self._role_cache.initialize()

        # 3. Repositories
        self._topic_repo = TopicRepo()
        raw_metrics_repo = RawMetricsRepo()
        findings_repo = FindingsRepo()
        dedup_repo = DedupRepo()
        execution_repo = JobExecutionRepo()

        # 4. Executor + detector registry
        query_executor = QueryExecutor()
        detector_registry = DetectorRegistry.build_default()
        diagnostic_capture = DiagnosticCapture()

        # 5. Notifications — chỉ kích hoạt kênh nào có config
        notifiers = []
        if settings.teams_webhook_url:
            notifiers.append(TeamsNotifier(settings.teams_webhook_url))
            logger.info("Teams notification enabled.")
        if settings.telegram_bot_token and settings.telegram_chat_id:
            notifiers.append(TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id))
            logger.info("Telegram notification enabled.")
        self._dispatcher = (
            NotificationDispatcher(notifiers, min_severity=Severity.WARNING.value)
            if notifiers
            else None
        )
        dispatcher = self._dispatcher

        # 6. Telegram Bot command handler (optional — cần telegram_bot_token + telegram_chat_id)
        # /quick cần claude_api_key, /analyze cần layer2_url
        if settings.telegram_bot_token and settings.telegram_chat_id:
            from .notifications.telegram_bot import TelegramBot
            analyzer = None
            if settings.claude_api_key:
                from .ai.plan_analyzer import PlanAnalyzer
                # Haiku cho /quick — nhanh, rẻ, không cần tools
                analyzer = PlanAnalyzer(settings.claude_api_key, settings.haiku_model)
            TelegramBot(
                bot_token=settings.telegram_bot_token,
                chat_id=settings.telegram_chat_id,
                findings_repo=findings_repo,
                topic_repo=self._topic_repo,
                analyzer=analyzer,
                action_bot_token=settings.action_bot_token,
            ).start()

        # 7. TopicRunner
        self._topic_runner = TopicRunner(
            topic_repo=self._topic_repo,
            raw_metrics_repo=raw_metrics_repo,
            findings_repo=findings_repo,
            dedup_repo=dedup_repo,
            query_executor=query_executor,
            node_role_cache=self._role_cache,
            detector_registry=detector_registry,
            dispatcher=dispatcher,
            diagnostic_capture=diagnostic_capture,
            dedup_suppress_minutes=settings.dedup_suppress_minutes,
        )

        # 7. JobRunner + HealthChecker (intervals populated in _register_jobs)
        self._job_runner = JobRunner(execution_repo)
        self._health_checker = HealthChecker(execution_repo, job_intervals={})

    def _register_jobs(self) -> int:
        """
        Đọc tất cả topics enabled từ MongoDB.
        Với mỗi topic → đăng ký 1 APScheduler interval job.

        Thêm 2 system jobs:
          - node_role_refresh: mỗi node_role_refresh_sec
          - health_check: mỗi 2 phút
        """
        assert self._topic_repo is not None
        assert self._job_runner is not None
        assert self._role_cache is not None
        assert self._health_checker is not None

        job_intervals: dict[str, int] = {}

        topics = self._topic_repo.find_all_enabled()
        for topic in topics:
            job_fn = self._make_topic_job(topic.topic_id)
            self._scheduler.add_job(
                job_fn,
                trigger="interval",
                seconds=topic.schedule_sec,
                id=f"topic_{topic.topic_id}",
                max_instances=1,
                coalesce=True,
                next_run_time=datetime.utcnow(),  # chạy ngay lần đầu
            )
            job_intervals[topic.topic_id] = topic.schedule_sec
            logger.info(
                "Registered topic job: id=%s interval=%ds",
                topic.topic_id,
                topic.schedule_sec,
            )

        # System job: refresh AG node roles
        self._scheduler.add_job(
            self._role_cache.refresh,
            trigger="interval",
            seconds=settings.node_role_refresh_sec,
            id="node_role_refresh",
            max_instances=1,
            coalesce=True,
        )
        # node_role_refresh KHÔNG thêm vào job_intervals —
        # system jobs không wrap bởi JobRunner nên không có record trong job_executions,
        # nếu thêm vào sẽ luôn bị coi là MISSED bởi health checker.

        # System job: health check mỗi 2 phút
        self._scheduler.add_job(
            self._run_health_check,
            trigger="interval",
            seconds=120,
            id="health_check",
            max_instances=1,
            coalesce=True,
        )
        # health_check cũng không thêm vào job_intervals — cùng lý do trên.

        # Cập nhật intervals cho health checker sau khi đã register xong
        self._health_checker._job_intervals = job_intervals

        logger.info(
            "Registered %d topic jobs + 2 system jobs (node_role_refresh, health_check).",
            len(topics),
        )
        return len(topics)

    def _make_topic_job(self, topic_id: str):
        """
        Tạo job function cho 1 topic.
        Wrapped bởi job_runner.wrap() để tracking execution.
        """
        assert self._job_runner is not None
        assert self._topic_runner is not None

        @self._job_runner.wrap(topic_id)
        def job() -> int:
            return self._topic_runner.run(topic_id)

        return job

    def _run_health_check(self) -> None:
        """Chạy health checks và log issues."""
        assert self._health_checker is not None
        issues = self._health_checker.run_check()
        for issue in issues:
            logger.warning("Health: %s", issue)


def _setup_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    # Suppress APScheduler job execution logs (too noisy)
    logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)
    logging.getLogger("apscheduler.schedulers.base").setLevel(logging.WARNING)

    if not settings.logstash_host:
        return

    # Optional dependency — chỉ import khi LOGSTASH_HOST có set,
    # để dev không cần cài thư viện nếu không dùng centralized logging.
    try:
        from logstash_async.handler import AsynchronousLogstashHandler
        from logstash_async.formatter import LogstashFormatter
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
    transport = transport_map.get(settings.logstash_transport, transport_map["udp"])

    handler = AsynchronousLogstashHandler(
        host=settings.logstash_host,
        port=settings.logstash_port,
        database_path=settings.logstash_database_path or None,
        transport=transport,
    )
    # extra_prefix=None: đặt extra fields ở top-level thay vì nested dưới key "extra".
    # Logstash filter check [app_name] ở top-level — nếu nested sẽ không thấy → drop toàn bộ log.
    handler.setFormatter(LogstashFormatter(
        extra_prefix=None,
        extra={
            "app_name": settings.logstash_app_name,
            "service": "layer1-monitor",
            "hostname": _socket.gethostname(),
        },
    ))
    logging.getLogger().addHandler(handler)
    logging.getLogger().info(
        "Logstash handler attached: %s:%s transport=%s app_name=%s database_path=%s",
        settings.logstash_host,
        settings.logstash_port,
        settings.logstash_transport,
        settings.logstash_app_name,
        settings.logstash_database_path or "<in-memory>",
    )


def _setup_signal_handlers(service: Layer1Service) -> None:
    def _shutdown(signum, _frame):
        logger.info("Signal %s received, initiating graceful shutdown...", signum)
        service.stop()
        # Flush async logstash queue trước khi exit
        logging.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)


def main() -> None:
    """Entry point."""
    _setup_logging()
    logger.info("Layer 1 Monitoring Service starting (config-driven)...")

    service = Layer1Service()

    _setup_signal_handlers(service)

    service.start()  # blocking


if __name__ == "__main__":
    main()
