import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { ChartFrame } from "@/components/dashboard/BaseMetricChart";
import { Skeleton } from "@/components/ui/skeleton";
import { useTimeRange } from "@/hooks/useTimeRange";
import { apiGet } from "@/lib/api-client";
import { buildFindingsQuery } from "@/lib/dashboard-query";
import { qk } from "@/lib/query-keys";
import { truncate } from "@/lib/format";
import { openQpTextOverlay } from "@/lib/qp/actions";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { SlowQueryStatsResponse } from "@/types";

type SortBy = "impact" | "count" | "avg_elapsed" | "max_elapsed" | "avg_cpu";
type SortDir = "asc" | "desc";

function formatDuration(seconds: number | null | undefined, fractionDigits = 1): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) {
    const rounded = Number(seconds.toFixed(fractionDigits));
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(fractionDigits)}s`;
  }

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function severityClass(severity: string): string {
  if (severity === "CRITICAL") return "text-[var(--color-critical)]";
  if (severity === "WARNING") return "text-[var(--color-warning)]";
  return "text-[var(--color-text)]";
}

function LoadingRows(): React.ReactElement {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-b border-[var(--color-border)] last:border-b-0">
          <td className="px-2 py-2"><Skeleton className="h-3.5 w-4" /></td>
          <td className="px-2 py-2"><Skeleton className="h-3.5 w-20" /></td>
          <td className="px-2 py-2"><Skeleton className="h-3.5 w-8" /></td>
          <td className="px-2 py-2"><Skeleton className="h-3.5 w-14" /></td>
          <td className="px-2 py-2"><Skeleton className="h-3.5 w-14" /></td>
          <td className="px-2 py-2"><Skeleton className="h-3.5 w-14" /></td>
          <td className="px-2 py-2"><Skeleton className="h-3.5 w-full" /></td>
        </tr>
      ))}
    </>
  );
}

export function SlowQueryStatsTable(): React.ReactElement {
  const { selectedClusterId, filters } = useDashboardStore();
  const { from, to } = useTimeRange();
  const [sortBy, setSortBy] = useState<SortBy>("impact");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(nextSortBy: SortBy) {
    if (nextSortBy === sortBy) {
      setSortDir((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(nextSortBy);
    setSortDir("desc");
  }

  const params = useMemo(() => {
    const baseQuery = buildFindingsQuery(
      { activeTopicId: "slow_sessions", selectedClusterId, filters, from, to },
      0,
      1,
    );

    return {
      finding_id: filters.findingId || undefined,
      query_hash: filters.queryHash || undefined,
      cluster_id: selectedClusterId || undefined,
      severity: filters.severity || undefined,
      alert_status: filters.alertStatus || undefined,
      blocking_status: filters.blockingStatus || undefined,
      replica: filters.replica || undefined,
      since: baseQuery.since,
      until: baseQuery.until,
      sort_by: sortBy,
      sort_dir: sortDir,
      limit: 5,
    };
  }, [selectedClusterId, filters, from, to, sortBy, sortDir]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: qk.slowQueryStats(params),
    queryFn: () => apiGet<SlowQueryStatsResponse>("/api/findings/slow-query-stats", params),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const rows = data?.items ?? [];
  const sortIcon = (column: SortBy) =>
    column !== sortBy ? (
      <ArrowUpDown className="h-3 w-3 opacity-55" />
    ) : sortDir === "desc" ? (
      <ArrowDown className="h-3 w-3" />
    ) : (
      <ArrowUp className="h-3 w-3" />
    );

  return (
    <ChartFrame
      eyebrow="Top Query"
      title=""
      className="relative flex min-h-[160px] flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-[11px] leading-tight">
            <thead className="sticky top-0 z-10 overflow-hidden bg-[var(--color-surface-2)]">
              <tr>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">#</th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">QUERY HASH</th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("count")}>
                    COUNT {sortIcon("count")}
                  </button>
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("avg_elapsed")}>
                    AVG ELAPSED {sortIcon("avg_elapsed")}
                  </button>
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("max_elapsed")}>
                    MAX {sortIcon("max_elapsed")}
                  </button>
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("avg_cpu")}>
                    AVG CPU {sortIcon("avg_cpu")}
                  </button>
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">SQL</th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("impact")}>
                    IMPACT {sortIcon("impact")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                <LoadingRows />
              ) : error ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-[12px] text-[var(--color-critical)]">
                    {error instanceof Error ? error.message : "Failed to load slow query stats"}
                    <button
                      type="button"
                      onClick={() => void refetch()}
                      className="ml-2 font-semibold text-[var(--color-primary)] underline underline-offset-2"
                    >
                      Thử lại
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-[12px] text-[var(--color-muted)]">
                    Không có dữ liệu trong khoảng thời gian đã chọn
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr
                    key={row.query_hash}
                    className="cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-row-hover)] last:border-b-0"
                    onClick={() => openQpTextOverlay("Query Text", row.sql_text || "", "Copy SQL")}
                    title={row.sql_text ? "Click để xem chi tiết SQL" : "Không có SQL text"}
                  >
                    <td className="px-2 py-2 align-top font-code text-[var(--color-muted)]">{index + 1}</td>
                    <td className={cn("px-2 py-2 align-top font-code", severityClass(row.severity))} title={row.query_hash}>
                      {row.query_hash}
                    </td>
                    <td className={cn("px-2 py-2 align-top font-code tabular", severityClass(row.severity))}>{row.count}</td>
                    <td className={cn("px-2 py-2 align-top font-code tabular", severityClass(row.severity))}>
                      {formatDuration(row.avg_elapsed, 1)}
                    </td>
                    <td className={cn("px-2 py-2 align-top font-code tabular", severityClass(row.severity))}>
                      {formatDuration(row.max_elapsed, 0)}
                    </td>
                    <td className="px-2 py-2 align-top font-code tabular text-[var(--color-text)]">
                      {formatDuration(row.avg_cpu, 1)}
                    </td>
                    <td
                      className="max-w-[320px] px-2 py-2 align-top font-code text-[var(--color-muted)]"
                      title={row.sql_text || "Không có SQL text"}
                    >
                      {row.sql_text ? truncate(row.sql_text.replace(/\s+/g, " "), 70) : "—"}
                    </td>
                    <td className={cn("px-2 py-2 align-top font-code tabular", severityClass(row.severity))}>
                      {formatDuration(row.impact, 0)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <RefreshingOverlay visible={isFetching && !!data} />
    </ChartFrame>
  );
}
