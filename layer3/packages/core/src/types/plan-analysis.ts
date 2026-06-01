export type PlanSeverity = "critical" | "warning" | "info";

export interface PlanAction {
  type: string;
  ddl: string | null;
  description: string;
}

export interface PlanFinding {
  severity: PlanSeverity;
  category: string;
  type: string;
  description: string;
  recommendation: string;
  action: PlanAction | null;
}

export interface OperatorSummary {
  node_id: number;
  physical_op: string;
  logical_op: string;
  op_type_tag: string;
  cost: number;
  cost_pct: number;
  estimated_rows: number;
  actual_rows: number | null;
  actual_elapsed_ms: number | null;
  actual_logical_reads: number | null;
  actual_physical_reads: number | null;
  read_ahead_reads: number | null;
  scan_count: number | null;
  has_row_est_off: boolean;
  has_spill: boolean;
  table_name: string | null;
  index_name: string | null;
}

export interface IndexSuggestion {
  table: string;
  impact: number;
  equality_columns: string[];
  inequality_columns: string[];
  include_columns: string[];
  create_statement: string | null;
}

export interface MemoryGrantSummary {
  requested_kb: number;
  granted_kb: number;
  max_used_kb: number | null;
  grant_wait_ms: number;
}

export interface ParameterInfo {
  name: string;
  data_type: string | null;
  compiled_value: string | null;
  runtime_value: string | null;
}

export interface WaitStatSummary {
  type: string;
  ms: number;
  count: number;
  category: string;
}

export interface StatsSummary {
  table: string;
  statistic: string;
  modification_count: number | null;
  sampling_percent: number | null;
  last_update: string | null;
  is_stale: boolean;
}

export interface IOStatSummary {
  node_id: number;
  physical_op: string;
  op_type_tag: string;
  table_name: string | null;
  index_name: string | null;
  logical_reads: number;
  physical_reads: number;
  read_ahead_reads: number;
  scan_count: number;
}

export interface JoinTypeSummary {
  join_type: string;
  count: number;
  has_spill: boolean;
}

export interface IndexUsage {
  table: string;
  index: string;
  index_kind: string;
  op_type: string;
  is_partitioned: boolean;
}

export interface LookupQueries {
  plan_cache_sql: string;
  query_store_sql: string;
}

export interface CompilationInfo {
  ce_model_version: number;
  dop: number;
  non_parallel_reason: string | null;
  compile_cpu_ms: number;
  compile_memory_kb: number;
  cached_plan_size_kb: number;
  optm_level: string | null;
  early_abort_reason: string | null;
  query_hash: string | null;
  query_plan_hash: string | null;
  lookup_queries: LookupQueries | null;
}

export interface StatementResult {
  statement_text: string;
  statement_text_truncated: boolean;
  statement_type: string;
  total_cost: number;
  elapsed_ms: number | null;
  cpu_ms: number | null;
  dop: number;
  has_actual_stats: boolean;
  ce_model_version: number;
  optm_level: string | null;
  query_hash: string | null;
  query_plan_hash: string | null;
  finding_groups: FindingGroup[];
  critical_count: number;
  warning_count: number;
  info_count: number;
  top_operators: OperatorSummary[];
  missing_indexes: IndexSuggestion[];
  memory_grant: MemoryGrantSummary | null;
  parameters: ParameterInfo[];
  wait_stats: WaitStatSummary[];
  statistics: StatsSummary[];
  io_stats: IOStatSummary[];
  join_types: JoinTypeSummary[];
  indexes_used: IndexUsage[];
  compilation: CompilationInfo | null;
}

export interface FindingInstance {
  description: string;
  action: PlanAction | null;
}

export interface FindingGroup {
  severity: PlanSeverity;
  category: string;
  type: string;
  recommendation: string;
  shared_action: PlanAction | null;
  instances: FindingInstance[];
  count: number;
}

export interface PlanAnalysisResult {
  statements: StatementResult[];
  total_findings: number;
  critical_count: number;
  warning_count: number;
  has_actual_stats: boolean;
  analyzed_at: string;
  analysis_duration_ms: number;
}

