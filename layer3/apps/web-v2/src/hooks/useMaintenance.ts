import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import type {
  CampaignCreateBody,
  CampaignListQuery,
  CampaignListResponse,
  CampaignUpdateBody,
  CatalogConfig,
  CatalogMaintenanceEvent,
  CatalogIndexTrendSeries,
  CatalogSnapshot,
  CatalogStatsTrendSeries,
  CatalogTableHistoryPoint,
  CatalogTableDetail,
  CatalogTableSummary,
  MaintenanceCampaignSummary,
  MaintenanceCommandCreateBody,
  MaintenanceHistoryQuery,
  MaintenanceHistoryResponse,
  MaintenanceQueueQuery,
  MaintenanceQueueResponse,
  MaintenanceSummary,
  MaintenanceSummaryQuery,
  MaintenanceWindowConfig,
  QueueBulkActionBody,
  QueueItemAction,
} from "@/types";
import { useDashboardStore } from "@/store/dashboard.store";

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const payload = error.payload;
    if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
      return payload.message;
    }
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export function useMaintenanceSummary() {
  const { selectedClusterId, autoRefresh } = useDashboardStore();
  const params: MaintenanceSummaryQuery = selectedClusterId ? { cluster_id: selectedClusterId } : {};
  return useQuery({
    queryKey: qk.maintenanceSummary(params),
    queryFn: () => apiGet<MaintenanceSummary>("/api/maintenance/summary", params),
    staleTime: 30_000,
    refetchInterval: autoRefresh.enabled ? autoRefresh.intervalMs : false,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useCampaignSummary(campaignId?: string | null) {
  const { autoRefresh } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCampaignSummary(campaignId ?? null),
    queryFn: () => apiGet<MaintenanceCampaignSummary>(`/api/maintenance/campaigns/${encodeURIComponent(campaignId ?? "")}/summary`),
    enabled: Boolean(campaignId),
    staleTime: 30_000,
    refetchInterval: autoRefresh.enabled ? autoRefresh.intervalMs : false,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useWindowConfig(clusterId?: string) {
  const { selectedClusterId } = useDashboardStore();
  const resolvedClusterId = clusterId ?? selectedClusterId ?? undefined;
  return useQuery({
    queryKey: qk.maintenanceWindowConfig(resolvedClusterId ?? null),
    queryFn: () => apiGet<MaintenanceWindowConfig | null>("/api/maintenance/window", { cluster_id: resolvedClusterId }),
    enabled: Boolean(resolvedClusterId),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useMaintenanceQueue(filters: MaintenanceQueueQuery) {
  const { selectedClusterId, autoRefresh } = useDashboardStore();
  const params = { ...filters, ...(selectedClusterId ? { cluster_id: selectedClusterId } : {}) };
  return useQuery({
    queryKey: qk.maintenanceQueue(params),
    queryFn: () => apiGet<MaintenanceQueueResponse>("/api/maintenance/queue", params),
    staleTime: 30_000,
    refetchInterval: autoRefresh.enabled ? autoRefresh.intervalMs : false,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useMaintenanceHistory(filters: MaintenanceHistoryQuery) {
  const { selectedClusterId, autoRefresh } = useDashboardStore();
  const params = { ...filters, ...(selectedClusterId ? { cluster_id: selectedClusterId } : {}) };
  return useQuery({
    queryKey: qk.maintenanceHistory(params),
    queryFn: () => apiGet<MaintenanceHistoryResponse>("/api/maintenance/history", params),
    staleTime: 60_000,
    refetchInterval: autoRefresh.enabled ? autoRefresh.intervalMs : false,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useCampaigns(filters: Omit<CampaignListQuery, "cluster_id"> = {}) {
  const { selectedClusterId, autoRefresh } = useDashboardStore();
  const params: CampaignListQuery = {
    ...filters,
    ...(selectedClusterId ? { cluster_id: selectedClusterId } : {}),
  };
  return useQuery({
    queryKey: qk.campaigns(params),
    queryFn: () => apiGet<CampaignListResponse>("/api/maintenance/campaigns", params),
    enabled: Boolean(selectedClusterId),
    staleTime: 30_000,
    refetchInterval: autoRefresh.enabled ? autoRefresh.intervalMs : false,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useCatalogDatabases() {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogDatabases(selectedClusterId ?? null),
    queryFn: () => apiGet<string[]>("/api/maintenance/catalog/databases", { cluster_id: selectedClusterId }),
    enabled: Boolean(selectedClusterId),
    staleTime: 60_000,
  });
}

export function useCatalogSchemas(database: string) {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogSchemas(selectedClusterId ?? null, database),
    queryFn: () => apiGet<string[]>("/api/maintenance/catalog/schemas", { cluster_id: selectedClusterId, database }),
    enabled: Boolean(selectedClusterId && database),
    staleTime: 60_000,
  });
}

export function useCatalogSnapshots(database: string) {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogSnapshots(selectedClusterId ?? null, database),
    queryFn: () => apiGet<CatalogSnapshot[]>("/api/maintenance/catalog/snapshots", { cluster_id: selectedClusterId, database }),
    enabled: Boolean(selectedClusterId && database),
    staleTime: 60_000,
  });
}

export function useCatalogTables(
  database: string,
  schema: string,
  filters?: { min_frag_pct?: number; has_stale_stats?: boolean; has_heap?: boolean },
  runId?: string,
) {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogTables(selectedClusterId ?? null, database, schema, runId ?? null, filters),
    queryFn: () => apiGet<CatalogTableSummary[]>("/api/maintenance/catalog/tables", {
      cluster_id: selectedClusterId,
      database,
      schema,
      run_id: runId,
      ...filters,
    }),
    enabled: Boolean(selectedClusterId && database && schema),
    staleTime: 60_000,
  });
}

export function useCatalogLiveTables(database: string, schema: string) {
  const { selectedClusterId } = useDashboardStore();
  const enabled = Boolean(selectedClusterId && database && schema);
  return useQuery<{ tables: string[] }>({
    queryKey: ["maintenance-catalog-live-tables", selectedClusterId, database, schema],
    queryFn: () =>
      apiGet("/api/maintenance/catalog/live-tables", {
        cluster_id: selectedClusterId,
        database,
        schema,
      }),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useCatalogTable(database: string, schema: string, table: string, runId?: string) {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogTable(selectedClusterId ?? null, database, schema, table, runId ?? null),
    queryFn: () => apiGet<CatalogTableDetail | null>("/api/maintenance/catalog/table", {
      cluster_id: selectedClusterId,
      database,
      schema,
      table,
      run_id: runId,
    }),
    enabled: Boolean(selectedClusterId && database && schema && table),
    staleTime: 60_000,
  });
}

export function useCatalogTableHistory(database: string, schema: string, table: string, days = 30) {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogTableHistory(selectedClusterId ?? null, database, schema, table, days),
    queryFn: () => apiGet<CatalogTableHistoryPoint[]>("/api/maintenance/catalog/table-history", {
      cluster_id: selectedClusterId,
      database,
      schema,
      table,
      limit: 30,
      days,
    }),
    enabled: Boolean(selectedClusterId && database && schema && table),
    staleTime: 60_000,
  });
}

export function useCatalogIndexHistory(database: string, schema: string, table: string, days = 30) {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogIndexHistory(selectedClusterId ?? null, database, schema, table, days),
    queryFn: () => apiGet<CatalogIndexTrendSeries[]>("/api/maintenance/catalog/table-index-history", {
      cluster_id: selectedClusterId,
      database,
      schema,
      table,
      days,
    }),
    enabled: Boolean(selectedClusterId && database && schema && table),
    staleTime: 60_000,
  });
}

export function useCatalogStatsHistory(database: string, schema: string, table: string, days = 30) {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogStatsHistory(selectedClusterId ?? null, database, schema, table, days),
    queryFn: () => apiGet<CatalogStatsTrendSeries[]>("/api/maintenance/catalog/table-stats-history", {
      cluster_id: selectedClusterId,
      database,
      schema,
      table,
      days,
    }),
    enabled: Boolean(selectedClusterId && database && schema && table),
    staleTime: 60_000,
  });
}

export function useCatalogTableEvents(schema: string, table: string) {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogTableEvents(selectedClusterId ?? null, schema, table),
    queryFn: () => apiGet<CatalogMaintenanceEvent[]>("/api/maintenance/catalog/table-events", {
      cluster_id: selectedClusterId,
      schema,
      table,
      limit: 20,
    }),
    enabled: Boolean(selectedClusterId && schema && table),
    staleTime: 60_000,
  });
}

export function useCatalogConfig() {
  const { selectedClusterId } = useDashboardStore();
  return useQuery({
    queryKey: qk.maintenanceCatalogConfig(selectedClusterId ?? null),
    queryFn: () => apiGet<CatalogConfig | null>("/api/maintenance/catalog/config", { cluster_id: selectedClusterId }),
    enabled: Boolean(selectedClusterId),
    staleTime: 60_000,
  });
}

export function useSaveCatalogConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CatalogConfig) => apiPut("/api/maintenance/catalog/config", body),
    onSuccess: async () => {
      toast.success("Catalog config saved");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-catalog-config"] });
      await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
    },
    onError: (error) => {
      toast.error("Save catalog config failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}

export function useCreateMaintenanceCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MaintenanceCommandCreateBody) => apiPost("/api/maintenance/commands", body),
    onSuccess: async (_, body) => {
      toast.success(
        body.type === "run_catalog"
          ? body.catalog_scope?.length ? "Filtered catalog run queued" : "Catalog run queued"
          : "Discovery run queued",
      );
      await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["maintenance-catalog-config"] });
    },
    onError: (error) => {
      toast.error("Queue command failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}

function getQueueActionSuccessLabel(action: QueueItemAction | QueueBulkActionBody["action"]): string {
  switch (action) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "skip":
      return "skipped";
    case "reset":
      return "reset";
  }
}

async function invalidateMaintenanceActionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
  await queryClient.invalidateQueries({ queryKey: ["maintenance-queue"] });
  await queryClient.invalidateQueries({ queryKey: ["maintenance-campaign-summary"] });
}

export function useQueueItemAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, action }: { itemId: string; action: QueueItemAction }) =>
      apiPatch(`/api/maintenance/queue/${encodeURIComponent(itemId)}`, { action }),
    onSuccess: async (_, { action }) => {
      toast.success(`Item ${getQueueActionSuccessLabel(action)}`);
      await invalidateMaintenanceActionQueries(queryClient);
    },
    onError: (error) => {
      toast.error("Queue action failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}

export function useBulkQueueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: QueueBulkActionBody) => apiPost<{ updated_count: number }>("/api/maintenance/queue/bulk-action", body),
    onSuccess: async (data, body) => {
      toast.success(`${data.updated_count} items ${getQueueActionSuccessLabel(body.action)}`);
      await invalidateMaintenanceActionQueries(queryClient);
    },
    onError: (error) => {
      toast.error("Bulk queue action failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}

export function useToggleWindowEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clusterId, value }: { clusterId: string; value: boolean }) =>
      apiPatch("/api/maintenance/window/enabled", { cluster_id: clusterId, enabled: value }),
    onSuccess: async (_, { clusterId, value }) => {
      toast.success(value ? "Maintenance window đã bật" : "Maintenance window đã tắt");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
      await queryClient.invalidateQueries({ queryKey: qk.maintenanceSummary({ cluster_id: clusterId }) });
      await queryClient.invalidateQueries({ queryKey: qk.maintenanceWindowConfig(clusterId) });
    },
    onError: (error) => {
      toast.error("Không thể thay đổi trạng thái window", { description: getApiErrorMessage(error, "Lỗi không xác định") });
    },
  });
}

export function useToggleKillSwitch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clusterId, value }: { clusterId: string; value: boolean }) =>
      apiPatch("/api/maintenance/window/kill-switch", { cluster_id: clusterId, kill_switch: value }),
    onSuccess: async (_, { clusterId, value }) => {
      toast.success(value ? "Kill switch đã BẬT — execute bị dừng trong ≤60s" : "Kill switch đã TẮT — execute tiếp tục");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
      await queryClient.invalidateQueries({ queryKey: qk.maintenanceSummary({ cluster_id: clusterId }) });
      await queryClient.invalidateQueries({ queryKey: qk.maintenanceWindowConfig(clusterId) });
    },
    onError: (error) => {
      toast.error("Không thể thay đổi kill switch", { description: getApiErrorMessage(error, "Lỗi không xác định") });
    },
  });
}

export function useUpsertWindowConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MaintenanceWindowConfig) => apiPut("/api/maintenance/window", body),
    onSuccess: async (_, body) => {
      toast.success("Maintenance window saved");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["maintenance-window-config"] });
      await queryClient.invalidateQueries({ queryKey: qk.maintenanceSummary({ cluster_id: body.cluster_id }) });
      await queryClient.invalidateQueries({ queryKey: qk.maintenanceWindowConfig(body.cluster_id) });
    },
    onError: (error) => {
      toast.error("Save window config failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CampaignCreateBody) => apiPost("/api/maintenance/campaigns", body),
    onSuccess: async () => {
      toast.success("Campaign created");
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
    },
    onError: (error) => {
      toast.error("Create campaign failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CampaignUpdateBody }) =>
      apiPut(`/api/maintenance/campaigns/${encodeURIComponent(id)}`, body),
    onSuccess: async () => {
      toast.success("Campaign updated");
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
    },
    onError: (error) => {
      toast.error("Update campaign failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}

export function useCancelCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/maintenance/campaigns/${encodeURIComponent(id)}`),
    onSuccess: async () => {
      toast.success("Campaign cancelled");
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      await queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
    },
    onError: (error) => {
      toast.error("Cancel campaign failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}
