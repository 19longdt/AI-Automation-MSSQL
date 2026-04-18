"""
scheduler.py — Entry point của Layer 1 Monitoring Service.

Startup sequence:
  1. Load env config (EnvSettings) — fail fast nếu thiếu required vars
  2. Kết nối MongoDB, tạo indexes
  3. Load runtime config từ MongoDB `service_config` (override defaults)
  4. Khởi tạo repositories, collectors, detectors, notifiers
  5. Khởi tạo Leader Election, bắt đầu election
  6. Đăng ký jobs vào APScheduler (chỉ Leader mới chạy, Standby skip qua job_runner)
  7. Start scheduler, block cho đến khi SIGTERM/SIGINT

Graceful shutdown:
  - SIGTERM/SIGINT → shutdown scheduler → release MongoDB leadership → close connections

Chạy: python -m layer1.scheduler
"""
from __future__ import annotations

import logging
import signal
import sys

from apscheduler.schedulers.blocking import BlockingScheduler

from .config import ConfigManager
from .job_manager.leader_election import LeaderElection
from .job_manager.job_runner import JobRunner
from .job_manager.health_checker import HealthChecker
from .storage.mongo_client import MongoConnection
from .storage.indexes import create_all_indexes
from .storage.repositories.config_repo import ConfigRepo
from .storage.repositories.findings_repo import FindingsRepo
from .storage.repositories.raw_metrics_repo import RawMetricsRepo
from .storage.repositories.baseline_repo import BaselineRepo
from .storage.repositories.dedup_repo import DedupRepo
from .storage.repositories.leader_repo import LeaderRepo
from .storage.repositories.job_execution_repo import JobExecutionRepo
from .collectors.query_store import QueryStoreCollector
from .collectors.query_stats import QueryStatsCollector
from .collectors.blocking import BlockingCollector
from .collectors.blocked_queries import BlockedQueriesCollector
from .collectors.tempdb_memory import TempDbMemoryCollector
from .collectors.wait_stats import WaitStatsCollector
from .collectors.agent_jobs import AgentJobsCollector
from .collectors.ag_health import AgHealthCollector
from .collectors.index_fragmentation import IndexFragmentationCollector
from .collectors.missing_indexes import MissingIndexesCollector
from .collectors.resource_governor import ResourceGovernorCollector
from .detectors.query_regression import QueryRegressionDetector
from .detectors.plan_regression import PlanRegressionDetector
from .detectors.plan_instability import PlanInstabilityDetector
from .detectors.blocking_detector import BlockingDetector
from .detectors.blocked_query_trend import BlockedQueryTrendDetector
from .detectors.wait_anomaly_detector import WaitAnomalyDetector
from .detectors.threshold_checker import ThresholdChecker
from .notifications.base_notifier import NotificationDispatcher
from .notifications.teams_notifier import TeamsNotifier
from .plan_parser.plan_comparer import PlanComparer

logger = logging.getLogger(__name__)


class ServiceContainer:
    """
    Dependency injection container — khởi tạo và giữ tất cả service objects.
    Tách construction khỏi startup logic để dễ test từng component riêng.
    """

    def __init__(self, cfg: ConfigManager) -> None:
        self.cfg = cfg

        # Repositories
        self.raw_metrics_repo: RawMetricsRepo = ...
        self.findings_repo: FindingsRepo = ...
        self.baseline_repo: BaselineRepo = ...
        self.dedup_repo: DedupRepo = ...
        self.leader_repo: LeaderRepo = ...
        self.job_execution_repo: JobExecutionRepo = ...

        # Collectors
        self.query_store_collector: QueryStoreCollector = ...
        self.query_stats_collector: QueryStatsCollector = ...
        self.blocking_collector: BlockingCollector = ...
        self.blocked_queries_collector: BlockedQueriesCollector = ...
        self.tempdb_memory_collector: TempDbMemoryCollector = ...
        self.wait_stats_collector: WaitStatsCollector = ...
        self.agent_jobs_collector: AgentJobsCollector = ...
        self.ag_health_collector: AgHealthCollector = ...
        self.index_frag_collector: IndexFragmentationCollector = ...
        self.missing_index_collector: MissingIndexesCollector = ...
        self.resource_gov_collector: ResourceGovernorCollector = ...

        # Detectors
        self.query_regression_detector: QueryRegressionDetector = ...
        self.plan_regression_detector: PlanRegressionDetector = ...
        self.plan_instability_detector: PlanInstabilityDetector = ...
        self.blocking_detector: BlockingDetector = ...
        self.blocked_query_trend_detector: BlockedQueryTrendDetector = ...
        self.wait_anomaly_detector: WaitAnomalyDetector = ...
        self.threshold_checker: ThresholdChecker = ...

        # Infra
        self.election: LeaderElection = ...
        self.runner: JobRunner = ...
        self.dispatcher: NotificationDispatcher = ...
        self.health_checker: HealthChecker = ...

    @classmethod
    def build(cls, cfg: ConfigManager) -> ServiceContainer:
        """Khởi tạo tất cả dependencies theo đúng thứ tự."""
        ...


class Layer1Service:
    """Orchestrator chính — quản lý APScheduler và lifecycle."""

    def __init__(self, container: ServiceContainer) -> None:
        self._c = container
        self._scheduler = BlockingScheduler(timezone="UTC")

    def start(self) -> None:
        """
        Đăng ký tất cả jobs và start scheduler.
        Jobs được wrap qua job_runner.wrap() — Standby instance tự động skip.
        """
        ...

    def stop(self) -> None:
        """Graceful shutdown — được gọi khi nhận SIGTERM/SIGINT."""
        ...

    def _register_jobs(self) -> None:
        """
        Đăng ký tất cả APScheduler jobs với:
          - trigger: interval
          - max_instances=1 (tránh overlap)
          - coalesce=True (bỏ qua missed runs)
          - id: job name để health checker track
        """
        ...

    # ── Job functions (1 function per job type) ─────────────────────────────

    def _run_query_checks(self) -> int:
        """Collect QS + DMV → detect slow query / plan regression / instability / variation."""
        ...

    def _run_blocking_monitor(self) -> int:
        """Collect blocking chains + blocked query snapshot → detect + trend."""
        ...

    def _run_ag_health(self) -> int:
        """Collect AG sync + CDC job status → threshold check."""
        ...

    def _run_wait_stats(self) -> int:
        """Collect wait stats delta → anomaly detection vs day-of-week baseline."""
        ...

    def _run_tempdb_memory(self) -> int:
        """Collect TempDB + memory metrics → threshold check."""
        ...

    def _run_resource_governor(self) -> int:
        """Collect resource pool usage → sustained threshold check."""
        ...

    def _run_agent_jobs(self) -> int:
        """Collect SQL Agent jobs + backup + DBCC → maintenance checks."""
        ...

    def _run_missing_indexes(self) -> int:
        """Collect missing index DMV → filter by improvement_measure."""
        ...

    def _run_index_fragmentation(self) -> int:
        """Daily: collect fragmentation → classify REORGANIZE vs REBUILD."""
        ...

    def _run_baseline_update(self) -> int:
        """Hourly: upsert baselines cho slow query và wait stats."""
        ...

    def _run_health_check(self) -> int:
        """2 phút: check stuck/missed jobs, MongoDB health."""
        ...


def _setup_logging() -> None:
    """Cấu hình structured logging với level từ LOG_LEVEL env var."""
    ...


def _setup_signal_handlers(service: Layer1Service) -> None:
    """Đăng ký SIGTERM/SIGINT handler để graceful shutdown."""
    ...


def main() -> None:
    """Entry point chính."""
    _setup_logging()
    logger.info("Layer 1 Monitoring Service starting...")

    cfg = ConfigManager.get()

    MongoConnection.initialize(cfg)
    create_all_indexes(MongoConnection.get_db())

    config_repo = ConfigRepo()
    cfg.load_runtime_from_mongo(config_repo.load())

    container = ServiceContainer.build(cfg)
    container.election.start()

    service = Layer1Service(container)
    _setup_signal_handlers(service)

    logger.info("Service started. Role: %s", container.election.get_role())
    service.start()  # blocking


if __name__ == "__main__":
    main()
