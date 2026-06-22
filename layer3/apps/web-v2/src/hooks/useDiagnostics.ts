import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";

export function useDiagnostics(findingId: string | null) {
  return useQuery({
    queryKey: qk.diagnostics(findingId ?? ""),
    queryFn: () => apiGet(`/api/findings/${encodeURIComponent(findingId!)}/diagnostics`),
    enabled: !!findingId,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}
