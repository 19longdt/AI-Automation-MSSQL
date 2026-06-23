import type {
  FindingsQuery,
  TimelineQuery,
  InsightsQuery,
  AnalysesQuery,
  CampaignListQuery,
  MaintenanceSummaryQuery,
  MaintenanceQueueQuery,
  MaintenanceHistoryQuery,
} from "@/types";


export const qk = {
  topics: ()                          => ["topics"]                      as const,
  findings: (p: FindingsQuery)        => ["findings", p]                 as const,
  timeline: (p: TimelineQuery)        => ["findings-timeline", p]        as const,
  findingById: (id: string)           => ["finding", id]                 as const,
  diagnostics: (id: string)           => ["diagnostics", id]             as const,
  slowQueryStats: (p: object)         => ["slow-query-stats", p]         as const,
  insights: (p: InsightsQuery)        => ["insights", p]                 as const,
  analyses: (p: AnalysesQuery)        => ["analyses", p]                 as const,
  jobsHealth: ()                      => ["jobs-health"]                  as const,
  campaigns: (p: CampaignListQuery) => ["campaigns", p] as const,
  maintenanceSummary: (p: MaintenanceSummaryQuery) => ["maintenance-summary", p] as const,
  maintenanceQueue: (p: MaintenanceQueueQuery) => ["maintenance-queue", p] as const,
  maintenanceHistory: (p: MaintenanceHistoryQuery) => ["maintenance-history", p] as const,
  agSecondaryStatus: (clusterId: string | null) => ["ag-secondary-status", clusterId] as const,
};
