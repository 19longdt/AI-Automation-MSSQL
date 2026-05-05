export interface InsightAction {
  action: string;
  priority: "low" | "medium" | "high";
  effort?: "low" | "medium" | "high";
  resolved?: boolean;
}

export interface InsightSummary {
  root_cause_category: string;
  affected_tables: string[];
  recurrence_count: number;
}

export interface InsightData {
  insight_id: string;
  finding_id?: string;
  root_cause_summary: string;
  affected_tables: string[];
  actions: InsightAction[];
  created_at: string;
}

export interface AnalysisResult {
  analysis_id: string;
  finding_id: string;
  skill_id: string;
  analysis_text: string;
  cost_usd: number;
  model: string;
  root_cause_summary: string;
  top_actions: string[];
  status: "pending" | "running" | "completed" | "failed" | "timeout";
  started_at: string;
  completed_at?: string;
  total_duration_ms?: number;
}
