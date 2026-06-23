import { toDetectedAtFilterValue } from "@/lib/format";
import type { FindingFilters, FindingsQuery, TimelineQuery } from "@/types";

interface QueryContext {
  selectedClusterId?: string | null;
  activeTopicId?: string;
  filters: FindingFilters;
  from: Date;
  to: Date;
}

export function buildFindingsQuery(
  ctx: QueryContext,
  page: number,
  limit: number,
): FindingsQuery {
  return {
    finding_id: ctx.filters.findingId || undefined,
    query_hash: ctx.filters.queryHash || undefined,
    cluster_id: ctx.selectedClusterId || undefined,
    topic_id: ctx.activeTopicId || undefined,
    severity: ctx.filters.severity || undefined,
    alert_status: ctx.filters.alertStatus || undefined,
    blocking_status: ctx.filters.blockingStatus || undefined,
    since: toDetectedAtFilterValue(ctx.from),
    until: toDetectedAtFilterValue(ctx.to),
    limit,
    page,
  };
}

export function buildTimelineQuery(
  ctx: QueryContext,
  intervalMinutes: number,
): TimelineQuery {
  return {
    finding_id: ctx.filters.findingId || undefined,
    query_hash: ctx.filters.queryHash || undefined,
    cluster_id: ctx.selectedClusterId || undefined,
    topic_id: ctx.activeTopicId || undefined,
    severity: ctx.filters.severity || undefined,
    alert_status: ctx.filters.alertStatus || undefined,
    blocking_status: ctx.filters.blockingStatus || undefined,
    since: toDetectedAtFilterValue(ctx.from),
    until: toDetectedAtFilterValue(ctx.to),
    interval_minutes: intervalMinutes,
  };
}

export function formatQueryPreview(params: object): string {
  return Object.entries(params as Record<string, string | number | undefined>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
}
