import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import type { IssueInsight, InsightsQuery } from "@/types";

export function useInsights(params: InsightsQuery = {}) {
  return useQuery({
    queryKey: qk.insights(params),
    queryFn: () => apiGet<IssueInsight[]>("/api/insights", params),
    staleTime: 60_000,
    retry: 1,
  });
}
