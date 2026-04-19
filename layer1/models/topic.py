"""
topic.py — Pydantic models cho monitor_topics config từ MongoDB.

Mỗi topic là 1 nhóm monitoring độc lập (AG, Blocking, TempDB, Index...).
SQL queries và thresholds được cấu hình hoàn toàn trong MongoDB —
Python app chỉ là generic executor, không hardcode query nào.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class QueryConfig(BaseModel):
    """1 SQL query trong 1 topic."""

    query_id: str = Field(description="ID duy nhất trong topic, ví dụ: 'ag_sync_state'")
    description: str = Field(default="")
    sql: str = Field(description="SQL query đầy đủ — bắt buộc có TOP N hoặc WHERE thời gian")
    timeout_sec: int = Field(default=30)


class ThresholdConfig(BaseModel):
    """Cấu hình cho detector_type='threshold'."""

    warning: float
    critical: float


class BaselineConfig(BaseModel):
    """Cấu hình cho detector_type='baseline' (day-of-week aware)."""

    metric_field: str = Field(description="Tên field trong query result để so sánh, ví dụ: 'avg_duration_ms'")
    threshold_pct: float = Field(default=50.0, description="% tăng so với baseline → flag")
    min_executions: int = Field(default=10, description="Bỏ qua query ít chạy")
    baseline_weeks: int = Field(default=4, description="Số tuần lịch sử để tính baseline")


class AnalysisConfig(BaseModel):
    """Config cho AI analysis khi user gọi /analyze trên Telegram."""

    context: str = Field(
        description="Mô tả topic cho Claude — ngữ cảnh để Claude hiểu đang phân tích cái gì"
    )
    include_fields: list[str] = Field(
        default_factory=list,
        description="Field lớn trong finding.metrics cần đính kèm (sql_text, xml_query_plan...)",
    )
    focus_metrics: list[str] = Field(
        default_factory=list,
        description="Metric cần highlight trong phân tích — subset của metrics",
    )


class MonitorTopic(BaseModel):
    """
    1 topic monitoring đọc từ MongoDB `monitor_topics`.
    Mỗi topic = 1 APScheduler job chạy theo schedule_sec.
    """

    topic_id: str = Field(description="Unique ID, ví dụ: 'ag_health', 'blocking'")
    display_name: str = Field(default="")
    enabled: bool = Field(default=True)
    schedule_sec: int = Field(description="Interval giữa các lần chạy (giây)")

    # "primary" | "secondary" | "all" | hostname cụ thể
    nodes: list[str] = Field(description="Danh sách node targets — resolve qua NodeRoleCache")

    queries: list[QueryConfig] = Field(default_factory=list)

    # Detector config (optional — null = chỉ lưu raw results)
    detector_type: str | None = Field(
        default=None,
        description="null | 'threshold' | 'baseline' | 'plan_analysis' | 'blocking_chain'",
    )
    thresholds: dict[str, ThresholdConfig] = Field(default_factory=dict)
    baseline_config: BaselineConfig | None = None

    # Metadata
    extra: dict[str, Any] = Field(
        default_factory=dict,
        description="Config bổ sung cho detector-specific logic",
    )

    # AI analysis config (optional) — dùng khi user gọi /analyze trên Telegram
    analysis_config: AnalysisConfig | None = None
