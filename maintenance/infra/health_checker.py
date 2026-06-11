"""
health_checker.py — Phát hiện stuck/missed jobs và alert.

Chạy như 1 job riêng trong scheduler (mỗi 2 phút), kiểm tra:
  - Stuck jobs: status=RUNNING quá lâu so với stuck_timeout_sec
  - Missed jobs: khoảng cách giữa 2 lần chạy > interval × 1.5
  - MongoDB health: ping check
"""
from __future__ import annotations

import logging

from .job_execution_repo import JobExecutionRepo
from .mongo_client import MongoConnection

logger = logging.getLogger(__name__)

# Job bị coi là stuck nếu status=RUNNING quá thời gian này
_STUCK_TIMEOUT_SEC = 300


class HealthChecker:

    def __init__(
        self, execution_repo: JobExecutionRepo, job_intervals: dict[str, int]
    ) -> None:
        self._repo = execution_repo
        # job_intervals: {job_name: interval_sec} — để tính expected_next_run
        self._job_intervals = job_intervals

    def run_check(self) -> list[str]:
        """
        Chạy tất cả health checks, trả về list issue messages.
        Mỗi issue cần gửi alert qua notification channel.
        """
        issues: list[str] = []
        issues.extend(self._check_stuck_jobs())
        issues.extend(self._check_missed_jobs())
        issues.extend(self._check_mongodb_health())
        if issues:
            logger.warning("Health issues detected: %s", issues)
        return issues

    def _check_stuck_jobs(self) -> list[str]:
        stuck = self._repo.find_stuck_jobs(_STUCK_TIMEOUT_SEC)
        return [
            f"STUCK job '{doc['job_name']}' running since {doc['started_at'].isoformat()}"
            for doc in stuck
        ]

    def _check_missed_jobs(self) -> list[str]:
        missed = self._repo.find_missed_jobs(self._job_intervals)
        return [f"MISSED schedule: '{name}'" for name in missed]

    def _check_mongodb_health(self) -> list[str]:
        if not MongoConnection.ping():
            return ["MongoDB ping failed — connection may be lost"]
        return []

    def get_dashboard_data(self) -> list[dict]:
        """Trả về data cho health dashboard — latest run per job."""
        return self._repo.get_latest_per_job()
