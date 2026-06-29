import type {
  AnalysesQuery,
  CampaignListQuery,
  FindingsQuery,
  InsightsQuery,
  MaintenanceHistoryQuery,
  MaintenanceQueueQuery,
  MaintenanceSummaryQuery,
  TimelineQuery,
} from "@/types";

export const qk = {
  topics: () => ["topics"] as const,
  topicOverrides: (clusterId: string) => ["topic-overrides", clusterId] as const,
  findings: (p: FindingsQuery) => ["findings", p] as const,
  timeline: (p: TimelineQuery) => ["findings-timeline", p] as const,
  findingById: (id: string) => ["finding", id] as const,
  diagnostics: (id: string) => ["diagnostics", id] as const,
  slowQueryStats: (p: object) => ["slow-query-stats", p] as const,
  insights: (p: InsightsQuery) => ["insights", p] as const,
  analyses: (p: AnalysesQuery) => ["analyses", p] as const,
  jobsHealth: () => ["jobs-health"] as const,
  campaigns: (p: CampaignListQuery) => ["campaigns", p] as const,
  maintenanceCampaignSummary: (campaignId: string | null) => ["maintenance-campaign-summary", campaignId] as const,
  maintenanceSummary: (p: MaintenanceSummaryQuery) => ["maintenance-summary", p] as const,
  maintenanceWindowConfig: (clusterId: string | null) => ["maintenance-window-config", clusterId] as const,
  maintenanceQueue: (p: MaintenanceQueueQuery) => ["maintenance-queue", p] as const,
  maintenanceHistory: (p: MaintenanceHistoryQuery) => ["maintenance-history", p] as const,
  maintenanceCatalogDatabases: (clusterId: string | null) => ["maintenance-catalog-databases", clusterId] as const,
  maintenanceCatalogSchemas: (clusterId: string | null, database: string) => ["maintenance-catalog-schemas", clusterId, database] as const,
  maintenanceCatalogSnapshots: (clusterId: string | null, database: string) =>
    ["maintenance-catalog-snapshots", clusterId, database] as const,
  maintenanceCatalogTables: (clusterId: string | null, database: string, schema: string, runId?: string | null, filters?: object) =>
    ["maintenance-catalog-tables", clusterId, database, schema, runId ?? null, filters ?? {}] as const,
  maintenanceCatalogTable: (clusterId: string | null, database: string, schema: string, table: string, runId?: string | null) =>
    ["maintenance-catalog-table", clusterId, database, schema, table, runId ?? null] as const,
  maintenanceCatalogTableHistory: (clusterId: string | null, database: string, schema: string, table: string, days: number) =>
    ["maintenance-catalog-table-history", clusterId, database, schema, table, days] as const,
  maintenanceCatalogIndexHistory: (clusterId: string | null, database: string, schema: string, table: string, days: number) =>
    ["maintenance-catalog-index-history", clusterId, database, schema, table, days] as const,
  maintenanceCatalogStatsHistory: (clusterId: string | null, database: string, schema: string, table: string, days: number) =>
    ["maintenance-catalog-stats-history", clusterId, database, schema, table, days] as const,
  maintenanceCatalogTableEvents: (clusterId: string | null, schema: string, table: string) =>
    ["maintenance-catalog-table-events", clusterId, schema, table] as const,
  maintenanceCatalogConfig: (clusterId: string | null) => ["maintenance-catalog-config", clusterId] as const,
  agSecondaryStatus: (clusterId: string | null) => ["ag-secondary-status", clusterId] as const,
};
