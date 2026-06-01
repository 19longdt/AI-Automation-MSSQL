from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field


class NodeWarning(BaseModel):
    name: str
    attributes: dict[str, str] = Field(default_factory=dict)


class PerThreadStat(BaseModel):
    thread: int = 0
    actual_rows: float = 0.0
    actual_elapsed_ms: float = 0.0
    actual_logical_reads: float = 0.0


class MemoryGrant(BaseModel):
    requested_kb: int = 0
    granted_kb: int = 0
    max_used_kb: int | None = None
    grant_wait_ms: int = 0


class PlanParameter(BaseModel):
    name: str
    data_type: str | None = None
    compiled_value: str | None = None
    runtime_value: str | None = None


class MissingIndex(BaseModel):
    database: str = ""
    schema_name: str = ""
    table: str = ""
    impact: float = 0.0
    equality_columns: list[str] = Field(default_factory=list)
    inequality_columns: list[str] = Field(default_factory=list)
    include_columns: list[str] = Field(default_factory=list)


class StatsUsageItem(BaseModel):
    table: str
    statistic: str
    modification_count: int | None = None
    sampling_percent: float | None = None
    last_update: str | None = None


class WaitStat(BaseModel):
    wait_type: str
    wait_time_ms: int
    wait_count: int


class QueryTime(BaseModel):
    cpu_time: int = 0
    elapsed_time: int = 0


class PlanNode(BaseModel):
    node_id: int
    physical_op: str
    logical_op: str
    estimated_cost: float
    estimate_rows: float
    table_cardinality: float = 0.0
    estimate_rows_without_row_goal: float = 0.0
    parallel: bool = False
    lookup: bool = False
    actual_rows: float | None = None
    actual_executions: float | None = None
    actual_elapsed_ms: float | None = None
    actual_cpu_ms: float | None = None
    actual_logical_reads: float | None = None
    actual_physical_reads: float | None = None
    has_actual_stats: bool = False
    predicate: str | None = None
    seek_predicates: str | None = None
    output_columns: str | None = None
    table_name: str | None = None
    index_name: str | None = None
    index_kind: str | None = None
    partitioned: bool = False
    warnings: list[NodeWarning] = Field(default_factory=list)
    scalar_udfs: list[str] = Field(default_factory=list)
    per_thread_stats: list[PerThreadStat] = Field(default_factory=list)
    children: list["PlanNode"] = Field(default_factory=list)


class ParsedStatement(BaseModel):
    statement_text: str = ""
    statement_text_truncated: bool = False
    statement_type: str = ""
    total_cost: float = 0.0
    dop: int = 0
    non_parallel_reason: str | None = None
    query_hash: str | None = None
    query_plan_hash: str | None = None
    cached_plan_size_kb: int = 0
    compile_cpu_ms: int = 0
    compile_memory_kb: int = 0
    optm_level: str | None = None
    early_abort_reason: str | None = None
    ce_model_version: int = 0
    has_actual_stats: bool = False
    memory_grant: MemoryGrant | None = None
    parameters: list[PlanParameter] = Field(default_factory=list)
    missing_indexes: list[MissingIndex] = Field(default_factory=list)
    stats_usage: list[StatsUsageItem] = Field(default_factory=list)
    wait_stats: list[WaitStat] = Field(default_factory=list)
    query_time: QueryTime | None = None
    root_node: PlanNode | None = None


class ParsedPlan(BaseModel):
    statements: list[ParsedStatement] = Field(default_factory=list)
    build_version: str | None = None


@dataclass(frozen=True)
class PlanContext:
    statement: ParsedStatement
    plan: ParsedPlan
