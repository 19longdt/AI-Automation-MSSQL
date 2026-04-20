"""
findings.py — Model cho detected issues (output của detectors).

Finding được ghi vào MongoDB `findings` và là input cho Layer 2 AI agent.
Schema được thiết kế để AI có đủ context mà không cần query thêm MongoDB.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from ..utils.time_utils import now_vn
from .common import IssueType, Severity


class Finding(BaseModel):
    """Một issue được phát hiện bởi detector."""

    finding_id: str = Field(default_factory=lambda: str(uuid4()))
    detected_at: datetime = Field(default_factory=now_vn)

    topic_id: str = Field(description="ID của monitor topic sinh ra finding này")
    issue_type: IssueType
    severity: Severity
    node: str = Field(description="Hostname của node phát sinh issue")
    role: str = Field(default="", description="'primary' | 'secondary' — từ NodeRoleCache")

    # Query-related fields (None nếu không liên quan đến query)
    query_hash: str | None = None
    query_text: str | None = None

    # Metrics snapshot tại thời điểm phát hiện
    metrics: dict[str, Any] = Field(default_factory=dict)

    # Patterns phát hiện từ XML plan parser (nếu có)
    plan_patterns: list[str] = Field(default_factory=list)

    # Reference đến plan XML file (lưu riêng do kích thước lớn)
    plan_xml_ref: str | None = None

    # Lifecycle tracking
    status: str = Field(
        default="new",
        description="new | analyzing | analyzed | resolved | suppressed",
    )
    ai_analysis_id: str | None = None

    # Alert delivery tracking — DBA query collection để biết finding nào miss alert.
    # KHÔNG ràng buộc retry; chỉ track outcome một lần.
    alert_status: str = Field(
        default="pending",
        description="pending | sent | failed | suppressed | skipped_severity | skipped_no_dispatcher",
    )
    alert_sent_at: datetime | None = None
    alert_error: str | None = Field(
        default=None,
        description="Error message khi alert_status=failed; partial errors khi 'sent'",
    )

    def finding_hash(self) -> str:
        """Hash dùng cho dedup_cache — cùng topic + issue_type + node + query_hash
        trong window ngắn sẽ không gửi alert trùng.
        topic_id được include để tránh collision giữa các topic khác nhau
        có cùng issue_type trên cùng node."""
        import hashlib
        key = f"{self.topic_id}:{self.issue_type}:{self.node}:{self.query_hash or ''}"
        return hashlib.md5(key.encode()).hexdigest()
