import type { Finding, Severity, IssueType } from "@layer3/core";
import type { AnalysisResult, InsightData } from "@layer3/core";

/* ── API Query Params ── */
export interface FindingsQuery {
  finding_id?: string;
  query_hash?: string;
  cluster_id?: string;
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
  finding_id?: string;
  query_hash?: string;
  cluster_id?: string;
  topic_id?: string;
  severity?: string;
  alert_status?: string;
  blocking_status?: string;
  since?: string;
  until?: string;
  interval_minutes?: number;
}

export interface InsightsQuery {
  cluster_id?: string;
  issue_type?: string;
  severity?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface AnalysesQuery {
  cluster_id?: string;
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

export interface SlowQueryStatsItem {
  query_hash: string;
  count: number;
  avg_elapsed: number;
  max_elapsed: number;
  avg_cpu: number;
  impact: number;
  sql_text: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
}

export interface SlowQueryStatsResponse {
  items: SlowQueryStatsItem[];
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

export interface ClusterNodeRole {
  host: string;
  server_name: string;
  role: "primary" | "secondary";
  last_seen_at: string;
}

export interface ClusterResponse {
  cluster_id: string;
  name: string;
  environment: "production" | "uat" | "dev" | "staging" | "other";
  nodes: string[];
  port: number;
  database: string;
  username: string;
  connect_timeout_sec: number;
  enabled: boolean;
  color: string;
  has_password: boolean;
  node_roles: ClusterNodeRole[];
  created_at?: string;
  updated_at?: string;
}

export interface JobHealthEntry {
  job_id: string;
  topic_id: string;
  status: string;
  last_run_at: string | null;
  findings_count: number;
}

export interface MaintenanceQueueQuery {
  cluster_id?: string;
  status?: string;
  action_type?: string;
  limit?: number;
  page?: number;
}

export interface MaintenanceHistoryQuery {
  cluster_id?: string;
  outcome?: string;
  limit?: number;
  page?: number;
}

export interface MaintenanceSummaryQuery {
  cluster_id?: string;
}

export type CampaignStatus =
  | "PENDING"
  | "DISCOVERING"
  | "DISCOVERY_FAILED"
  | "ACTIVE"
  | "COMPLETED"
  | "EXPIRED"
  | "CANCELLED";

export interface CampaignListQuery {
  cluster_id?: string;
  status?: CampaignStatus | "";
  limit?: number;
  page?: number;
}

export interface CampaignCreateBody {
  cluster_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  scan_times?: string[];
}

export interface CampaignUpdateBody {
  name?: string;
  description?: string;
  end_date?: string;
  scan_times?: string[];
}

export interface MaintenanceCampaign {
  campaign_id: string | null;
  cluster_id: string | null;
  name: string | null;
  description: string | null;
  status: CampaignStatus | null;
  discovery_error: string | null;
  start_date: string | null;
  end_date: string | null;
  scan_times: string[];
  discovery_started_at: string | null;
  discovery_finished_at: string | null;
  last_scan_triggered_at: string | null;
  total_items: number;
  done_count: number;
  failed_count: number;
  skipped_count: number;
  remaining_items: number;
  progress_pct: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface CampaignListResponse {
  total: number;
  items: MaintenanceCampaign[];
}

export interface MaintenanceWindowSlot {
  start: string;
  end: string;
  time_budget_minutes: number;
}

export interface MaintenanceWindowGates {
  cpu_max_pct: number | null;
  max_active_requests: number | null;
  max_log_send_queue_kb: number | null;
  max_redo_queue_kb: number | null;
}

export interface MaintenanceWindowState {
  open: boolean;
  remaining_minutes: number;
  reason: string;
  slot: MaintenanceWindowSlot;
  budget_used_minutes: number;
  kill_switch: boolean;
  gates: MaintenanceWindowGates;
}

export interface MaintenanceBatchTotals {
  reorganize: number | null;
  rebuild: number | null;
  update_statistics: number | null;
  est_total_minutes: number | null;
}

export interface MaintenanceBatchSummary {
  batch_id: string | null;
  status: string | null;
  decision: string | null;
  item_count: number | null;
  decided_at: string | null;
  summary: MaintenanceBatchTotals;
}

export interface MaintenanceScanJob {
  ran_at: string | null;
  status: string | null;
  records_processed: number | null;
}

export interface MaintenanceSummary {
  window: MaintenanceWindowState;
  queue_counts: Record<string, number>;
  last_batch: MaintenanceBatchSummary | null;
  last_scan_job: MaintenanceScanJob | null;
}

export interface MaintenanceQueueItem {
  item_id: string | null;
  short_id: string | null;
  table_name: string | null;
  schema_name: string | null;
  index_name: string | null;
  action_type: string | null;
  kind: string | null;
  fragmentation_pct: number | null;
  page_count: number | null;
  estimated_minutes: number | null;
  priority: number | null;
  status: string | null;
  attempts: number;
  last_error: string | null;
  resume_token: boolean;
  created_at: string | null;
}

export interface MaintenanceHistoryItem {
  history_id: string | null;
  table_name: string | null;
  schema_name: string | null;
  index_name: string | null;
  action_type: string | null;
  outcome: string | null;
  frag_before_pct: number | null;
  frag_after_pct: number | null;
  duration_ms: number | null;
  skip_reason: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface MaintenanceQueueResponse {
  total: number;
  items: MaintenanceQueueItem[];
}

export interface MaintenanceHistoryResponse {
  total: number;
  items: MaintenanceHistoryItem[];
}

/* ── UI State ── */
export interface FindingFilters {
  severity?: Severity | "";
  alertStatus?: "sent" | "suppressed" | "pending" | "";
  blockingStatus?: "blocked" | "not_blocked" | "";
  replica?: string;
  findingId?: string;
  queryHash?: string;
}

export interface AutoRefreshConfig {
  enabled: boolean;
  intervalMs: number;
}
