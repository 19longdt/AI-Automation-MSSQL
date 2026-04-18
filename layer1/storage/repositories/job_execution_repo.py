"""job_execution_repo.py — Tracking lịch sử mỗi lần job chạy."""
from __future__ import annotations

import logging
from datetime import datetime

from ..mongo_client import MongoConnection
from ...models.job import JobExecution, JobStatus

logger = logging.getLogger(__name__)

COLLECTION = "job_executions"


class JobExecutionRepo:

    @property
    def collection(self): ...

    def start(self, execution: JobExecution) -> str:
        """Insert record với status=RUNNING, trả về _id để update sau."""
        ...

    def finish(self, doc_id: str, status: JobStatus, findings_created: int, error: str | None = None) -> None:
        """Update record khi job hoàn thành — set finished_at, duration_ms, status."""
        ...

    def get_latest_per_job(self) -> list[dict]:
        """Trả về record mới nhất của mỗi job — dùng cho health dashboard."""
        ...

    def find_stuck_jobs(self, timeout_sec: int) -> list[dict]:
        """Tìm jobs có status=RUNNING và started_at quá lâu → stuck."""
        ...

    def find_missed_jobs(self, job_intervals: dict[str, int]) -> list[str]:
        """
        So sánh thời gian run cuối với interval expected.
        Trả về list job_name bị missed (chưa chạy đúng schedule).
        """
        ...
