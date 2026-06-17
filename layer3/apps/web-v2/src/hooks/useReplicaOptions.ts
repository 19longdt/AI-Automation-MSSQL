import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { useDashboardStore } from "@/store/dashboard.store";
import type { FindingWithAnalysis, FindingsResponse } from "@/types";

async function fetchReplicaOptions(topicId: string, clusterId?: string): Promise<string[]> {
  const limit = 200;
  const maxPages = 5;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const names = new Set<string>();

  for (let page = 0; page < maxPages; page += 1) {
    const response = await apiGet<FindingsResponse>("/api/findings", {
      topic_id: topicId,
      cluster_id: clusterId || undefined,
      since: cutoff,
      limit,
      page,
    });

    response.items.forEach((finding: FindingWithAnalysis) => {
      const metrics = (finding.metrics ?? {}) as Record<string, unknown>;
      const replica = String(metrics.replica_server_name ?? "").trim();
      if (replica) names.add(replica);
    });

    if (response.items.length < limit) break;
  }

  return Array.from(names).sort();
}

export function useReplicaOptions(topicId: string, enabled = true) {
  const { selectedClusterId } = useDashboardStore();
  const clusterId = selectedClusterId ?? undefined;
  const query = useQuery({
    queryKey: ["replica-options", topicId, clusterId],
    queryFn: () => fetchReplicaOptions(topicId, clusterId),
    enabled: enabled && !!topicId,
    staleTime: 60_000,
  });

  return useMemo(
    () => ({
      ...query,
      data: query.data ?? [],
    }),
    [query],
  );
}
