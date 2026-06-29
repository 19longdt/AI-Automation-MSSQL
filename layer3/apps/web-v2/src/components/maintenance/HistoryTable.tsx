import { useEffect, useMemo, useState } from "react";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { MaintGlossaryTip } from "@/components/maintenance/MaintGlossaryTip";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useMaintenanceHistory } from "@/hooks/useMaintenance";
import { formatDetectedAt, formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { MaintenanceHistoryItem } from "@/types";

const LIMIT = 50;
const OUTCOME_OPTIONS = ["ALL", "DONE", "FAILED", "SKIPPED", "PAUSED", "ABORTED", "DRY_RUN"] as const;

const OUTCOME_LABELS: Record<(typeof OUTCOME_OPTIONS)[number], string> = {
  ALL: "All",
  DONE: "Done",
  FAILED: "Failed",
  SKIPPED: "Skipped",
  PAUSED: "Paused",
  ABORTED: "Aborted",
  DRY_RUN: "Dry run",
};


function StatementExpandRow({ statement, colSpan }: { statement: string; colSpan: number }) {
  return (
    <tr className="bg-[color-mix(in_srgb,var(--color-primary)_5%,var(--color-surface-2))]">
      <td
        colSpan={colSpan}
        className="py-2.5 pl-0 pr-4"
        style={{ borderLeft: "2px solid var(--color-primary)" }}
      >
        <div className="flex items-start gap-2.5 pl-3">
          <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
            T-SQL
          </span>
          <pre className="max-w-xl max-h-24 overflow-auto font-mono text-[11px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap break-all">
            {statement}
          </pre>
        </div>
      </td>
    </tr>
  );
}

function objectSubLabel(item: MaintenanceHistoryItem): string {
  const type = item.action_type?.toUpperCase();
  if (type === "UPDATE_STATISTICS") return item.stats_name ?? "Statistics";
  if (type === "HEAP_REBUILD") return "Heap table";
  return item.index_name ?? "-";
}

function transitionLabel(item: MaintenanceHistoryItem): string {
  if (item.previous_status && item.final_status) {
    return `${item.previous_status} -> ${item.final_status}`;
  }
  if (item.final_status) return item.final_status;
  return item.outcome ?? "-";
}

function fragTone(before: number | null, after: number | null): string {
  if (before == null || after == null) return "text-[var(--color-muted)]";
  return after < before ? "text-[var(--color-success)]" : "text-[var(--color-muted)]";
}

function outcomeTone(outcome: string | null): string {
  switch (outcome?.toUpperCase()) {
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

export function HistoryTable({
  campaignId,
  campaignName,
  embedded = false,
}: {
  campaignId?: string | null;
  campaignName?: string | null;
  embedded?: boolean;
}) {
  const [outcome, setOutcome] = useState<string>("ALL");
  const [page, setPage] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { selectedClusterId } = useDashboardStore();

  function toggleStatement(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filters = useMemo(
    () => ({
      outcome: outcome === "ALL" ? "" : outcome,
      page,
      limit: LIMIT,
      campaign_id: campaignId ?? undefined,
    }),
    [campaignId, outcome, page]
  );
  const { data, error, isLoading, isFetching, refetch } = useMaintenanceHistory(filters);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  useEffect(() => {
    setOutcome("ALL");
    setPage(0);
    setExpandedIds(new Set());
  }, [campaignId, selectedClusterId]);

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-surface)]",
        embedded ? "" : "rounded-lg border border-[var(--color-border)]",
      )}
    >
      <div className={cn("flex flex-col gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 lg:flex-row lg:items-center lg:justify-between", embedded ? "px-0" : "px-3")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="font-semibold text-[var(--color-text)]">Recent Events</span>
            {campaignName ? (
              <span className="text-[var(--color-muted)]">
                for <span className="font-medium text-[var(--color-text)]">{campaignName}</span>
              </span>
            ) : null}
            <span className="text-[var(--color-muted)]">{total} events</span>
          </div>
        </div>

        <Select
          value={outcome}
          onValueChange={(value) => {
            setOutcome(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="h-8 w-[156px] rounded-full bg-[var(--color-surface-2)] text-[12px]">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {OUTCOME_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--color-surface-2)] text-[var(--color-muted)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Object</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Transition</th>
              <th className="px-3 py-2 font-medium">
                <MaintGlossaryTip glossaryKey="frag_pct">Frag before &rarr; after</MaintGlossaryTip>
              </th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Finished</th>
              <th className="px-3 py-2 font-medium">Notes</th>
              <th className="px-3 py-2 font-medium">SQL</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t border-[var(--color-border)]">
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-3 py-2">
                      <Skeleton className="h-4 w-full max-w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={8} className="px-0 py-0">
                  <ErrorState
                    message="Failed to load history"
                    description={error instanceof Error ? error.message : "Unknown error"}
                    onRetry={() => void refetch()}
                  />
                </td>
              </tr>
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={8} className="px-0 py-0">
                  <EmptyState
                    title="No history"
                    description="No records match the current filter."
                  />
                </td>
              </tr>
            ) : (
              data.items.flatMap((item, index) => {
                const rowId = item.history_id ?? `row-${index}`;
                const isExpanded = expandedIds.has(rowId);
                const rows = [
                  <tr key={rowId} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--color-text)]">
                        {item.schema_name ?? "dbo"}.{item.table_name ?? "-"}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {objectSubLabel(item)}
                        {item.attempt_no > 0 ? <span className="ml-1.5 opacity-70">attempt {item.attempt_no}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">{item.action_type ?? "-"}</td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", outcomeTone(item.outcome))}>
                        {transitionLabel(item)}
                      </span>
                    </td>
                    <td className={cn("px-3 py-2 tabular", fragTone(item.frag_before_pct, item.frag_after_pct))}>
                      {item.frag_before_pct?.toFixed(1) ?? "-"}% &rarr; {item.frag_after_pct?.toFixed(1) ?? "-"}%
                    </td>
                    <td className="px-3 py-2 tabular">{formatMs(item.duration_ms)}</td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{formatDetectedAt(item.finished_at ?? item.started_at)}</td>
                    <td className="max-w-64 px-3 py-2 text-[11px] text-[var(--color-muted)]">{item.error ?? item.skip_reason ?? "-"}</td>
                    <td className="px-3 py-2">
                      {item.statement ? (
                        <button
                          type="button"
                          onClick={() => toggleStatement(rowId)}
                          className={cn(
                            "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                            isExpanded
                              ? "bg-[var(--color-primary)] text-white"
                              : "bg-[var(--color-surface-2)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-primary-soft)]"
                          )}
                        >
                          {isExpanded ? "Hide" : "Show"}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[var(--color-muted)]">-</span>
                      )}
                    </td>
                  </tr>,
                ];
                if (isExpanded && item.statement) {
                  rows.push(<StatementExpandRow key={`stmt-${rowId}`} statement={item.statement} colSpan={8} />);
                }
                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && total > LIMIT && (
        <div className={cn("flex items-center justify-between border-t border-[var(--color-border)] py-2", embedded ? "px-0" : "px-3")}>
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
