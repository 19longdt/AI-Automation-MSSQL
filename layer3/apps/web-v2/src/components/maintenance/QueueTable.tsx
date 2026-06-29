import { useEffect, useMemo, useState } from "react";
import { Ban, Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { MaintGlossaryTip } from "@/components/maintenance/MaintGlossaryTip";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useMaintenanceQueue, useQueueItemAction } from "@/hooks/useMaintenance";
import { formatDetectedAt, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { MaintenanceQueueItem, QueueItemAction } from "@/types";

const LIMIT = 50;
const STATUS_TABS = [
  { value: "", label: "All", glossaryKey: undefined },
  { value: "AWAITING_APPROVAL", label: "Awaiting", glossaryKey: "status_awaiting" },
  { value: "APPROVED", label: "Ready", glossaryKey: "status_approved" },
  { value: "RUNNING", label: "Running", glossaryKey: "status_running" },
  { value: "PAUSED", label: "Paused", glossaryKey: "status_paused" },
  { value: "DONE", label: "Done", glossaryKey: undefined },
  { value: "FAILED", label: "Failed", glossaryKey: undefined },
] as const;

function formatMinutes(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(1)}m`;
}

function objectSubLabel(item: MaintenanceQueueItem): string {
  const type = item.action_type?.toUpperCase();
  if (type === "UPDATE_STATISTICS") return item.stats_name ?? "Statistics";
  if (type === "HEAP_REBUILD" || item.kind?.toUpperCase() === "HEAP_FORWARDED") return "Heap table";
  return item.index_name ?? "-";
}

function actionTone(actionType: string | null): string {
  switch (actionType?.toUpperCase()) {
    case "REBUILD":
    case "REBUILD_PARTITION":
      return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
    case "REORGANIZE":
      return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
    case "UPDATE_STATISTICS":
      return "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";
    case "HEAP_REBUILD":
      return "bg-[var(--color-surface-2)] text-[var(--color-text-2)]";
    default:
      return "bg-[var(--color-surface-2)] text-[var(--color-muted)]";
  }
}

function statusTone(status: string | null): string {
  switch (status?.toUpperCase()) {
    case "DONE":
      return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
    case "RUNNING":
      return "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";
    case "FAILED":
      return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
    case "PAUSED":
    case "AWAITING_APPROVAL":
      return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
    case "APPROVED":
      return "bg-[var(--color-surface-2)] text-[var(--color-text)]";
    default:
      return "bg-[var(--color-surface-2)] text-[var(--color-muted)]";
  }
}

function rowTone(status: string | null): string {
  switch (status?.toUpperCase()) {
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

export function QueueTable({
  campaignId,
  campaignName,
  embedded = false,
}: {
  campaignId?: string | null;
  campaignName?: string | null;
  embedded?: boolean;
}) {
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ itemId: string; action: QueueItemAction } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ item: MaintenanceQueueItem; action: "reject" | "skip" } | null>(null);
  const { selectedClusterId } = useDashboardStore();
  const filters = useMemo(
    () => ({ status, page, limit: LIMIT, campaign_id: campaignId ?? undefined }),
    [campaignId, page, status]
  );
  const { data, error, isLoading, isFetching, refetch } = useMaintenanceQueue(filters);
  const queueItemActionMutation = useQueueItemAction();
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  useEffect(() => {
    setStatus("");
    setPage(0);
  }, [campaignId, selectedClusterId]);

  async function executeItemAction(item: MaintenanceQueueItem, action: QueueItemAction) {
    if (!item.item_id) return;
    setPendingAction({ itemId: item.item_id, action });
    try {
      await queueItemActionMutation.mutateAsync({ itemId: item.item_id, action });
    } finally {
      setPendingAction(null);
    }
  }

  function actionButtons(item: MaintenanceQueueItem) {
    const itemId = item.item_id;
    const isLoadingAction = (action: QueueItemAction) =>
      queueItemActionMutation.isPending && pendingAction?.itemId === itemId && pendingAction.action === action;

    switch (item.status?.toUpperCase()) {
      case "AWAITING_APPROVAL":
        return (
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="primary"
              size="sm"
              className="h-6 px-2 text-[11px]"
              loading={isLoadingAction("approve")}
              onClick={() => void executeItemAction(item, "approve")}
              disabled={!itemId}
            >
              <Check className="h-3 w-3" />
              Approve
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="h-6 px-2 text-[11px]"
              loading={isLoadingAction("reject")}
              onClick={() => setConfirmAction({ item, action: "reject" })}
              disabled={!itemId}
            >
              <X className="h-3 w-3" />
              Reject
            </Button>
          </div>
        );
      case "APPROVED":
        return (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            loading={isLoadingAction("skip")}
            onClick={() => setConfirmAction({ item, action: "skip" })}
            disabled={!itemId}
          >
            <Ban className="h-3 w-3" />
            Skip
          </Button>
        );
      case "FAILED":
      case "REJECTED":
        return (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            loading={isLoadingAction("reset")}
            onClick={() => void executeItemAction(item, "reset")}
            disabled={!itemId}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        );
      default:
        return <span className="text-[11px] text-[var(--color-muted)]">-</span>;
    }
  }

  const confirmLabel = confirmAction?.item.short_id ?? confirmAction?.item.item_id ?? "this item";

  return (
    <>
      <div
        className={cn(
          "relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-surface)]",
          embedded ? "" : "rounded-lg border border-[var(--color-border)]",
        )}
      >
        <div className={cn("bg-[var(--color-surface)] py-2.5", embedded ? "border-b border-[var(--color-border)] px-0" : "border-b border-[var(--color-border)] px-3")}>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className="font-semibold text-[var(--color-text)]">Queue Items</span>
                {campaignName ? (
                  <span className="text-[var(--color-muted)]">
                    for <span className="font-medium text-[var(--color-text)]">{campaignName}</span>
                  </span>
                ) : null}
                <span className="text-[var(--color-muted)]">{formatNumber(total)} items</span>
              </div>
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
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
                      : "bg-[var(--color-surface-2)] text-[var(--color-muted)] ring-1 ring-inset ring-[var(--color-border)] hover:text-[var(--color-text)]"
                  )}
                >
                  {tab.glossaryKey ? <MaintGlossaryTip glossaryKey={tab.glossaryKey}>{tab.label}</MaintGlossaryTip> : tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[var(--color-surface-2)] text-[var(--color-muted)]">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Object</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">
                  <MaintGlossaryTip glossaryKey="frag_pct">Frag %</MaintGlossaryTip>
                </th>
                <th className="px-3 py-2 font-medium">
                  <MaintGlossaryTip glossaryKey="estimated_minutes">Est.</MaintGlossaryTip>
                </th>
                <th className="px-3 py-2 font-medium">
                  <MaintGlossaryTip glossaryKey="priority">Priority</MaintGlossaryTip>
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Actions</th>
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
                      message="Failed to load queue"
                      description={error instanceof Error ? error.message : "Unknown error"}
                      onRetry={() => void refetch()}
                    />
                  </td>
                </tr>
              ) : !data?.items.length ? (
                <tr>
                  <td colSpan={8} className="px-0 py-0">
                    <EmptyState
                      title="Queue is empty"
                      description="No items match the current filter."
                    />
                  </td>
                </tr>
              ) : (
                data.items.map((item, index) => (
                  <tr key={item.item_id ?? `${item.short_id}-${index}`} className={cn("border-t border-[var(--color-border)]", rowTone(item.status))}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--color-text)]">
                        {item.schema_name ?? "dbo"}.{item.table_name ?? "-"}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {objectSubLabel(item)}
                        {item.short_id ? <span className="ml-1.5 opacity-60">#{item.short_id}</span> : null}
                        {item.created_at ? <span className="ml-1.5 opacity-60">queued {formatDetectedAt(item.created_at)}</span> : null}
                      </div>
                      {item.last_error ? (
                        <div className="mt-1 text-[11px] text-[var(--color-critical)]">{item.last_error}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", actionTone(item.action_type))}>
                        {item.action_type ?? "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular text-[var(--color-muted)]">
                      {item.fragmentation_pct != null ? `${item.fragmentation_pct.toFixed(1)}%` : "-"}
                    </td>
                    <td className="px-3 py-2 tabular">{formatMinutes(item.estimated_minutes)}</td>
                    <td className="px-3 py-2 tabular text-[var(--color-muted)]">{item.priority ?? "-"}</td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone(item.status))}>
                        {item.status ?? "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{formatDetectedAt(item.updated_at ?? item.created_at)}</td>
                    <td className="px-3 py-2">{actionButtons(item)}</td>
                  </tr>
                ))
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

      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <DialogContent className="w-[min(92vw,420px)]">
          <DialogHeader>
            <DialogTitle>{confirmAction?.action === "reject" ? "Confirm Reject" : "Confirm Skip"}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-2 text-[13px] text-[var(--color-text-2)]">
            <p>
              {confirmAction?.action === "reject"
                ? `Confirm reject item ${confirmLabel}?`
                : `Confirm skip item ${confirmLabel}?`}
            </p>
            <p className="text-[12px] text-[var(--color-muted)]">
              {confirmAction?.action === "reject"
                ? "This item will move to REJECTED and stop progressing."
                : "This item will move to SKIPPED and stop progressing."}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmAction?.action === "reject" ? "danger" : "outline"}
              loading={Boolean(confirmAction && queueItemActionMutation.isPending)}
              onClick={async () => {
                if (!confirmAction) return;
                const next = confirmAction;
                setConfirmAction(null);
                await executeItemAction(next.item, next.action);
              }}
            >
              {confirmAction?.action === "reject" ? "Reject" : "Skip"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
