import { useFindings } from "@/hooks/useFindings";
import { useDashboardStore } from "@/store/dashboard.store";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { getTopicRowRenderer } from "@/components/dashboard/FindingRow";

export function FindingsTable({ useOuterScroll = false }: { useOuterScroll?: boolean }) {
  const { activeTopicId, page, setPage, filters, setFilters } = useDashboardStore();
  const { data, isLoading, error, refetch } = useFindings();
  const Renderer = getTopicRowRenderer(activeTopicId);
  const filteredItems = (data?.items ?? []).filter((finding) => {
    if (!filters.replica) return true;
    const replica = String((finding.metrics ?? {})?.replica_server_name ?? "");
    return replica === filters.replica;
  });
  const total = filters.replica ? filteredItems.length : (data?.total ?? 0);
  const limit = 15;
  const pages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = !!(filters.severity || filters.alertStatus || filters.blockingStatus || filters.replica);

  return (
    <div
      className={
        useOuterScroll
          ? "bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden flex flex-col"
          : "bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden min-h-0 h-full flex flex-col"
      }
    >
      {hasFilters && (
        <div className="flex justify-end px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            Clear filters
          </Button>
        </div>
      )}

      <div className={useOuterScroll ? "overflow-x-auto" : "flex-1 min-h-0 overflow-auto overscroll-contain"}>
        <table className="min-w-full w-max border-collapse text-[12px] leading-tight">
          <thead className="sticky top-0 bg-[var(--color-surface-2)] z-10">
            <Renderer.Header />
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <Skeleton className="h-4 rounded" style={{ width: `${60 + (j * 20) % 80}px` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={10}>
                  <ErrorState
                    message="Failed to load findings"
                    description={error instanceof Error ? error.message : "Unknown error"}
                    onRetry={() => void refetch()}
                  />
                </td>
              </tr>
            ) : !filteredItems.length ? (
              <tr>
                <td colSpan={10}>
                  <EmptyState
                    title="No findings"
                    description={
                      hasFilters
                        ? "No findings match your current filters and time range."
                        : "No findings detected in this time range."
                    }
                    action={hasFilters ? { label: "Clear filters", onClick: () => setFilters({}) } : undefined}
                  />
                </td>
              </tr>
            ) : (
              filteredItems.map((finding) => (
                <Renderer.Row
                  key={finding.finding_id}
                  finding={finding}
                  onOpen={() => {}}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && total > limit && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <span className="text-[12px] text-[var(--color-muted)]">
            Page {page + 1} of {pages}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(0)}>&lt;&lt;</Button>
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>&lt; Prev</Button>
            <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next &gt;</Button>
            <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>&gt;&gt;</Button>
          </div>
        </div>
      )}
    </div>
  );
}
