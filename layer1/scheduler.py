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

from apscheduler.schedulers.blocking import BlockingScheduler

from .config import settings
from .executor.node_role_cache import NodeRoleCache
from .executor.query_executor import QueryExecutor
from .executor.topic_runner import TopicRunner
from .detectors.registry import DetectorRegistry
from .job_manager.job_runner import JobRunner
from .job_manager.health_checker import HealthChecker
from .storage.mongo_client import MongoConnection
from .storage.indexes import create_all_indexes
from .storage.repositories.topic_repo import TopicRepo
from .storage.repositories.raw_metrics_repo import RawMetricsRepo
from .storage.repositories.findings_repo import FindingsRepo
from .storage.repositories.baseline_repo import BaselineRepo
from .storage.repositories.dedup_repo import DedupRepo
from .storage.repositories.job_execution_repo import JobExecutionRepo
from .notifications.base_notifier import NotificationDispatcher
from .notifications.teams_notifier import TeamsNotifier

logger = logging.getLogger(__name__)


class Layer1Service:
    """
    Orchestrator chính.
    Đọc topics từ MongoDB → đăng ký 1 APScheduler job per topic → start.
    """

    def __init__(self) -> None:
        self._scheduler = BlockingScheduler(timezone="UTC")

        # Infrastructure — khởi tạo trong _setup()
        self._role_cache: NodeRoleCache = ...
        self._topic_runner: TopicRunner = ...
        self._job_runner: JobRunner = ...
        self._topic_repo: TopicRepo = ...

    def start(self) -> None:
        """Setup toàn bộ dependencies, register jobs, start scheduler."""
        ...

    def stop(self) -> None:
        """Graceful shutdown — gọi khi nhận SIGTERM/SIGINT."""
        ...

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
        ...

    def _register_jobs(self) -> None:
        """
        Đọc tất cả topics enabled từ MongoDB.
        Với mỗi topic → đăng ký 1 APScheduler interval job.

        Thêm 2 system jobs:
          - node_role_refresh: mỗi node_role_refresh_sec
          - health_check: mỗi 2 phút
        """
        ...

    def _make_topic_job(self, topic_id: str):
        """
        Tạo job function cho 1 topic.
        Wrapped bởi job_runner.wrap() để tracking execution.
        """
        ...


def _setup_logging() -> None: ...


def _setup_signal_handlers(service: Layer1Service) -> None: ...


def main() -> None:
    """Entry point."""
    _setup_logging()
    logger.info("Layer 1 Monitoring Service starting (config-driven)...")

    service = Layer1Service()

    _setup_signal_handlers(service)

    service.start()  # blocking


if __name__ == "__main__":
    main()
