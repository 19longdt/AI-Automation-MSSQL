"""capture_tool.py - Pydantic models for capture_tool_defs collection."""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ExecutionType(str, Enum):
    """Runtime type for each capture tool definition."""

    SQL = "sql"
    STATIC = "static"
    MONGO = "mongo"


class CaptureToolParams(BaseModel):
    # Query cần query_hash (binary) từ finding để bind parameter.
    needs_query_hash: bool = False
    # Query cần table name từ Phase 2 affected tables.
    needs_table_name: bool = False
    # Tool gồm nhiều SQL parts, thực thi tuần tự trong cùng connection.
    is_multi_query: bool = False


class AiHints(BaseModel):
    # Cột ưu tiên hiển thị khi Layer 2 summarize snapshot cho AI.
    key_columns: list[str] = Field(default_factory=list)
    # Giới hạn số rows đưa vào prompt để tránh context phình to.
    max_rows_for_ai: int = 5
    # Mô tả cách diễn giải kết quả (guidance cho LLM).
    interpret_as: str = ""
    # Ngưỡng cảnh báo/critical theo từng metric.
    thresholds: dict[str, Any] = Field(default_factory=dict)


class CaptureToolDef(BaseModel):
    # ID định danh duy nhất của tool trong capture_tool_defs.
    tool_id: str
    display_name: str = ""
    description: str = ""
    # Điều khiển routing: SQL (Phase 1/3), STATIC (Phase 2), MONGO (Phase 4).
    execution_type: ExecutionType = ExecutionType.SQL
    # SQL đơn (không dùng khi is_multi_query=True).
    sql: str | None = None
    # Tập SQL parts cho tool multi-query, ví dụ get_memory_pressure.
    sql_parts: dict[str, str] | None = None
    params: CaptureToolParams = Field(default_factory=CaptureToolParams)
    # Phase thực thi tuần tự trong pipeline capture.
    phase: int = 1
    timeout_sec: int = 10
    enabled: bool = True
    ai_hints: AiHints = Field(default_factory=AiHints)
