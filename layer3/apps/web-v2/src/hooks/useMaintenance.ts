import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import type {
  CampaignCreateBody,
  CampaignListQuery,
  CampaignListResponse,
  CampaignUpdateBody,
  MaintenanceHistoryQuery,
  MaintenanceHistoryResponse,
  MaintenanceQueueQuery,
  MaintenanceQueueResponse,
  MaintenanceSummaryQuery,
  MaintenanceSummary
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
