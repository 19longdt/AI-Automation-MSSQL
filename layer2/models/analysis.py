"""
analysis.py — Models cho AI analysis request và result.

AnalysisResult lưu vào MongoDB `ai_analyses` collection.
ToolCallRecord track từng tool call trong agentic loop để debug và audit.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from ..utils.time_utils import now_vn


class AnalysisStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


class ActionType(str, Enum):
    QUERY_FIX = "query_fix"
    INDEX_CHANGE = "index_change"
    STATISTICS_UPDATE = "statistics_update"
    ARCHITECTURE = "architecture"
    MAINTENANCE = "maintenance"
    CONFIGURATION = "configuration"


class InsightAction(BaseModel):
    """1 action item được extract từ phân tích."""

    type: ActionType
    description: str
    priority: str = Field(description="high | medium | low")
    effort: str = Field(description="low | medium | high")
    resolved: bool = False
    resolved_at: datetime | None = None


class ToolCallRecord(BaseModel):
    """Ghi lại 1 tool call trong agentic loop."""

    tool_name: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: Any = None
    duration_ms: int | None = None
    error: str | None = None


class AnalysisRequest(BaseModel):
    """Request trigger analysis — từ Telegram bot hoặc API."""

    finding_id: str
    channel: str = Field(default="api", description="'telegram' | 'api'")
    telegram_message_id: int | None = Field(
        default=None,
        description="message_id của alert message — dùng để track multi-turn session",
    )
    telegram_chat_id: str | None = Field(
        default=None,
        description="Chat ID để Layer 2 bot gửi kết quả trực tiếp (khi gọi từ Layer 1).",
    )
    requested_by: str | None = None
    follow_up_text: str | None = Field(
        default=None,
        description="Câu hỏi follow-up từ DBA trong multi-turn session. "
                    "None = fresh analysis từ finding.",
    )


class AnalysisResult(BaseModel):
    """Kết quả analysis đầy đủ — lưu vào MongoDB `ai_analyses`."""

    analysis_id: str = Field(default_factory=lambda: str(uuid4()))
    finding_id: str
    finding_snapshot: dict[str, Any] = Field(
        default_factory=dict,
        description="Snapshot của Finding tại thời điểm analyze — giữ lại context dù finding bị xóa",
    )
    skill_id: str = ""

    status: AnalysisStatus = AnalysisStatus.PENDING
    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    analysis_text: str = ""

    # Claude API token usage — để monitor cost và verify prompt cache hit
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    cost_usd: float = 0.0
    total_duration_ms: int | None = None

    # Fields từ orchestrator sau analysis
    model: str = Field(default="", description="Claude model đã dùng (e.g. claude-sonnet-4-6)")
    root_cause_summary: str = Field(default="", description="Tóm tắt nguyên nhân từ InsightData")
    top_actions: list[str] = Field(
        default_factory=list,
        description="Top 2 high-priority action descriptions từ InsightData",
    )

    started_at: datetime = Field(default_factory=now_vn)
    completed_at: datetime | None = None
    error: str | None = None


class InsightData(BaseModel):
    """Structured insight extracted từ analysis_text bởi orchestrator.

    Claude embed block <insight>JSON</insight> trong response.
    Orchestrator parse, strip khỏi analysis_text trước khi gửi DBA,
    rồi upsert vào MongoDB `issue_insights`.
    """

    root_cause_category: str
    root_cause_summary: str
    affected_tables: list[str] = Field(default_factory=list)
    affected_indexes: list[str] = Field(default_factory=list)
    affected_queries: list[str] = Field(default_factory=list)
    actions: list[InsightAction] = Field(default_factory=list)
    systemic: bool = False
