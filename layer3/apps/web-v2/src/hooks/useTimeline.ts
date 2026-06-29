import { useQuery } from "@tanstack/react-query";
import { useDashboardStore } from "@/store/dashboard.store";
import { useTimeRange } from "./useTimeRange";
import { chooseTimelineIntervalMinutes } from "@/lib/time-range";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { buildTimelineQuery } from "@/lib/dashboard-query";
import type { TimelineResponse, TimelineQuery } from "@/types";

export function useTimeline() {
  const { activeTopicId, selectedClusterId, filters } = useDashboardStore();
  const { from, to } = useTimeRange();

  const params: TimelineQuery = buildTimelineQuery(
    { activeTopicId, selectedClusterId, filters, from, to },
    chooseTimelineIntervalMinutes(from, to),
  );

  return useQuery({
    queryKey: qk.timeline(params),
    queryFn: () => apiGet<TimelineResponse>("/api/findings/timeline", params),
    staleTime: 15_000,
    retry: 1,
  });
}
