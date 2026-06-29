from __future__ import annotations

import re
from datetime import datetime
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator

from ..infra.time_utils import now_vn
from .thresholds import CampaignThresholds

_HH_MM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class CampaignStatus(str, Enum):
    PENDING = "pending"
    DISCOVERING = "discovering"
    DISCOVERY_FAILED = "discovery_failed"
    ACTIVE = "active"
    COMPLETED = "completed"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ExecutionType(str, Enum):
    INDEX = "index"
    STATISTIC = "statistic"
    HEAP = "heap"


class CampaignScopeTable(BaseModel):
    schema_name: str
    table_names: list[str] = Field(default_factory=list)

    @field_validator("schema_name")
    @classmethod
    def schema_name_not_empty(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("schema_name cannot be empty")
        return text

    @field_validator("table_names")
    @classmethod
    def table_names_strip(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item.strip()]


class CampaignScopeDatabase(BaseModel):
    database_name: str
    schemas: list[CampaignScopeTable] = Field(min_length=1)

    @field_validator("database_name")
    @classmethod
    def database_name_not_empty(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("database_name cannot be empty")
        return text


class CampaignWindowOverride(BaseModel):
    start: str
    end: str
    time_budget_minutes: int = Field(ge=30, le=1440)

    @field_validator("start", "end")
    @classmethod
    def must_be_hhmm(cls, value: str) -> str:
        text = value.strip()
        if not _HH_MM_RE.match(text):
            raise ValueError(f"Must be HH:MM format, got: {value!r}")
        return text

    @model_validator(mode="after")
    def start_not_equal_end(self) -> "CampaignWindowOverride":
        if self.start == self.end:
            raise ValueError("start and end cannot be identical")
        return self


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
    scope: list[CampaignScopeDatabase] | None = None
    # Ngưỡng quyết định cho campaign này, nhóm theo execution type; None = kế thừa default policy.
    thresholds: CampaignThresholds | None = None
    window_override: CampaignWindowOverride | None = None
    execution_types: list[ExecutionType] = Field(
        default_factory=lambda: [ExecutionType.INDEX, ExecutionType.STATISTIC, ExecutionType.HEAP],
        min_length=1,
    )
    discovery_started_at: datetime | None = None
    discovery_finished_at: datetime | None = None
    last_scan_triggered_at: datetime | None = None
    # run_id catalog mới nhất per-database mà campaign đã discover → phát hiện capture mới
    discovered_run_ids: dict[str, str] = Field(default_factory=dict)
    total_items: int = 0
    done_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    window_budget_used_minutes: float = 0.0
    created_at: datetime = Field(default_factory=now_vn)
    updated_at: datetime = Field(default_factory=now_vn)
