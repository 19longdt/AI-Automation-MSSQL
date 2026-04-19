"""
health_checker.py — Phát hiện stuck/missed jobs và alert.

Chạy như 1 job riêng trong scheduler (mỗi 2 phút), kiểm tra:
  - Stuck jobs: status=RUNNING quá lâu so với stuck_timeout_sec
  - Missed jobs: khoảng cách giữa 2 lần chạy > interval × 1.5
  - MongoDB health: ping check
"""
from __future__ import annotations

import logging

from ..storage.repositories.job_execution_repo import JobExecutionRepo
from ..storage.mongo_client import MongoConnection

logger = logging.getLogger(__name__)


class HealthChecker:

    def __init__(self, execution_repo: JobExecutionRepo, job_intervals: dict[str, int]) -> None:
        self._repo = execution_repo
        # job_intervals: {job_name: interval_sec} — để tính expected_next_run
        self._job_intervals = job_intervals

    def run_check(self) -> list[str]:
        """
        Chạy tất cả health checks, trả về list issue messages.
        Mỗi issue cần gửi alert qua notification channel.
        """
        ...

    def _check_stuck_jobs(self) -> list[str]: ...

    def _check_missed_jobs(self) -> list[str]: ...

    def _check_mongodb_health(self) -> list[str]: ...

    def get_dashboard_data(self) -> list[dict]:
        """Trả về data cho health dashboard — latest run per job."""
        ...
