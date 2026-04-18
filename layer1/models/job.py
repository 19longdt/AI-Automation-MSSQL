"""
job.py — Models cho job execution tracking và leader election.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    """Trạng thái của 1 lần job chạy.

    RUNNING: job đang thực thi — nếu kéo dài quá job_stuck_timeout_sec → stuck alert.
    SKIPPED: instance là Standby — không chạy job nhưng ghi lại để health dashboard.
    """

    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


class JobExecution(BaseModel):
    """Record của 1 lần job chạy, ghi vào MongoDB `job_executions`."""

    job_name: str
    instance_id: str = Field(description="hostname:pid của instance thực thi")
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None
    duration_ms: float = 0.0
    status: JobStatus = JobStatus.RUNNING
    records_processed: int = 0
    findings_created: int = 0
    error_message: str | None = None

    # Dùng để phát hiện missed schedule
    next_expected_at: datetime | None = None


class LeaderInfo(BaseModel):
    """Document lưu trong MongoDB `cluster_leader` — singleton."""

    # singleton_key luôn là "leader" — dùng unique index để enforce 1 document
    singleton_key: str = "leader"
    leader_id: str = Field(description="hostname:pid")
    leader_host: str
    elected_at: datetime
    heartbeat_at: datetime
    # expires_at có TTL index = 30s — tự xóa nếu leader crash không update heartbeat
    expires_at: datetime
