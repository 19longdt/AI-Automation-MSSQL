"""
Entry point for the standalone maintenance service.
"""
from __future__ import annotations

import logging
import signal

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import maint_settings
from .execute.duration_estimator import DurationEstimator
from .execute.execute_service import ExecuteService
from .indexes import create_maint_indexes
from .infra.health_checker import HealthChecker
from .infra.job_execution_repo import JobExecutionRepo
from .infra.job_runner import JobRunner
from .infra.mongo_client import MongoConnection
from .infra.node_role_cache import NodeRoleCache
from .infra.query_executor import QueryExecutor
from .infra.time_utils import now_vn
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
        logger.info("Maintenance service started [%s].", mode)
        self._scheduler.start()

    def stop(self) -> None:
        logger.info("Shutting down maintenance service.")
        if self._execute_service is not None:
            self._execute_service.request_stop()
        self._scheduler.shutdown(wait=False)
        MongoConnection.close()

    def _setup_infrastructure(self) -> None:
        logger.info("Connecting to MongoDB: %s", maint_settings.mongodb_uri)
        MongoConnection.initialize(maint_settings)
        maint_db = get_maint_db()
        create_maint_indexes(maint_db)
        logger.info("Maintenance DB: %s", maint_db.name)

        policy_repo = PolicyRepo()
        queue_repo = QueueRepo()
        window_repo = WindowRepo()
        history_repo = HistoryRepo()
        batch_repo = BatchRepo()
        scan_query_repo = ScanQueryRepo()
        self._history_repo = history_repo

        if policy_repo.find_default() is None or window_repo.get() is None:
            raise RuntimeError(
                "Maintenance config not seeded. Run: python -m maintenance.seed.seed_maintenance"
            )
        if not scan_query_repo.find_all_enabled():
            raise RuntimeError(
                "Maintenance scan queries not seeded. Run: python -m maintenance.seed.seed_maintenance"
            )

        queue_repo.recover_running()

        logger.info("Detecting AG node roles from: %s", maint_settings.mssql_nodes)
        self._role_cache = NodeRoleCache()
        self._role_cache.initialize()

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

        execution_repo = JobExecutionRepo()
        self._job_runner = JobRunner(execution_repo)
        self._health_checker = HealthChecker(execution_repo, job_intervals={})

    def _register_jobs(self) -> None:
        assert self._job_runner is not None
        assert self._scan_service is not None
        assert self._execute_service is not None
        assert self._role_cache is not None

        @self._job_runner.wrap("maint_scan")
        def scan_job() -> int:
            return self._scan_service.run()

        @self._job_runner.wrap("maint_window_tick")
        def tick_job() -> int:
            return self._execute_service.tick()

        @self._job_runner.wrap("maint_summary")
        def summary_job() -> int:
            return self._send_nightly_summary()

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
            seconds=maint_settings.node_role_refresh_sec,
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

    def _send_nightly_summary(self) -> int:
        assert self._history_repo is not None

        window = WindowRepo().get()
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
        return 0

    def _run_health_check(self) -> None:
        assert self._health_checker is not None
        for issue in self._health_checker.run_check():
            logger.warning("Health: %s", issue)


def _setup_logging() -> None:
    level = getattr(logging, maint_settings.log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s - %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)
    logging.getLogger("apscheduler.schedulers.base").setLevel(logging.WARNING)

    if not maint_settings.logstash_host:
        return

    try:
        from logstash_async.formatter import LogstashFormatter
        from logstash_async.handler import AsynchronousLogstashHandler
    except ImportError:
        logging.getLogger().error(
            "LOGSTASH_HOST configured but python-logstash-async is not installed; skipping."
        )
        return

    import socket as _socket

    transport_map = {
        "udp": "logstash_async.transport.UdpTransport",
        "tcp": "logstash_async.transport.TcpTransport",
    }
    transport = transport_map.get(maint_settings.logstash_transport, transport_map["tcp"])
    handler = AsynchronousLogstashHandler(
        host=maint_settings.logstash_host,
        port=maint_settings.logstash_port,
        database_path=maint_settings.logstash_database_path or None,
        transport=transport,
    )
    handler.setFormatter(LogstashFormatter(
        extra_prefix=None,
        extra={
            "app_name": maint_settings.logstash_app_name,
            "service": "maintenance",
            "hostname": _socket.gethostname(),
        },
    ))
    logging.getLogger().addHandler(handler)


def _setup_signal_handlers(service: MaintenanceService) -> None:
    def _shutdown(signum, _frame):
        logger.info("Signal %s received, initiating graceful shutdown.", signum)
        service.stop()
        logging.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)


def main() -> None:
    _setup_logging()
    service = MaintenanceService()
    _setup_signal_handlers(service)
    service.start()


if __name__ == "__main__":
    main()
