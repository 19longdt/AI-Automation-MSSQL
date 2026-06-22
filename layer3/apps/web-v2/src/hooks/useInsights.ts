import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { useDashboardStore } from "@/store/dashboard.store";
import type { IssueInsight, InsightsQuery } from "@/types";

export function useInsights(params: InsightsQuery = {}) {
  const { selectedClusterId } = useDashboardStore();
  const query = { ...params, cluster_id: params.cluster_id ?? (selectedClusterId || undefined) };
  return useQuery({
    queryKey: qk.insights(query),
    queryFn: () => apiGet<IssueInsight[]>("/api/insights", query),
    staleTime: 60_000,
    retry: 1,
  });
}
