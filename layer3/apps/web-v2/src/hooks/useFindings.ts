import { useQuery } from "@tanstack/react-query";
import { useDashboardStore } from "@/store/dashboard.store";
import { useTimeRange } from "./useTimeRange";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { buildFindingsQuery } from "@/lib/dashboard-query";
import type { FindingsResponse, FindingsQuery } from "@/types";

export function useFindings() {
  const { activeTopicId, filters, page } = useDashboardStore();
  const { from, to } = useTimeRange();

  const params: FindingsQuery = buildFindingsQuery({ activeTopicId, filters, from, to }, page, 15);

  return useQuery({
    queryKey: qk.findings(params),
    queryFn: () => apiGet<FindingsResponse>("/api/findings", params),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
}

export function useFindingById(id: string) {
  return useQuery({
    queryKey: qk.findingById(id),
    queryFn: () => apiGet<FindingsResponse["items"][0]>(`/api/findings/${encodeURIComponent(id)}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}
