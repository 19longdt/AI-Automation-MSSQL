"""
Finding model persisted to MongoDB and consumed by Layer 2 analysis.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from ..utils.time_utils import now_vn
from .common import AlertStatus, IssueType, Severity


class Finding(BaseModel):
    finding_id: str = Field(default_factory=lambda: str(uuid4()))
    detected_at: datetime = Field(default_factory=now_vn)

    topic_id: str = Field(description="Monitor topic ID that produced this finding")
    cluster_id: str = Field(default="", description="MSSQL cluster ID that produced this finding")
    issue_type: IssueType
    severity: Severity
    node: str = Field(description="Node host that produced the issue")
    role: str = Field(default="", description="'primary' | 'secondary' from NodeRoleCache")

    query_hash: str | None = None
    query_text: str | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    plan_patterns: list[str] = Field(default_factory=list)
    plan_xml_ref: str | None = None

    status: str = Field(default="new", description="new | analyzing | analyzed | resolved | suppressed")
    ai_analysis_id: str | None = None

    alert_status: AlertStatus = Field(default=AlertStatus.PENDING)
    alert_sent_at: datetime | None = None
    alert_error: str | None = None
    has_diagnostics: bool = False
    finding_hash: str = Field(default="")

    def compute_finding_hash(self) -> str:
        import hashlib

        key = f"{self.topic_id}:{self.cluster_id}:{self.issue_type}:{self.node}:{self.query_hash or ''}"
        return hashlib.md5(key.encode()).hexdigest()
