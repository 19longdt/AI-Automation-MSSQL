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


class FindingInstance(BaseModel):
    description: str
    action: Action | None = None


class FindingGroup(BaseModel):
    severity: Severity
    category: str
    type: str
    recommendation: str
    shared_action: Action | None = None
    instances: list[FindingInstance] = Field(default_factory=list)
    count: int = 0


class OperatorSummary(BaseModel):
    node_id: int
    physical_op: str
    logical_op: str
    op_type_tag: str = "OTHER"
    cost: float = 0.0
    cost_pct: float = 0.0
    estimated_rows: float = 0.0
    actual_rows: float | None = None
    actual_elapsed_ms: float | None = None
    actual_logical_reads: float | None = None
    actual_physical_reads: float | None = None
    read_ahead_reads: float | None = None
    scan_count: float | None = None
    has_row_est_off: bool = False
    has_spill: bool = False
    table_name: str | None = None
    index_name: str | None = None


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
    is_stale: bool = False


class IOStatSummary(BaseModel):
    node_id: int
    physical_op: str
    op_type_tag: str = "OTHER"
    table_name: str | None = None
    index_name: str | None = None
    logical_reads: int = 0
    physical_reads: int = 0
    read_ahead_reads: int = 0
    scan_count: int = 0


class JoinTypeSummary(BaseModel):
    join_type: str
    count: int = 0
    has_spill: bool = False


class IndexUsage(BaseModel):
    table: str
    index: str
    index_kind: str
    op_type: str
    is_partitioned: bool = False


class LookupQueries(BaseModel):
    plan_cache_sql: str
    query_store_sql: str


class CompilationInfo(BaseModel):
    ce_model_version: int = 0
    dop: int = 0
    non_parallel_reason: str | None = None
    compile_cpu_ms: int = 0
    compile_memory_kb: int = 0
    cached_plan_size_kb: int = 0
    optm_level: str | None = None
    early_abort_reason: str | None = None
    query_hash: str | None = None
    query_plan_hash: str | None = None
    lookup_queries: LookupQueries | None = None


class StatementResult(BaseModel):
    statement_text: str
    statement_text_truncated: bool = False
    statement_type: str
    total_cost: float
    elapsed_ms: int | None = None
    cpu_ms: int | None = None
    dop: int
    has_actual_stats: bool
    ce_model_version: int
    optm_level: str | None = None
    query_hash: str | None = None
    query_plan_hash: str | None = None
    finding_groups: list[FindingGroup] = Field(default_factory=list)
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
    join_types: list[JoinTypeSummary] = Field(default_factory=list)
    indexes_used: list[IndexUsage] = Field(default_factory=list)
    compilation: CompilationInfo | None = None


class PlanAnalysisResult(BaseModel):
    statements: list[StatementResult]
    total_findings: int
    critical_count: int
    warning_count: int
    has_actual_stats: bool
    analyzed_at: datetime
    analysis_duration_ms: int
