from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field

from ..infra.time_utils import now_vn


class CampaignStatus(str, Enum):
    PENDING = "pending"
    DISCOVERING = "discovering"
    DISCOVERY_FAILED = "discovery_failed"
    ACTIVE = "active"
    COMPLETED = "completed"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class MaintenanceCampaign(BaseModel):
    cluster_id: str
    campaign_id: str = Field(default_factory=lambda: uuid4().hex[:8])
    name: str
    description: str | None = None
    status: CampaignStatus = CampaignStatus.PENDING
    discovery_error: str | None = None
    start_date: datetime
    end_date: datetime
    scan_times: list[str] = Field(default_factory=lambda: ["20:00"])
    discovery_started_at: datetime | None = None
    discovery_finished_at: datetime | None = None
    last_scan_triggered_at: datetime | None = None
    total_items: int = 0
    done_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    created_at: datetime = Field(default_factory=now_vn)
    updated_at: datetime = Field(default_factory=now_vn)
