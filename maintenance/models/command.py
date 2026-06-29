from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field

from ..infra.time_utils import now_vn
from .catalog import CatalogScopeDatabase


class MaintenanceCommandType(str, Enum):
    RUN_CATALOG = "run_catalog"
    RUN_DISCOVERY = "run_discovery"


class MaintenanceCommandStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class MaintenanceCommand(BaseModel):
    command_id: str = Field(default_factory=lambda: uuid4().hex[:12])
    cluster_id: str
    type: MaintenanceCommandType
    catalog_scope: list[CatalogScopeDatabase] | None = None
    status: MaintenanceCommandStatus = MaintenanceCommandStatus.PENDING
    requested_at: datetime = Field(default_factory=now_vn)
    claimed_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
