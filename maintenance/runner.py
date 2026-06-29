"""Entry point for the standalone maintenance service."""
from __future__ import annotations

import logging
import os
import signal
import sys
import threading
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .catalog.catalog_service import CatalogService
from .config import maint_settings
from .discovery.discovery_service import ClusterDiscoveryService
from .execute.duration_estimator import DurationEstimator
from .execute.execute_service import ClusterExecuteService
from .indexes import create_maint_indexes
from .infra.cluster_reader import ClusterReader
from .infra.health_checker import HealthChecker
from .infra.job_execution_repo import JobExecutionRepo
from .infra.job_runner import JobRunner
from .infra.mongo_client import MongoConnection
from .infra.apm import init_apm
from .infra.trace import TraceIdFilter
from .infra.time_utils import now_vn
from .notify.maintenance_bot import MaintenanceBot
from .notify.maintenance_notifier import MaintenanceNotifier
from .notify.notify_queue import NotifyQueue
from .policy.policy_resolver import PolicyResolver
from .models.catalog import CatalogScopeDatabase
from .repositories.batch_repo import BatchRepo
from .repositories.campaign_repo import CampaignRepo
from .repositories.catalog_config_repo import CatalogConfigRepo
from .repositories.catalog_repo import CatalogRepo
from .repositories.command_repo import CommandRepo
from .repositories.history_repo import HistoryRepo
from .repositories.policy_repo import PolicyRepo
from .repositories.queue_repo import QueueRepo
from .repositories.window_repo import WindowRepo
from .safety.gate_service import GateService
from .safety.health_monitor import HealthMonitorThread
from .window.window_service import WindowService

logger = logging.getLogger(__name__)
VN_TZ = timezone(timedelta(hours=7))


class TriggerBusyError(RuntimeError):
    """Raised when a manual trigger hits an already-running in-process job."""


class SchedulerSuccessLogFilter(logging.Filter):
    """Downgrade APScheduler success chatter to DEBUG while preserving warnings/errors."""

    _DEBUG_PREFIXES = (
        'Running job "',
        'Job "',
    )
    _DEBUG_SUFFIXES = (
        '" executed successfully',
    )

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name != "apscheduler.executors.default" or record.levelno != logging.INFO:
            return True
        message = record.getMessage()
        if message.startswith(self._DEBUG_PREFIXES) or message.endswith(self._DEBUG_SUFFIXES):
            record.levelno = logging.DEBUG
            record.levelname = logging.getLevelName(logging.DEBUG)
        return True


class MaintenanceService:
    def __init__(self) -> None:
        self._scheduler = BlockingScheduler(
            executors={"default": ThreadPoolExecutor(max_workers=20)},
            timezone="Asia/Ho_Chi_Minh",
        )
        self._job_intervals: dict[str, int] = {}
        self._job_runner: JobRunner | None = None
        self._health_checker: HealthChecker | None = None
        self._execute_services: list[ClusterExecuteService] = []
        self._health_monitors: list[HealthMonitorThread] = []
        self._history_repo: HistoryRepo | None = None
        self._window_repo: WindowRepo | None = None
        self._catalog_config_repo: CatalogConfigRepo | None = None
        self._command_repo: CommandRepo | None = None
        self._notifiers: dict[str, MaintenanceNotifier] = {}
        self._pending_jobs: list[
            tuple[str, CatalogService, ClusterDiscoveryService, ClusterExecuteService]
        ] = []
        self._catalog_triggers: dict[str, Callable[[list[CatalogScopeDatabase] | None], int]] = {}
        self._discovery_triggers: dict[str, Callable[[], int]] = {}

    def start(self) -> None:
        self._setup_infrastructure()
        self._register_jobs()
        self._scheduler.start()

    def stop(self) -> None:
        for monitor in self._health_monitors:
            monitor.stop()
        for service in self._execute_services:
            service.request_stop()
        NotifyQueue.get().stop()
        self._scheduler.shutdown(wait=False)
        MongoConnection.close()

    def _setup_infrastructure(self) -> None:
        MongoConnection.initialize(maint_settings)
        maint_db = MongoConnection.get_db()
        monitor_db = MongoConnection.get_client()[maint_settings.monitor_mongodb_db]
        create_maint_indexes(maint_db)

        cluster_reader = ClusterReader(monitor_db)
        clusters = cluster_reader.find_all_enabled()
        if not clusters:
            raise RuntimeError("No enabled clusters found in db_monitor.db_clusters.")

        queue_repo = QueueRepo()
        window_repo = WindowRepo()
        history_repo = HistoryRepo()
        batch_repo = BatchRepo()
        campaign_repo = CampaignRepo()
        policy_repo = PolicyRepo()
        catalog_config_repo = CatalogConfigRepo()
        catalog_repo = CatalogRepo()
        command_repo = CommandRepo()
        if policy_repo.find_default() is None:
            raise RuntimeError("Maintenance default policy missing. Run seed_maintenance first.")

        self._history_repo = history_repo
        self._window_repo = window_repo
        self._catalog_config_repo = catalog_config_repo
        self._command_repo = command_repo
        queue_repo.recover_running()

        MaintenanceBot(
            bot_token=maint_settings.maint_telegram_bot_token,
            chat_id=maint_settings.telegram_chat_id,
            queue_repo=queue_repo,
            batch_repo=batch_repo,
        ).start()

        estimator = DurationEstimator(
            pages_per_minute=maint_settings.maint_estimate_pages_per_minute,
            rows_per_minute=maint_settings.maint_estimate_rows_per_minute,
        )
        resolver = PolicyResolver(policy_repo)
        for cluster in clusters:
            if window_repo.find_by_cluster(cluster.cluster_id) is None:
                logger.warning(
                    "Cluster=%s has no maintenance_window - catalog/discovery will run, "
                    "execute tick will skip until window is configured via Layer 3 UI.",
                    cluster.cluster_id,
                )
            if catalog_config_repo.find_by_cluster(cluster.cluster_id) is None:
                logger.warning(
                    "Cluster=%s: no maintenance_catalog_config found. Catalog job will skip. "
                    "Campaign discovery requires catalog data. Configure via Layer 3 UI (tab Catalog > Configure Scope).",
                    cluster.cluster_id,
                )
            campaign_repo.reset_stuck_discovering(cluster.cluster_id)
            notifier = MaintenanceNotifier(
                maint_settings.maint_telegram_bot_token,
                maint_settings.telegram_chat_id,
                cluster.cluster_id,
            )
            self._notifiers[cluster.cluster_id] = notifier
            window_service = WindowService(cluster.cluster_id, window_repo, history_repo)
            catalog_service = CatalogService(
                cluster=cluster,
                cluster_reader=cluster_reader,
                config_repo=catalog_config_repo,
                catalog_repo=catalog_repo,
                settings=maint_settings,
            )
            discovery_service = ClusterDiscoveryService(
                cluster=cluster,
                policy_resolver=resolver,
                queue_repo=queue_repo,
                batch_repo=batch_repo,
                campaign_repo=campaign_repo,
                catalog_repo=catalog_repo,
                estimator=estimator,
                maint_settings=maint_settings,
                publisher=notifier,
            )
            execute_service = ClusterExecuteService(
                cluster=cluster,
                queue_repo=queue_repo,
                history_repo=history_repo,
                campaign_repo=campaign_repo,
                window_repo=window_repo,
                window_service=window_service,
                gate_service=GateService(),
                policy_resolver=resolver,
                maint_settings=maint_settings,
                cluster_reader=cluster_reader,
                publisher=notifier,
            )
            health_monitor = HealthMonitorThread(
                cluster_id=cluster.cluster_id,
                window_repo=window_repo,
                gate_service=GateService(),
                execute_service=execute_service,
                publisher=notifier,
            )
            health_monitor.start()

            self._execute_services.append(execute_service)
            self._health_monitors.append(health_monitor)
            self._register_cluster_jobs(cluster.cluster_id, catalog_service, discovery_service, execute_service)

        execution_repo = JobExecutionRepo()
        self._job_runner = JobRunner(execution_repo)
        self._health_checker = HealthChecker(execution_repo, self._job_intervals)

    def _register_cluster_jobs(
        self,
        cluster_id: str,
        catalog_service: CatalogService,
        discovery_service: ClusterDiscoveryService,
        execute_service: ClusterExecuteService,
    ) -> None:
        assert self._job_runner is None
        self._pending_jobs.append((cluster_id, catalog_service, discovery_service, execute_service))

    def _register_jobs(self) -> None:
        assert self._job_runner is not None
        for cluster_id, catalog_service, discovery_service, execute_service in self._pending_jobs:
            catalog_job_id = f"maint_catalog_{cluster_id}"
            discovery_job_id = f"maint_discovery_{cluster_id}"
            tick_job_id = f"maint_tick_{cluster_id}"
            summary_job_id = f"maint_summary_{cluster_id}"
            catalog_lock = threading.Lock()
            discovery_lock = threading.Lock()

            def run_catalog(
                scope_override: list[CatalogScopeDatabase] | None = None,
                service=catalog_service,
                cid=cluster_id,
                lock=catalog_lock,
            ) -> int:
                if not lock.acquire(blocking=False):
                    raise TriggerBusyError(
                        f"Catalog run already active for cluster={cid}"
                    )
                try:
                    return service.run_with_scope(scope_override)
                finally:
                    lock.release()

            def run_discovery(service=discovery_service, cid=cluster_id, lock=discovery_lock) -> int:
                if not lock.acquire(blocking=False):
                    raise TriggerBusyError(
                        f"Discovery run already active for cluster={cid}"
                    )
                try:
                    return service.run()
                finally:
                    lock.release()

            def run_discovery_forced(service=discovery_service, cid=cluster_id, lock=discovery_lock) -> int:
                if not lock.acquire(blocking=False):
                    raise TriggerBusyError(
                        f"Discovery run already active for cluster={cid}"
                    )
                try:
                    return service.run(forced=True)
                finally:
                    lock.release()

            self._catalog_triggers[cluster_id] = run_catalog
            self._discovery_triggers[cluster_id] = run_discovery_forced

            @self._job_runner.wrap(catalog_job_id)
            def catalog_job(run=run_catalog) -> int:
                try:
                    return run()
                except TriggerBusyError as exc:
                    logger.info("%s", exc)
                    return 0

            @self._job_runner.wrap(discovery_job_id)
            def discovery_job(run=run_discovery) -> int:
                try:
                    return run()
                except TriggerBusyError as exc:
                    logger.info("%s", exc)
                    return 0

            @self._job_runner.wrap(tick_job_id)
            def tick_job(service=execute_service) -> int:
                return service.tick()

            @self._job_runner.wrap(summary_job_id)
            def summary_job(cid=cluster_id) -> int:
                return self._send_nightly_summary(cid)

            self._scheduler.add_job(
                catalog_job,
                CronTrigger.from_crontab(maint_settings.maint_catalog_cron, timezone="Asia/Ho_Chi_Minh"),
                id=catalog_job_id,
                max_instances=1,
                coalesce=True,
            )
            self._scheduler.add_job(
                discovery_job,
                IntervalTrigger(seconds=60),
                id=discovery_job_id,
                max_instances=1,
                coalesce=True,
            )
            self._scheduler.add_job(
                tick_job,
                IntervalTrigger(seconds=maint_settings.maint_tick_sec),
                id=tick_job_id,
                max_instances=1,
                coalesce=True,
            )
            self._scheduler.add_job(
                summary_job,
                CronTrigger.from_crontab(maint_settings.maint_summary_cron, timezone="Asia/Ho_Chi_Minh"),
                id=summary_job_id,
                max_instances=1,
                coalesce=True,
            )
            self._job_intervals[catalog_job_id] = 24 * 3600
            self._job_intervals[discovery_job_id] = 60
            self._job_intervals[tick_job_id] = maint_settings.maint_tick_sec
            self._job_intervals[summary_job_id] = 24 * 3600
            logger.info("Registered maintenance jobs for cluster=%s", cluster_id)

        self._scheduler.add_job(
            self._poll_commands,
            IntervalTrigger(seconds=30),
            id="command_poll",
            max_instances=1,
            coalesce=True,
        )
        # command_poll and health_check are not wrapped by job_runner → not tracked
        # in job_executions → excluding from health_checker intervals to avoid false MISSED alerts
        self._scheduler.add_job(
            self._run_health_check,
            IntervalTrigger(seconds=120),
            id="health_check",
            max_instances=1,
            coalesce=True,
        )

    def _send_nightly_summary(self, cluster_id: str) -> int:
        assert self._history_repo is not None
        assert self._window_repo is not None
        notifier = self._notifiers.get(cluster_id)
        if notifier is None:
            return 0

        now = now_vn()
        # 25h lookback covers both global overnight window and any campaign window_override
        # (e.g. daytime override 08:00-23:32 is within 25h of summary at 05:30).
        since = now - timedelta(hours=25)
        records = self._history_repo.find_between(cluster_id, since, now)

        # Budget display uses global window slot when available
        slot = None
        used_minutes = 0.0
        window = self._window_repo.find_by_cluster(cluster_id)
        if window is not None:
            bounds = WindowService.last_window_bounds(window, now)
            if bounds is not None:
                start, end, slot = bounds
                used_minutes = self._history_repo.sum_done_minutes_between(cluster_id, start, end)

        notifier.send_nightly_summary(records, slot, used_minutes)
        return 0

    def _run_health_check(self) -> None:
        assert self._health_checker is not None
        for issue in self._health_checker.run_check():
            logger.warning("Health: %s", issue)

    def _poll_commands(self) -> None:
        assert self._command_repo is not None
        command = self._command_repo.claim_pending()
        if command is None:
            return
        try:
            if command.type.value == "run_catalog":
                trigger = self._catalog_triggers.get(command.cluster_id)
            elif command.type.value == "run_discovery":
                trigger = self._discovery_triggers.get(command.cluster_id)
            else:
                trigger = None

            if trigger is None:
                raise RuntimeError(
                    f"No trigger registered for cluster={command.cluster_id} type={command.type.value}"
                )
            if command.type.value == "run_catalog":
                trigger(command.catalog_scope)
            else:
                trigger()
            self._command_repo.mark_done(command.command_id)
        except TriggerBusyError:
            self._command_repo.mark_pending(command.command_id)
        except Exception as exc:
            logger.exception(
                "Maintenance command failed command_id=%s cluster=%s type=%s",
                command.command_id,
                command.cluster_id,
                command.type.value,
            )
            self._command_repo.mark_failed(command.command_id, str(exc))


class VNTimeFormatter(logging.Formatter):
    """Force all runner logs to VN time regardless of container/system timezone."""

    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
        dt = datetime.fromtimestamp(record.created, VN_TZ)
        return dt.strftime(datefmt or "%Y-%m-%dT%H:%M:%S")


class ConsoleColorFormatter(VNTimeFormatter):
    """Apply ANSI colors for interactive console logs without affecting other handlers."""

    _RESET = "\033[0m"
    _LEVEL_COLORS = {
        logging.DEBUG: "\033[36m",
        logging.INFO: "\033[32m",
        logging.WARNING: "\033[33m",
        logging.ERROR: "\033[31m",
        logging.CRITICAL: "\033[1;31m",
    }

    def __init__(self, *args, enable_colors: bool, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._enable_colors = enable_colors

    def format(self, record: logging.LogRecord) -> str:
        message = super().format(record)
        if not self._enable_colors:
            return message
        color = self._LEVEL_COLORS.get(record.levelno)
        if not color:
            return message
        return f"{color}{message}{self._RESET}"


def _should_enable_console_colors(stream: object) -> bool:
    if os.getenv("NO_COLOR"):
        return False
    return bool(getattr(stream, "isatty", lambda: False)())


def _setup_logging() -> None:
    level = getattr(logging, maint_settings.log_level.upper(), logging.INFO)
    console_handler = logging.StreamHandler(sys.stdout)
    logging.basicConfig(level=level, handlers=[console_handler], force=True)
    root_logger = logging.getLogger()
    success_filter = SchedulerSuccessLogFilter()
    trace_filter = TraceIdFilter()
    formatter = ConsoleColorFormatter(
        fmt="%(asctime)s %(levelname)-8s [%(trace_id)s] %(name)s - %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        enable_colors=_should_enable_console_colors(sys.stdout),
    )
    # Filter phải gắn trên handler, không phải logger — records từ child loggers
    # propagate lên root handlers mà không qua root logger filter.
    for handler in root_logger.handlers:
        handler.setFormatter(formatter)
        handler.addFilter(success_filter)
        handler.addFilter(trace_filter)

    if not maint_settings.logstash_host:
        return

    try:
        from logstash_async.formatter import LogstashFormatter
        from logstash_async.handler import AsynchronousLogstashHandler
    except ImportError:
        root_logger.error(
            "LOGSTASH_HOST configured but python-logstash-async not installed; skipping."
        )
        return

    import socket as _socket

    transport_map = {
        "udp": "logstash_async.transport.UdpTransport",
        "tcp": "logstash_async.transport.TcpTransport",
    }
    handler = AsynchronousLogstashHandler(
        host=maint_settings.logstash_host,
        port=maint_settings.logstash_port,
        database_path=maint_settings.logstash_database_path or None,
        transport=transport_map.get(maint_settings.logstash_transport, transport_map["udp"]),
    )
    handler.setFormatter(
        LogstashFormatter(
            extra_prefix=None,
            extra={
                "app_name": maint_settings.logstash_app_name,
                "service": "maintenance-runner",
                "hostname": _socket.gethostname(),
            },
        )
    )
    handler.addFilter(trace_filter)
    root_logger.addHandler(handler)


def _setup_signal_handlers(service: MaintenanceService) -> None:
    def _shutdown(signum, _frame):
        logger.info("Signal %s received, initiating graceful shutdown.", signum)
        service.stop()
        logging.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)


def main() -> None:
    _setup_logging()
    init_apm(maint_settings)
    service = MaintenanceService()
    _setup_signal_handlers(service)
    service.start()


if __name__ == "__main__":
    main()
