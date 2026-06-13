import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import type { MonitorTopic } from "@/types";

export function useTopics() {
  return useQuery({
    queryKey: qk.topics(),
    queryFn: () => apiGet<MonitorTopic[]>("/api/topics"),
    staleTime: 5 * 60_000,
    retry: 2,
  });
}
