"""Entry point for the standalone maintenance service."""
from __future__ import annotations

import logging
import signal

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .config import maint_settings
from .execute.duration_estimator import DurationEstimator
from .execute.execute_service import ClusterExecuteService
from .indexes import create_maint_indexes
from .infra.cluster_reader import ClusterReader
from .infra.health_checker import HealthChecker
from .infra.job_execution_repo import JobExecutionRepo
from .infra.job_runner import JobRunner
from .infra.mongo_client import MongoConnection
from .infra.query_executor import QueryExecutor
from .infra.time_utils import now_vn
from .notify.maintenance_bot import MaintenanceBot
from .notify.maintenance_notifier import MaintenanceNotifier
from .policy.policy_resolver import PolicyResolver
from .repositories.batch_repo import BatchRepo
from .repositories.campaign_repo import CampaignRepo
from .repositories.history_repo import HistoryRepo
from .repositories.policy_repo import PolicyRepo
from .repositories.queue_repo import QueueRepo
from .repositories.scan_query_repo import ScanQueryRepo
from .repositories.window_repo import WindowRepo
from .safety.gate_service import GateService
from .scan.scan_service import ClusterScanService
from .window.window_service import WindowService

logger = logging.getLogger(__name__)


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
        self._history_repo: HistoryRepo | None = None
        self._window_repo: WindowRepo | None = None
        self._notifiers: dict[str, MaintenanceNotifier] = {}
        self._pending_jobs: list[tuple[str, ClusterScanService, ClusterExecuteService]] = []

    def start(self) -> None:
        self._setup_infrastructure()
        self._register_jobs()
        self._scheduler.start()

    def stop(self) -> None:
        for service in self._execute_services:
            service.request_stop()
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
        scan_query_repo = ScanQueryRepo()
        if policy_repo.find_default() is None:
            raise RuntimeError("Maintenance default policy missing. Run seed_maintenance first.")
        if not scan_query_repo.find_all_enabled():
            raise RuntimeError("Maintenance scan queries missing. Run seed_maintenance first.")

        self._history_repo = history_repo
        self._window_repo = window_repo
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
                logger.warning("Skip cluster=%s because maintenance_window is not seeded.", cluster.cluster_id)
                continue
            campaign_repo.reset_stuck_discovering(cluster.cluster_id)
            notifier = MaintenanceNotifier(
                maint_settings.maint_telegram_bot_token,
                maint_settings.telegram_chat_id,
                cluster.cluster_id,
            )
            self._notifiers[cluster.cluster_id] = notifier
            window_service = WindowService(cluster.cluster_id, window_repo, history_repo)
            scan_service = ClusterScanService(
                cluster=cluster,
                query_executor=QueryExecutor(),
                policy_resolver=resolver,
                queue_repo=queue_repo,
                batch_repo=batch_repo,
                campaign_repo=campaign_repo,
                scan_query_repo=scan_query_repo,
                estimator=estimator,
                maint_settings=maint_settings,
                notifier=notifier,
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
            )
            self._execute_services.append(execute_service)
            self._register_cluster_jobs(cluster.cluster_id, scan_service, execute_service)

        execution_repo = JobExecutionRepo()
        self._job_runner = JobRunner(execution_repo)
        self._health_checker = HealthChecker(execution_repo, self._job_intervals)

    def _register_cluster_jobs(
        self,
        cluster_id: str,
        scan_service: ClusterScanService,
        execute_service: ClusterExecuteService,
    ) -> None:
        assert self._job_runner is None
        # delayed until _register_jobs() because decorators need runner instance
        self._pending_jobs.append((cluster_id, scan_service, execute_service))

    def _register_jobs(self) -> None:
        assert self._job_runner is not None
        for cluster_id, scan_service, execute_service in self._pending_jobs:
            scan_job_id = f"maint_scan_{cluster_id}"
            tick_job_id = f"maint_tick_{cluster_id}"
            summary_job_id = f"maint_summary_{cluster_id}"

            @self._job_runner.wrap(scan_job_id)
            def scan_job(service=scan_service) -> int:
                return service.run()

            @self._job_runner.wrap(tick_job_id)
            def tick_job(service=execute_service) -> int:
                return service.tick()

            @self._job_runner.wrap(summary_job_id)
            def summary_job(cid=cluster_id) -> int:
                return self._send_nightly_summary(cid)

            self._scheduler.add_job(
                scan_job,
                IntervalTrigger(seconds=60),
                id=scan_job_id,
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
            self._job_intervals[scan_job_id] = 60
            self._job_intervals[tick_job_id] = maint_settings.maint_tick_sec
            self._job_intervals[summary_job_id] = 24 * 3600
            logger.info("Registered maintenance jobs for cluster=%s", cluster_id)

        self._scheduler.add_job(
            self._run_health_check,
            IntervalTrigger(seconds=120),
            id="health_check",
            max_instances=1,
            coalesce=True,
        )
        self._job_intervals["health_check"] = 120

    def _send_nightly_summary(self, cluster_id: str) -> int:
        assert self._history_repo is not None
        assert self._window_repo is not None
        notifier = self._notifiers.get(cluster_id)
        if notifier is None:
            return 0
        window = self._window_repo.find_by_cluster(cluster_id)
        if window is None:
            return 0
        bounds = WindowService.last_window_bounds(window, now_vn())
        if bounds is None:
            return 0
        start, end, slot = bounds
        records = self._history_repo.find_between(cluster_id, start, end)
        used_minutes = self._history_repo.sum_done_minutes_between(cluster_id, start, end)
        notifier.send_nightly_summary(records, slot, used_minutes)
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
