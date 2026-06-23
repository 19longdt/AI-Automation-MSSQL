import { useEffect, useMemo, useState } from "react";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useMaintenanceHistory } from "@/hooks/useMaintenance";
import { formatDetectedAt, formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";

const LIMIT = 50;
const OUTCOME_OPTIONS = ["ALL", "DONE", "FAILED", "SKIPPED", "PAUSED", "ABORTED", "DRY_RUN"] as const;

function fragTone(before: number | null, after: number | null): string {
  if (before == null || after == null) return "text-[var(--color-muted)]";
  return after < before ? "text-[var(--color-success)]" : "text-[var(--color-muted)]";
}

function outcomeTone(outcome: string | null): string {
  switch (outcome) {
    case "DONE":
      return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
    case "FAILED":
    case "ABORTED":
      return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
    case "PAUSED":
    case "SKIPPED":
      return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
    default:
      return "bg-[var(--color-surface-2)] text-[var(--color-muted)]";
  }
}

export function HistoryTable() {
  const [outcome, setOutcome] = useState<string>("ALL");
  const [page, setPage] = useState(0);
  const { selectedClusterId } = useDashboardStore();
  const filters = useMemo(
    () => ({
      outcome: outcome === "ALL" ? "" : outcome,
      page,
      limit: LIMIT,
    }),
    [outcome, page]
  );
  const { data, error, isLoading, isFetching, refetch } = useMaintenanceHistory(filters);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  useEffect(() => {
    setOutcome("ALL");
    setPage(0);
  }, [selectedClusterId]);

  return (
    <div className="relative min-h-0 overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-col gap-2 border-b border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-surface)_0%,color-mix(in_srgb,var(--color-surface-2)_55%,white_45%)_100%)] px-3 py-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[15px] font-semibold text-[var(--color-text)]">Execution History</p>
        </div>
        <Select
          value={outcome}
          onValueChange={(value) => {
            setOutcome(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "ALL" ? "All outcomes" : value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--color-surface-2)] text-[var(--color-muted)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Object</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
              <th className="px-3 py-2 font-medium">Frag before-after</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t border-[var(--color-border)]">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-3 py-2">
                      <Skeleton className="h-4 w-full max-w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-0 py-0">
                  <ErrorState
                    message="Failed to load maintenance history"
                    description={error instanceof Error ? error.message : "Unknown error"}
                    onRetry={() => void refetch()}
                  />
                </td>
              </tr>
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={7} className="px-0 py-0">
                  <EmptyState
                    title="No history yet"
                    description="No history record matches the current filter."
                  />
                </td>
              </tr>
            ) : (
              data.items.map((item, index) => (
                <tr key={item.history_id ?? `${item.started_at}-${index}`} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2">
                    <div className="font-medium text-[var(--color-text)]">
                      {item.schema_name ?? "dbo"}.{item.table_name ?? "-"}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">{item.index_name ?? "Heap"}</div>
                  </td>
                  <td className="px-3 py-2">{item.action_type ?? "-"}</td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", outcomeTone(item.outcome))}>
                      {item.outcome ?? "-"}
                    </span>
                  </td>
                  <td className={cn("px-3 py-2 tabular", fragTone(item.frag_before_pct, item.frag_after_pct))}>
                    {item.frag_before_pct?.toFixed(1) ?? "-"}% {"->"} {item.frag_after_pct?.toFixed(1) ?? "-"}%
                  </td>
                  <td className="px-3 py-2 tabular">{formatMs(item.duration_ms)}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{formatDetectedAt(item.started_at)}</td>
                  <td className="max-w-64 px-3 py-2 text-[11px] text-[var(--color-muted)]">{item.error ?? item.skip_reason ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && total > LIMIT && (
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2">
          <span className="text-[12px] text-[var(--color-muted)]">Page {page + 1} / {pages}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(0)}>&lt;&lt;</Button>
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>&lt;</Button>
            <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>&gt;</Button>
            <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>&gt;&gt;</Button>
          </div>
        </div>
      )}

      <RefreshingOverlay visible={isFetching && !isLoading} />
    </div>
  );
}
