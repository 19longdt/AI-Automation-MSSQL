import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiGet, apiPatch } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import type { TopicOverridesMap } from "@/types";

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

export function useTopicOverrides(clusterId: string, enabled = true) {
  return useQuery({
    queryKey: qk.topicOverrides(clusterId),
    queryFn: () => apiGet<TopicOverridesMap>(`/api/clusters/${encodeURIComponent(clusterId)}/topic-overrides`),
    enabled: enabled && Boolean(clusterId),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useUpdateTopicOverrides(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (overrides: TopicOverridesMap) =>
      apiPatch<{ ok: boolean; cluster_id: string; topic_overrides: TopicOverridesMap }>(
        `/api/clusters/${encodeURIComponent(clusterId)}/topic-overrides`,
        overrides
      ),
    onSuccess: async () => {
      toast.success("Alert config saved");
      await queryClient.invalidateQueries({ queryKey: qk.topicOverrides(clusterId) });
      await queryClient.invalidateQueries({ queryKey: ["clusters"] });
    },
    onError: (error) => {
      toast.error("Save alert config failed", { description: getApiErrorMessage(error, "Unknown error") });
    },
  });
}
