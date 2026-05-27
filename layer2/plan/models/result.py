from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Severity(str, Enum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class Action(BaseModel):
    type: str
    description: str
    ddl: str | None = None


class Finding(BaseModel):
    severity: Severity
    category: str
    type: str
    description: str
    recommendation: str
    action: Action | None = None


class OperatorSummary(BaseModel):
    node_id: int
    physical_op: str
    logical_op: str
    cost_pct: float = 0.0
    estimated_rows: float = 0.0
    actual_rows: float | None = None
    actual_elapsed_ms: float | None = None
    actual_logical_reads: float | None = None


class IndexSuggestion(BaseModel):
    table: str
    impact: float
    equality_columns: list[str] = Field(default_factory=list)
    inequality_columns: list[str] = Field(default_factory=list)
    include_columns: list[str] = Field(default_factory=list)
    create_statement: str | None = None


class MemoryGrantSummary(BaseModel):
    requested_kb: int = 0
    granted_kb: int = 0
    max_used_kb: int | None = None
    grant_wait_ms: int = 0


class ParameterInfo(BaseModel):
    name: str
    data_type: str | None = None
    compiled_value: str | None = None
    runtime_value: str | None = None


class WaitStatSummary(BaseModel):
    type: str
    ms: int
    count: int
    category: str


class StatsSummary(BaseModel):
    table: str
    statistic: str
    modification_count: int | None = None
    sampling_percent: float | None = None
    last_update: str | None = None


class IOStatSummary(BaseModel):
    table: str
    logical_reads: int


class StatementResult(BaseModel):
    statement_text: str
    statement_type: str
    total_cost: float
    dop: int
    has_actual_stats: bool
    ce_model_version: int
    query_hash: str | None = None
    query_plan_hash: str | None = None
    findings: list[Finding] = Field(default_factory=list)
    critical_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    top_operators: list[OperatorSummary] = Field(default_factory=list)
    missing_indexes: list[IndexSuggestion] = Field(default_factory=list)
    memory_grant: MemoryGrantSummary | None = None
    parameters: list[ParameterInfo] = Field(default_factory=list)
    wait_stats: list[WaitStatSummary] = Field(default_factory=list)
    statistics: list[StatsSummary] = Field(default_factory=list)
    io_stats: list[IOStatSummary] = Field(default_factory=list)


class PlanAnalysisResult(BaseModel):
    statements: list[StatementResult]
    total_findings: int
    critical_count: int
    warning_count: int
    has_actual_stats: bool
    analyzed_at: datetime
    analysis_duration_ms: int
