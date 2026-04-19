"""
metrics.py — Models cho raw query results và execution results.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class QueryResult(BaseModel):
    """Kết quả 1 query execution trên 1 node."""

    topic_id: str
    query_id: str
    node: str
    role: str = Field(description="'primary' | 'secondary' — từ NodeRoleCache")
    rows: list[dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    executed_at: datetime = Field(default_factory=datetime.utcnow)
    duration_ms: float = 0.0
    success: bool = True
    error_message: str | None = None


class RawMetric(BaseModel):
    """Document ghi vào MongoDB `raw_metrics`."""

    topic_id: str
    query_id: str
    node: str
    role: str
    collected_at: datetime = Field(default_factory=datetime.utcnow)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    duration_ms: float = 0.0
