export type Severity = "INFO" | "WARNING" | "CRITICAL";

export type IssueType =
  | "slow_sessions"
  | "plan_regression"
  | "blocking_chain"
  | "deadlock"
  | "non_optimal_index"
  | "missing_index"
  | "tempdb_pressure"
  | "memory_pressure"
  | "wait_anomaly"
  | "ag_lag"
  | "cdc_failure"
  | "index_fragmentation"
  | "resource_pool_spike"
  | "job_failure"
  | "backup_gap"
  | "dbcc_overdue"
  | "plan_instability"
  | "partition_elimination_failure"
  | "high_variation_query"
  | "blocked_query_snapshot"
  | "blocked_query_trend";

export interface Finding {
  finding_id: string;
  detected_at: string;
  topic_id: string;
  cluster_id?: string;
  issue_type: IssueType;
  severity: Severity;
  node: string;
  role: string;
  metrics: Record<string, unknown>;
  plan_patterns: string[];
  status: "new" | "analyzing" | "analyzed" | "resolved" | "suppressed";
  ai_analysis_id?: string;
  query_text?: string;
  finding_hash: string;
}
