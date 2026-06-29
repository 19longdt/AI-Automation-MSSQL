"""
history.py — Audit log mỗi lần thực thi/skip action.

`maintenance_history` là nguồn context cho Layer 2 AI agent
("lần rebuild trước có giúp không?") — TTL dài 90 ngày.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field

from ..infra.time_utils import now_vn
from .work_item import ActionType, WorkItemStatus


class MaintenanceOutcome(str, Enum):
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
    PAUSED = "paused"
    ABORTED = "aborted"
    DRY_RUN = "dry_run"


class MaintenanceHistory(BaseModel):
    """1 document trong `maintenance_history`."""

    cluster_id: str
    campaign_id: str | None = None
    history_id: str = Field(default_factory=lambda: str(uuid4()))
    item_id: str
    batch_id: str
    node: str

    database_name: str
    schema_name: str
    table_name: str
    index_name: str | None = None
    stats_name: str | None = None
    partition_number: int | None = None
    action_type: ActionType
    previous_status: WorkItemStatus | None = None
    final_status: WorkItemStatus | None = None
    attempt_no: int = 0

    # T-SQL chính xác đã chạy (hoặc sẽ chạy nếu dry_run) — audit + AI context
    statement: str = ""
    outcome: MaintenanceOutcome

    frag_before_pct: float | None = None
    frag_after_pct: float | None = None
    duration_ms: float | None = None

    skip_reason: str | None = None
    error: str | None = None

    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime = Field(default_factory=now_vn)
