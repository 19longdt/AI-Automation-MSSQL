"""
Models for raw query results and persisted raw metrics.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from ..utils.time_utils import now_vn


class QueryResult(BaseModel):
    topic_id: str
    cluster_id: str = ""
    query_id: str
    node: str
    role: str = Field(description="'primary' | 'secondary' from NodeRoleCache")
    rows: list[dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    executed_at: datetime = Field(default_factory=now_vn)
    duration_ms: float = 0.0
    success: bool = True
    error_message: str | None = None


class RawMetric(BaseModel):
    cluster_id: str = ""
    topic_id: str
    query_id: str
    node: str
    role: str
    collected_at: datetime = Field(default_factory=now_vn)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    duration_ms: float = 0.0
