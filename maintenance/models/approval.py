"""
approval.py — Batch approval models.

Mỗi lần scan tạo 1 batch. DBA duyệt qua Telegram (Approve ALL / per-item).
Batch chưa quyết quá hạn → expired, items không bao giờ chạy.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field

from ..infra.time_utils import now_vn


class BatchStatus(str, Enum):
    AWAITING_APPROVAL = "awaiting_approval"
    DECIDED = "decided"
    EXPIRED = "expired"


class ApprovalInfo(BaseModel):
    """Quyết định duyệt — embed vào WorkItem.approval / MaintenanceBatch."""

    decided_by: str
    decided_at: datetime = Field(default_factory=now_vn)
    decision: str  # "approved" | "rejected"


class BatchSummary(BaseModel):
    """Đếm theo action_type + tổng est — hiển thị trong Telegram message."""

    reorganize: int = 0
    rebuild: int = 0
    rebuild_partition: int = 0
    update_statistics: int = 0
    heap_rebuild: int = 0
    est_total_minutes: float = 0.0


class MaintenanceBatch(BaseModel):
    """1 document trong `maintenance_batches`."""

    batch_id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=now_vn)
    item_count: int = 0
    summary: BatchSummary = Field(default_factory=BatchSummary)

    status: BatchStatus = BatchStatus.AWAITING_APPROVAL
    decided_by: str | None = None
    decided_at: datetime | None = None
    decision: str | None = None  # "all" | "reject" | "partial"

    # message_id của batch message trên Telegram — để edit/reference sau này
    telegram_message_id: int | None = None
