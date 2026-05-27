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
  cost_pct: number;
  estimated_rows: number;
  actual_rows: number | null;
  actual_elapsed_ms: number | null;
  actual_logical_reads: number | null;
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

export interface StatementResult {
  statement_text: string;
  statement_type: string;
  total_cost: number;
  dop: number;
  has_actual_stats: boolean;
  ce_model_version: number;
  query_hash: string | null;
  query_plan_hash: string | null;
  findings: PlanFinding[];
  critical_count: number;
  warning_count: number;
  info_count: number;
  top_operators: OperatorSummary[];
  missing_indexes: IndexSuggestion[];
  memory_grant: MemoryGrantSummary | null;
  parameters: ParameterInfo[];
  wait_stats: WaitStatSummary[];
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

