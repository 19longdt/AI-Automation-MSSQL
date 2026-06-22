import { useMemo } from "react";
import { useDashboardStore } from "@/store/dashboard.store";
import { resolveTimeRange, type ResolvedTimeRange } from "@/lib/time-range";

export function useTimeRange(): ResolvedTimeRange {
  const timeRange = useDashboardStore((s) => s.timeRange);
  const timeAnchorMs = useDashboardStore((s) => s.timeAnchorMs);
  return useMemo(() => resolveTimeRange(timeRange, new Date(timeAnchorMs)), [timeRange, timeAnchorMs]);
}
