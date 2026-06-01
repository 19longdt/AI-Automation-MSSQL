from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

from ..plan.models.result import FindingGroup
from .types import AnalysisType

TInput = TypeVar("TInput")


class ToolSnapshot(BaseModel):
    """Per-tool analysis result.

    Layer 1 stores this in finding_diagnostics.results[tool_id].
    AI Agent reads findings + signals để cross-tool synthesis.

    Envelope fields (status, duration_ms, row_count, error) tương thích với
    format cũ Layer 1 đang dùng — Layer 1 không cần thay đổi storage logic.
    """

    status: str = "ok"
    duration_ms: float = 0.0
    row_count: int = 0
    error: str | None = None

    # AI-ready — thay thế raw rows
    findings: list[FindingGroup] = Field(default_factory=list)
    signals: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""
    recommendations: list[str] = Field(default_factory=list)

    @classmethod
    def from_error(cls, error: str, duration_ms: float = 0.0) -> "ToolSnapshot":
        return cls(status="error", error=error, duration_ms=duration_ms)


class AnalysisOutput(BaseModel):
    """Full output cho Layer 3 UI.

    tool_snapshot: AI-ready layer — Layer 1 có thể extract field này
    analyzed_at / analysis_duration_ms: metadata chung
    """

    analysis_type: AnalysisType
    tool_snapshot: ToolSnapshot
    analyzed_at: datetime
    analysis_duration_ms: int


class AnalysisPipeline(ABC, Generic[TInput]):
    """Base class cho mọi analysis pipeline.

    Mỗi loại phân tích implement pipeline riêng:
      - run() → AnalysisOutput (full, for UI)
      - tool_snapshot bên trong output là format Layer 1 stores

    Thêm loại phân tích mới = tạo pipeline mới + đăng ký vào PipelineRegistry.
    """

    @property
    @abstractmethod
    def analysis_type(self) -> AnalysisType: ...

    @abstractmethod
    def run(self, input_data: TInput) -> AnalysisOutput: ...
