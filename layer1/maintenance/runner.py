"""
runner.py — Entry point của Maintenance Service (PROCESS RIÊNG).

Chạy: python -m layer1.maintenance.runner

Mirror pattern Layer1Service (layer1/scheduler.py) nhưng:
  - KHÔNG TelegramBot polling (monitoring process độc quyền getUpdates)
  - KHÔNG capture tools / detectors — chỉ scan + execute maintenance
  - SIGTERM → PAUSE resumable rebuild đang chạy trước khi shutdown

Jobs (APScheduler):
  maint_scan         cron MAINT_SCAN_CRON (VN time) — scan + gửi batch approval
  maint_window_tick  interval MAINT_TICK_SEC — execute 1 item nếu window mở
  maint_summary      cron MAINT_SUMMARY_CRON — tổng kết đêm gửi Telegram
  node_role_refresh  interval NODE_ROLE_REFRESH_SEC
  health_check       interval 120s
"""
from __future__ import annotations

import logging
import signal

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from ..config import settings
from ..executor.node_role_cache import NodeRoleCache
from ..executor.query_executor import QueryExecutor
from ..job_manager.health_checker import HealthChecker
from ..job_manager.job_runner import JobRunner
from ..storage.indexes import create_all_indexes
from ..storage.mongo_client import MongoConnection
from ..storage.repositories.job_execution_repo import JobExecutionRepo
from ..utils.time_utils import now_vn
from .config import maint_settings
from .execute.duration_estimator import DurationEstimator
from .execute.execute_service import ExecuteService
from .indexes import create_maint_indexes
from .mongo import get_maint_db
from .notify.maintenance_notifier import MaintenanceNotifier
from .policy.policy_resolver import PolicyResolver
from .repositories.batch_repo import BatchRepo
from .repositories.history_repo import HistoryRepo
from .repositories.policy_repo import PolicyRepo
from .repositories.queue_repo import QueueRepo
from .repositories.scan_query_repo import ScanQueryRepo
from .repositories.window_repo import WindowRepo
from .safety.gate_service import GateService
from .scan.scan_service import ScanService
from .window.window_service import WindowService

logger = logging.getLogger(__name__)


class MaintenanceService:
    """Orchestrator của maintenance process."""

    def __init__(self) -> None:
        self._scheduler = BlockingScheduler(timezone="UTC")
        self._role_cache: NodeRoleCache | None = None
        self._scan_service: ScanService | None = None
        self._execute_service: ExecuteService | None = None
        self._window_service: WindowService | None = None
        self._history_repo: HistoryRepo | None = None
        self._notifier: MaintenanceNotifier | None = None
        self._job_runner: JobRunner | None = None
        self._health_checker: HealthChecker | None = None

    def start(self) -> None:
        self._setup_infrastructure()
        self._register_jobs()
        mode = "DRY_RUN" if maint_settings.maint_dry_run else "LIVE"
        logger.info("Maintenance Service started [%s] — scheduler running.", mode)
        if maint_settings.maint_dry_run:
            logger.warning(
                "MAINT_DRY_RUN=true — statements chỉ được LOG, không execute. "
                "Set MAINT_DRY_RUN=false sau khi verify."
            )
        self._scheduler.start()  # blocking

    def stop(self) -> None:
        """Graceful shutdown — PAUSE resumable rebuild đang chạy nếu có."""
        logger.info("Shutting down Maintenance Service...")
        if self._execute_service is not None:
            self._execute_service.request_stop()
        self._scheduler.shutdown(wait=False)
        MongoConnection.close()

    def _setup_infrastructure(self) -> None:
        # 1. MongoDB + indexes
        logger.info("Connecting to MongoDB: %s", settings.mongodb_uri)
        MongoConnection.initialize(settings)
        # Monitoring DB (findings, raw_metrics...) — dùng bởi job_execution_repo, node_role_cache
        create_all_indexes(MongoConnection.get_db())
        # Maintenance DB riêng — tất cả collections maintenance
        maint_db = get_maint_db()
        create_maint_indexes(maint_db)
        logger.info("Maintenance DB: %s", maint_db.name)

        # 2. Repos + fail fast nếu chưa seed
        policy_repo = PolicyRepo()
        queue_repo = QueueRepo()
        window_repo = WindowRepo()
        history_repo = HistoryRepo()
        batch_repo = BatchRepo()
        scan_query_repo = ScanQueryRepo()
        self._history_repo = history_repo

        if policy_repo.find_default() is None or window_repo.get() is None:
            raise RuntimeError(
                "Chưa seed maintenance config. Chạy: "
                "python -m layer1.maintenance.seed.seed_maintenance"
            )
        if not scan_query_repo.find_all_enabled():
            raise RuntimeError(
                "Chưa seed scan queries. Chạy: "
                "python -m layer1.maintenance.seed.seed_maintenance"
            )

        # 3. Recovery: item RUNNING từ process chết giữa chừng → approved
        queue_repo.recover_running()

        # 4. Node role cache
        logger.info("Detecting AG node roles from: %s", settings.mssql_nodes)
        self._role_cache = NodeRoleCache()
        self._role_cache.initialize()

        # 5. Telegram bot riêng — bắt buộc có MAINT_TELEGRAM_BOT_TOKEN.
        #    Tự poll approval callbacks, độc lập với monitoring bot.
        from .notify.maintenance_bot import MaintenanceBot
        self._notifier = MaintenanceNotifier(
            maint_settings.maint_telegram_bot_token,
            maint_settings.maint_telegram_chat_id,
        )
        MaintenanceBot(
            bot_token=maint_settings.maint_telegram_bot_token,
            chat_id=maint_settings.maint_telegram_chat_id,
            queue_repo=queue_repo,
            batch_repo=batch_repo,
        ).start()
        logger.info("Maintenance Telegram bot started (polling).")

        # 6. Services
        resolver = PolicyResolver(policy_repo)
        estimator = DurationEstimator(
            pages_per_minute=maint_settings.maint_estimate_pages_per_minute,
            rows_per_minute=maint_settings.maint_estimate_rows_per_minute,
        )
        self._window_service = WindowService(window_repo, history_repo)
        self._scan_service = ScanService(
            query_executor=QueryExecutor(),
            role_cache=self._role_cache,
            policy_resolver=resolver,
            queue_repo=queue_repo,
            batch_repo=batch_repo,
            scan_query_repo=scan_query_repo,
            estimator=estimator,
            maint_settings=maint_settings,
            notifier=self._notifier,
        )
        self._execute_service = ExecuteService(
            queue_repo=queue_repo,
            history_repo=history_repo,
            window_repo=window_repo,
            window_service=self._window_service,
            gate_service=GateService(),
            policy_resolver=resolver,
            role_cache=self._role_cache,
            maint_settings=maint_settings,
        )

        # 7. Job tracking + health
        execution_repo = JobExecutionRepo()
        self._job_runner = JobRunner(execution_repo)
        self._health_checker = HealthChecker(execution_repo, job_intervals={})

    def _register_jobs(self) -> None:
        assert self._job_runner is not None
        assert self._scan_service is not None
        assert self._execute_service is not None
        assert self._role_cache is not None

        scan_service = self._scan_service
        execute_service = self._execute_service

        @self._job_runner.wrap("maint_scan")
        def scan_job() -> int:
            return scan_service.run()

        @self._job_runner.wrap("maint_window_tick")
        def tick_job() -> int:
            return execute_service.tick()

        @self._job_runner.wrap("maint_summary")
        def summary_job() -> int:
            return self._send_nightly_summary()

        # Cron expressions theo GIỜ VN. APScheduler 3.x chỉ nhận pytz timezone —
        # truyền string để nó tự convert (datetime.timezone sẽ raise TypeError).
        vn_tz = "Asia/Ho_Chi_Minh"
        self._scheduler.add_job(
            scan_job,
            trigger=CronTrigger.from_crontab(maint_settings.maint_scan_cron, timezone=vn_tz),
            id="maint_scan",
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.add_job(
            tick_job,
            trigger="interval",
            seconds=maint_settings.maint_tick_sec,
            id="maint_window_tick",
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.add_job(
            summary_job,
            trigger=CronTrigger.from_crontab(maint_settings.maint_summary_cron, timezone=vn_tz),
            id="maint_summary",
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.add_job(
            self._role_cache.refresh,
            trigger="interval",
            seconds=settings.node_role_refresh_sec,
            id="node_role_refresh",
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.add_job(
            self._run_health_check,
            trigger="interval",
            seconds=120,
            id="health_check",
            max_instances=1,
            coalesce=True,
        )
        logger.info(
            "Registered maintenance jobs: scan=%r tick=%ds summary=%r.",
            maint_settings.maint_scan_cron,
            maint_settings.maint_tick_sec,
            maint_settings.maint_summary_cron,
        )

    def _send_nightly_summary(self) -> int:
        """Tổng kết window đêm vừa rồi từ maintenance_history."""
        assert self._window_service is not None
        assert self._history_repo is not None

        window_repo = WindowRepo()
        window = window_repo.get()
        if window is None:
            return 0
        bounds = WindowService.last_window_bounds(window, now_vn())
        if bounds is None:
            return 0
        start, end, slot = bounds

        records = self._history_repo.find_between(start, end)
        used_minutes = self._history_repo.sum_done_minutes_between(start, end)
        if self._notifier is not None:
            self._notifier.send_nightly_summary(records, slot, used_minutes)
        logger.info(
            "Nightly summary %s → %s: %d records, %.0fp used.",
            start, end, len(records), used_minutes,
        )
        return 0

    def _run_health_check(self) -> None:
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
    transport = transport_map.get(settings.logstash_transport, transport_map["udp"])
    handler = AsynchronousLogstashHandler(
        host=settings.logstash_host,
        port=settings.logstash_port,
        # Queue path riêng — không share SQLite với process monitoring
        database_path=None,
        transport=transport,
    )
    handler.setFormatter(LogstashFormatter(
        extra_prefix=None,
        extra={
            "app_name": settings.logstash_app_name,
            "service": "layer1-maintenance",
            "hostname": _socket.gethostname(),
        },
    ))
    logging.getLogger().addHandler(handler)


def _setup_signal_handlers(service: MaintenanceService) -> None:
    def _shutdown(signum, _frame):
        logger.info("Signal %s received, initiating graceful shutdown...", signum)
        service.stop()
        logging.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)


def main() -> None:
    _setup_logging()
    logger.info("Maintenance Service starting (separate process)...")
    service = MaintenanceService()
    _setup_signal_handlers(service)
    service.start()  # blocking


if __name__ == "__main__":
    main()
