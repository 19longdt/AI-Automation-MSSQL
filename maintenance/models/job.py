"""
job.py — Models cho job execution tracking.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from ..infra.time_utils import now_vn


class JobStatus(str, Enum):
    """Trạng thái của 1 lần job chạy.

    RUNNING: job đang thực thi — nếu kéo dài quá stuck_timeout_sec → stuck alert.
    """

    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class JobExecution(BaseModel):
    """Record của 1 lần job chạy, ghi vào MongoDB `job_executions`."""

    job_name: str
    instance_id: str = Field(description="hostname:pid của instance thực thi")
    started_at: datetime = Field(default_factory=now_vn)
    finished_at: datetime | None = None
    duration_ms: float = 0.0
    status: JobStatus = JobStatus.RUNNING
    records_processed: int = 0
    findings_created: int = 0
    error_message: str | None = None

    # Trace ID — correlate với log lines trong cùng lần chạy
    trace_id: str | None = None

    # Dùng để phát hiện missed schedule
    next_expected_at: datetime | None = None


