import type { Finding, Severity, IssueType } from "@layer3/core";
import type { AnalysisResult, InsightData } from "@layer3/core";

/* ── API Query Params ── */
export interface FindingsQuery {
  finding_id?: string;
  topic_id?: string;
  severity?: Severity | "";
  alert_status?: "sent" | "suppressed" | "pending" | "";
  blocking_status?: "blocked" | "not_blocked" | "";
  issue_type?: IssueType | "";
  since?: string;
  until?: string;
  limit?: number;
  page?: number;
}

export interface TimelineQuery {
  topic_id?: string;
  severity?: string;
  alert_status?: string;
  blocking_status?: string;
  since?: string;
  until?: string;
  interval_minutes?: number;
}

export interface InsightsQuery {
  issue_type?: string;
  severity?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface AnalysesQuery {
  finding_id?: string;
  limit?: number;
  page?: number;
}

/* ── API Response Types ── */
export interface FindingWithAnalysis extends Finding {
  ai_analyzed: boolean;
  ai_analysis: AnalysisResult | null;
  has_diagnostics?: boolean;
  alert_status?: string;
}

export interface FindingsResponse {
  total: number;
  items: FindingWithAnalysis[];
}

export interface TimelineBucket {
  ts: string;
  count: number;
  critical: number;
  warning: number;
  info: number;
}

export interface TimelineResponse {
  interval_minutes: number;
  from: string | null;
  to: string | null;
  buckets: TimelineBucket[];
}

export interface TopicThresholdConfig {
  warning?: number;
  critical?: number;
}

export interface IssueInsight {
  _id: string;
  issue_type: string;
  finding_id?: string;
  root_cause_summary: string;
  affected_tables: string[];
  actions: InsightData["actions"];
  severity?: Severity;
  created_at: string;
  recurrence_count?: number;
}

export interface MonitorTopic {
  topic_id: string;
  name: string;
  description?: string;
  enabled: boolean;
  thresholds?: Record<string, TopicThresholdConfig>;
}

export interface JobHealthEntry {
  job_id: string;
  topic_id: string;
  status: string;
  last_run_at: string | null;
  findings_count: number;
}

/* ── UI State ── */
export interface FindingFilters {
  severity?: Severity | "";
  alertStatus?: "sent" | "suppressed" | "pending" | "";
  blockingStatus?: "blocked" | "not_blocked" | "";
  replica?: string;
}

export interface AutoRefreshConfig {
  enabled: boolean;
  intervalMs: number;
}
