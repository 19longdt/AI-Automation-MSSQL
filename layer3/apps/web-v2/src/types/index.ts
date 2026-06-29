import type { Finding, Severity, IssueType } from "@layer3/core";
import type { AnalysisResult, InsightData } from "@layer3/core";

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

export interface AgSecondaryStatus {
  status: "active" | "no_secondary";
  last_seen_at: string | null;
}

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

export interface TopicNotifyOverride {
  notify_enabled: boolean;
}

export type TopicOverridesMap = Record<string, TopicNotifyOverride>;

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
  topic_overrides?: TopicOverridesMap;
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
  campaign_id?: string;
  status?: string;
  action_type?: string;
  limit?: number;
  page?: number;
}

export type QueueItemAction = "approve" | "reject" | "skip" | "reset";

export interface QueueBulkActionBody {
  action: "approve" | "reject" | "skip";
  cluster_id: string;
  item_ids?: string[];
  campaign_id?: string;
  batch_id?: string;
}

export interface MaintenanceHistoryQuery {
  cluster_id?: string;
  campaign_id?: string;
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

export type ExecutionType = "index" | "statistic" | "heap";

export interface CampaignScopeTable {
  schema_name: string;
  table_names: string[];
}

export interface CampaignScopeDatabase {
  database_name: string;
  schemas: CampaignScopeTable[];
}

export interface CampaignWindowOverride {
  start: string;
  end: string;
  time_budget_minutes: number;
}

export interface IndexThresholds {
  reorganize_pct?: number | null;
  rebuild_pct?: number | null;
  min_page_count?: number | null;
  max_page_count?: number | null;
}

export interface StatisticThresholds {
  modification_threshold?: number | null;
  stats_min_sample_pct?: number | null;
}

export interface HeapThresholds {
  forwarded_threshold?: number | null;
}

export interface CampaignThresholds {
  index?: IndexThresholds | null;
  statistic?: StatisticThresholds | null;
  heap?: HeapThresholds | null;
}

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
  scope?: CampaignScopeDatabase[] | null;
  thresholds?: CampaignThresholds | null;
  window_override?: CampaignWindowOverride | null;
  execution_types?: ExecutionType[];
}

export interface CampaignUpdateBody {
  name?: string;
  description?: string;
  end_date?: string;
  scan_times?: string[];
  scope?: CampaignScopeDatabase[] | null;
  thresholds?: CampaignThresholds | null;
  window_override?: CampaignWindowOverride | null;
  execution_types?: ExecutionType[];
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
  scope: CampaignScopeDatabase[] | null;
  thresholds: CampaignThresholds | null;
  window_override: CampaignWindowOverride | null;
  execution_types: ExecutionType[];
  discovery_started_at: string | null;
  discovery_finished_at: string | null;
  last_scan_triggered_at: string | null;
  total_items: number;
  done_count: number;
  failed_count: number;
  skipped_count: number;
  remaining_items: number;
  progress_pct: number;
  window_budget_used_minutes: number;
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
  active_requests_max: number | null;
  log_send_queue_max_kb: number | null;
  redo_queue_max_kb: number | null;
}

export interface MaintenanceWindowState {
  open: boolean;
  remaining_minutes: number;
  reason: string;
  slot: MaintenanceWindowSlot;
  budget_used_minutes: number;
  enabled: boolean;
  kill_switch: boolean;
  gates: MaintenanceWindowGates;
}

export interface MaintenanceWindowSlotConfig {
  start: string;
  end: string;
  time_budget_minutes: number;
}

export interface MaintenanceWindowConfig {
  cluster_id: string;
  enabled: boolean;
  kill_switch: boolean;
  default: MaintenanceWindowSlotConfig;
  day_overrides: Record<string, MaintenanceWindowSlotConfig | null>;
  gates: MaintenanceWindowGates;
}

export interface CatalogStatus {
  has_config: boolean;
  last_run_at: string | null;
  table_count: number;
  age_hours: number | null;
  is_stale: boolean;
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
  window: MaintenanceWindowState | null;
  queue_counts: Record<string, number>;
  last_batch: MaintenanceBatchSummary | null;
  last_scan_job: MaintenanceScanJob | null;
  catalog: CatalogStatus | null;
}

export interface CampaignCatalogStatus {
  has_snapshot: boolean;
  last_run_at: string | null;
  table_count: number;
  database_count: number;
  schema_count: number;
}

export interface CampaignApprovalSummary {
  batch_id: string | null;
  status: string | null;
  decision: string | null;
  item_count: number | null;
  decided_at: string | null;
  awaiting_count: number;
}

export interface CampaignQueueSummary {
  awaiting_approval: number;
  approved: number;
  running: number;
  paused: number;
}

export interface CampaignResultsSummary {
  total_items: number;
  done: number;
  failed: number;
  skipped: number;
  remaining: number;
  progress_pct: number;
}

export interface MaintenanceCampaignSummary {
  campaign_id: string | null;
  cluster_id: string | null;
  name: string | null;
  status: string | null;
  discovery_error: string | null;
  discovery_finished_at: string | null;
  last_scan_triggered_at: string | null;
  catalog: CampaignCatalogStatus;
  approval: CampaignApprovalSummary;
  queue: CampaignQueueSummary;
  results: CampaignResultsSummary;
}

export interface MaintenanceQueueItem {
  item_id: string | null;
  short_id: string | null;
  campaign_id: string | null;
  table_name: string | null;
  schema_name: string | null;
  index_name: string | null;
  stats_name: string | null;
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
  updated_at: string | null;
  terminal_at: string | null;
}

export interface MaintenanceHistoryItem {
  history_id: string | null;
  campaign_id: string | null;
  table_name: string | null;
  schema_name: string | null;
  index_name: string | null;
  stats_name: string | null;
  action_type: string | null;
  outcome: string | null;
  previous_status: string | null;
  final_status: string | null;
  attempt_no: number;
  frag_before_pct: number | null;
  frag_after_pct: number | null;
  duration_ms: number | null;
  skip_reason: string | null;
  error: string | null;
  statement: string | null;
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

export interface CatalogConfig {
  cluster_id: string;
  enabled?: boolean;
  databases: Array<{
    database_name: string;
    schemas: Array<{
      name?: string;
      schema_name: string;
      table_names: string[];
    }>;
  }>;
  updated_at?: string;
}

export type MaintenanceCommandType = "run_catalog" | "run_discovery";

export interface MaintenanceCommandCreateBody {
  cluster_id: string;
  type: MaintenanceCommandType;
  catalog_scope?: Array<{
    database_name: string;
    schemas: Array<{
      schema_name: string;
      table_names: string[];
    }>;
  }>;
}

export interface CatalogTableSummary {
  run_id: string | null;
  table_name: string;
  schema_name: string;
  row_count: number;
  max_fragmentation_pct: number | null;
  stale_stats_count: number;
  has_heap_issue: boolean;
  captured_at: string | null;
}

export interface CatalogSnapshot {
  run_id: string;
  captured_at: string | null;
  table_count: number;
}

export interface CatalogTableHistoryPoint {
  run_id: string;
  captured_at: string;
  row_count: number;
  max_fragmentation_pct: number | null;
  stale_stats_count: number;
}

export interface CatalogIndexPartition {
  partition_number: number;
  fragmentation_pct: number | null;
  page_count: number | null;
}

export interface CatalogIndexEntry {
  index_id: number;
  index_name: string | null;
  index_type: string;
  is_unique: boolean;
  is_partitioned: boolean;
  fragmentation_pct: number | null;
  page_count: number | null;
  partition_count: number;
  partitions?: CatalogIndexPartition[];
}

export interface CatalogIndexTrendPoint {
  run_id: string;
  captured_at: string;
  fragmentation_pct: number | null;
  page_count: number | null;
  partitions: CatalogIndexPartition[];
}

export interface CatalogIndexTrendSeries {
  index_id: number;
  index_name: string | null;
  index_type: string;
  is_partitioned: boolean;
  points: CatalogIndexTrendPoint[];
}

export interface CatalogStatsEntry {
  stats_id: number;
  stats_name: string;
  last_updated: string | null;
  rows: number;
  rows_sampled: number;
  modification_counter: number;
  auto_created: boolean;
}

export interface CatalogStatsTrendPoint {
  run_id: string;
  captured_at: string;
  modification_counter: number;
  rows: number;
  last_updated: string | null;
}

export interface CatalogStatsTrendSeries {
  stats_id: number;
  stats_name: string;
  auto_created: boolean;
  points: CatalogStatsTrendPoint[];
}

export interface CatalogTableDetail {
  cluster_id: string | null;
  database_name: string | null;
  run_id: string | null;
  schema_name: string | null;
  table_name: string | null;
  object_id: number | null;
  row_count: number;
  reserved_kb: number;
  data_kb: number;
  index_kb: number;
  indexes: CatalogIndexEntry[];
  statistics: CatalogStatsEntry[];
  heap_forwarded_count: number | null;
  captured_at: string | null;
}

export interface CatalogMaintenanceEvent {
  history_id: string;
  action_type: string;
  outcome: string;
  index_name: string | null;
  stats_name: string | null;
  frag_before_pct: number | null;
  frag_after_pct: number | null;
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
}

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
