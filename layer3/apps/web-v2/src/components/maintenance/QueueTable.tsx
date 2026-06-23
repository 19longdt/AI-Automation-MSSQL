import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { Skeleton } from "@/components/ui/skeleton";
import { useMaintenanceQueue } from "@/hooks/useMaintenance";
import { formatDetectedAt, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";

const LIMIT = 50;
const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "AWAITING_APPROVAL", label: "Awaiting approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "RUNNING", label: "Running" },
  { value: "PAUSED", label: "Paused" },
  { value: "DONE", label: "Done" },
  { value: "FAILED", label: "Failed" },
] as const;

function formatMinutes(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(1)}m`;
}

function actionTone(actionType: string | null): string {
  switch (actionType) {
    case "REBUILD":
    case "REBUILD_PARTITION":
      return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
    case "REORGANIZE":
      return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
    case "UPDATE_STATISTICS":
      return "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";
    default:
      return "bg-[var(--color-surface-2)] text-[var(--color-muted)]";
  }
}

function rowTone(status: string | null): string {
  switch (status) {
    case "RUNNING":
      return "border-l-2 border-[var(--color-primary)] bg-[color:color-mix(in_srgb,var(--color-primary-soft)_45%,transparent)]";
    case "PAUSED":
      return "border-l-2 border-[var(--color-warning)]";
    case "FAILED":
      return "border-l-2 border-[var(--color-critical)]";
    default:
      return "";
  }
}

export function QueueTable() {
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(0);
  const { selectedClusterId } = useDashboardStore();
  const filters = useMemo(() => ({ status, page, limit: LIMIT }), [status, page]);
  const { data, error, isLoading, isFetching, refetch } = useMaintenanceQueue(filters);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  useEffect(() => {
    setStatus("");
    setPage(0);
  }, [selectedClusterId]);

  return (
    <div className="relative min-h-0 overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-surface)_0%,color-mix(in_srgb,var(--color-surface-2)_55%,white_45%)_100%)] px-3 py-2">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-[15px] font-semibold text-[var(--color-text)]">Execution Queue</h3>
            </div>
            <div className="text-sm text-[var(--color-muted)]">
              {formatNumber(total)} items
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value || "all"}
                type="button"
                onClick={() => {
                  setStatus(tab.value);
                  setPage(0);
                }}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors",
                  status === tab.value
                    ? "bg-[var(--color-primary)] text-white shadow-sm"
                    : "bg-[var(--color-surface)] text-[var(--color-muted)] ring-1 ring-inset ring-[var(--color-border)] hover:text-[var(--color-text)]"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--color-surface-2)] text-[var(--color-muted)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Object</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Frag %</th>
              <th className="px-3 py-2 font-medium">Pages</th>
              <th className="px-3 py-2 font-medium">Estimate</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t border-[var(--color-border)]">
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-3 py-2">
                      <Skeleton className="h-4 w-full max-w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={9} className="px-0 py-0">
                  <ErrorState
                    message="Failed to load maintenance queue"
                    description={error instanceof Error ? error.message : "Unknown error"}
                    onRetry={() => void refetch()}
                  />
                </td>
              </tr>
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={9} className="px-0 py-0">
                  <EmptyState
                    title="Queue is empty"
                    description="No maintenance item matches the current filter."
                  />
                </td>
              </tr>
            ) : (
              data.items.map((item, index) => (
                <tr key={item.item_id ?? `${item.short_id}-${index}`} className={cn("border-t border-[var(--color-border)]", rowTone(item.status))}>
                  <td className="px-3 py-2 text-[var(--color-muted)] tabular">{page * LIMIT + index + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-[var(--color-text)]">
                      {item.schema_name ?? "dbo"}.{item.table_name ?? "-"}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {item.index_name ?? "Heap"} - {item.short_id ?? "-"} - {formatDetectedAt(item.created_at)}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", actionTone(item.action_type))}>
                      {item.action_type ?? "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular">{item.fragmentation_pct?.toFixed(1) ?? "-"}</td>
                  <td className="px-3 py-2 tabular">{formatNumber(item.page_count)}</td>
                  <td className="px-3 py-2 tabular">{formatMinutes(item.estimated_minutes)}</td>
                  <td className="px-3 py-2 tabular">{item.priority?.toFixed(1) ?? "-"}</td>
                  <td className="px-3 py-2">{item.status ?? "-"}</td>
                  <td className="max-w-64 px-3 py-2 text-[11px] text-[var(--color-muted)]">{item.last_error ?? "-"}</td>
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
