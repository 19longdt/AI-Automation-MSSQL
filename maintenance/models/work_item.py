"""
work_item.py — Work item trong maintenance_queue.

Lifecycle:
  awaiting_approval → approved → running → done / failed / paused
                    → rejected / expired
  running → approved (gate fail / release khi process restart)
  paused  → running (RESUME resumable rebuild ở tick sau)

terminal_at CHỈ set khi vào trạng thái terminal — là TTL anchor.
Item active không có terminal_at → sống qua nhiều ngày (multi-day backlog).
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from ..infra.time_utils import now_vn


class ItemKind(str, Enum):
    INDEX_FRAG = "index_frag"
    STATS_STALE = "stats_stale"
    HEAP_FORWARDED = "heap_forwarded"


class ActionType(str, Enum):
    REORGANIZE = "reorganize"
    REBUILD = "rebuild"
    REBUILD_PARTITION = "rebuild_partition"
    UPDATE_STATISTICS = "update_statistics"
    HEAP_REBUILD = "heap_rebuild"


class WorkItemStatus(str, Enum):
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    RUNNING = "running"
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
    EXPIRED = "expired"
    # Capture mới supersede item chưa execute của capture cũ
    SUPERSEDED = "superseded"


# Trạng thái terminal — set terminal_at để TTL dọn dẹp
TERMINAL_STATUSES = {
    WorkItemStatus.REJECTED,
    WorkItemStatus.DONE,
    WorkItemStatus.FAILED,
    WorkItemStatus.SKIPPED,
    WorkItemStatus.EXPIRED,
    WorkItemStatus.SUPERSEDED,
}

# Trạng thái "open" — dùng dedupe khi scan (không enqueue trùng object)
OPEN_STATUSES = {
    WorkItemStatus.AWAITING_APPROVAL,
    WorkItemStatus.APPROVED,
    WorkItemStatus.RUNNING,
    WorkItemStatus.PAUSED,
}


class WorkItemMetrics(BaseModel):
    """Snapshot metrics tại thời điểm scan — căn cứ quyết định action."""

    fragmentation_pct: float | None = None
    page_count: int | None = None
    record_count: int | None = None
    forwarded_record_count: int | None = None
    modification_counter: int | None = None
    rows: int | None = None
    rows_sampled: int | None = None
    last_updated: datetime | None = None


class WorkItem(BaseModel):
    """1 document trong `maintenance_queue`."""

    cluster_id: str
    campaign_id: str | None = None
    item_id: str = Field(default_factory=lambda: str(uuid4()))
    short_id: str = ""  # 8 ký tự đầu của item_id — dùng cho Telegram callback (64-byte limit)
    batch_id: str
    kind: ItemKind
    action_type: ActionType

    # ── Object identity ──────────────────────────────────────────────────────
    database_name: str
    schema_name: str
    table_name: str
    index_name: str | None = None  # None với stats-only / heap
    stats_name: str | None = None
    partition_number: int | None = None  # None = toàn index
    object_id: int
    index_id: int | None = None

    metrics: WorkItemMetrics = Field(default_factory=WorkItemMetrics)
    estimated_minutes: float = 1.0
    priority: int = 0

    status: WorkItemStatus = WorkItemStatus.AWAITING_APPROVAL
    approval: dict[str, Any] | None = None  # {decided_by, decided_at, decision}
    attempts: int = 0
    last_error: str | None = None
    # True = REBUILD resumable đã PAUSE trên server — tick sau RESUME thay vì chạy mới
    resume_token: bool = False

    created_at: datetime = Field(default_factory=now_vn)
    updated_at: datetime = Field(default_factory=now_vn)
    terminal_at: datetime | None = None

    @model_validator(mode="after")
    def derive_short_id(self) -> "WorkItem":
        if not self.short_id:
            self.short_id = self.item_id[:8]
        return self

    def object_label(self) -> str:
        """Label hiển thị: dbo.Bill.IX_Bill_Date / dbo.Bill (stats: ST_x) / partition."""
        base = f"{self.schema_name}.{self.table_name}"
        if self.index_name:
            base = f"{base}.{self.index_name}"
        if self.stats_name:
            base = f"{base} (stats: {self.stats_name})"
        if self.partition_number is not None:
            base = f"{base} [p{self.partition_number}]"
        return base

    def dedupe_key(self) -> tuple:
        """Key chống enqueue trùng object đang còn open trong queue."""
        return (
            self.cluster_id,
            self.schema_name,
            self.table_name,
            self.index_name,
            self.stats_name,
            self.partition_number,
            self.kind.value,
        )
