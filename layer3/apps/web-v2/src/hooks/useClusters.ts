import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import type { ClusterResponse } from "@/types";

export function useClusters() {
  return useQuery({
    queryKey: ["clusters"],
    queryFn: () => apiGet<ClusterResponse[]>("/api/clusters"),
    staleTime: 30_000,
  });
}
