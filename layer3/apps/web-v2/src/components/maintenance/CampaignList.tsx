import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, CheckCircle2, Clock3, Flag, PauseCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignForm } from "@/components/maintenance/CampaignForm";
import {
  useCampaigns,
  useCancelCampaign,
  useCreateCampaign,
  useUpdateCampaign,
} from "@/hooks/useMaintenance";
import { formatDetectedAt, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { CampaignCreateBody, CampaignUpdateBody, MaintenanceCampaign } from "@/types";

const LIMIT = 20;

type FormMode = "create" | "edit" | "extend";

function statusTone(status: MaintenanceCampaign["status"]): string {
  switch (status) {
    case "ACTIVE":
      return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
    case "DISCOVERING":
      return "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";
    case "DISCOVERY_FAILED":
      return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
    case "COMPLETED":
      return "bg-[color:color-mix(in_srgb,var(--color-success-soft)_55%,white_45%)] text-[var(--color-success)]";
    case "EXPIRED":
      return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
    case "CANCELLED":
      return "bg-[var(--color-surface-2)] text-[var(--color-muted)]";
    default:
      return "bg-[var(--color-surface-2)] text-[var(--color-muted)]";
  }
}

function StatusIcon({ status }: { status: MaintenanceCampaign["status"] }) {
  switch (status) {
    case "ACTIVE":
      return <Flag className="h-3.5 w-3.5" />;
    case "DISCOVERING":
      return <Clock3 className="h-3.5 w-3.5" />;
    case "DISCOVERY_FAILED":
      return <AlertTriangle className="h-3.5 w-3.5" />;
    case "COMPLETED":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "EXPIRED":
      return <PauseCircle className="h-3.5 w-3.5" />;
    case "CANCELLED":
      return <XCircle className="h-3.5 w-3.5" />;
    default:
      return <CalendarRange className="h-3.5 w-3.5" />;
  }
}

function canCancel(status: MaintenanceCampaign["status"]): boolean {
  return status === "PENDING" || status === "ACTIVE" || status === "DISCOVERY_FAILED";
}

function primaryAction(modeStatus: MaintenanceCampaign["status"]): FormMode | null {
  if (modeStatus === "PENDING" || modeStatus === "DISCOVERY_FAILED") return "edit";
  if (modeStatus === "ACTIVE" || modeStatus === "EXPIRED") return "extend";
  return null;
}

function actionLabel(mode: FormMode | null): string {
  if (mode === "edit") return "Edit";
  if (mode === "extend") return "Extend";
  return "";
}

export function CampaignList() {
  const [page, setPage] = useState(0);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<MaintenanceCampaign | null>(null);
  const [pendingCancel, setPendingCancel] = useState<MaintenanceCampaign | null>(null);
  const { selectedClusterId } = useDashboardStore();
  const { data, error, isLoading, isFetching, refetch } = useCampaigns({ page, limit: LIMIT });
  const createMutation = useCreateCampaign();
  const updateMutation = useUpdateCampaign();
  const cancelMutation = useCancelCampaign();

  useEffect(() => {
    setPage(0);
    setIsFormOpen(false);
    setEditingCampaign(null);
    setPendingCancel(null);
  }, [selectedClusterId]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const activeMutationPending = createMutation.isPending || updateMutation.isPending;

  const items = useMemo(() => data?.items ?? [], [data?.items]);

  function openCreate() {
    setFormMode("create");
    setEditingCampaign(null);
    setIsFormOpen(true);
  }

  function openAction(campaign: MaintenanceCampaign, mode: FormMode) {
    setFormMode(mode);
    setEditingCampaign(campaign);
    setIsFormOpen(true);
  }

  async function handleSubmit(payload: CampaignCreateBody | CampaignUpdateBody) {
    if (formMode === "create") {
      await createMutation.mutateAsync(payload as CampaignCreateBody);
      setIsFormOpen(false);
      return;
    }
    if (!editingCampaign?.campaign_id) return;
    await updateMutation.mutateAsync({ id: editingCampaign.campaign_id, body: payload as CampaignUpdateBody });
    setIsFormOpen(false);
  }

  async function handleCancel() {
    if (!pendingCancel?.campaign_id) return;
    try {
      await cancelMutation.mutateAsync(pendingCancel.campaign_id);
      setPendingCancel(null);
    } catch {
      // Mutation hook already shows a toast.
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-col gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Campaigns</p>
            <h3 className="text-[15px] font-semibold text-[var(--color-text)]">Maintenance Campaigns</h3>
            <p className="text-[12px] text-[var(--color-muted)]">
              One discovery builds the queue, then nightly execution drains that snapshot only.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-muted)]">{formatNumber(total)} campaigns</span>
            <Button variant="primary" size="sm" onClick={openCreate} disabled={!selectedClusterId}>
              Create Campaign
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {!selectedClusterId ? (
          <EmptyState
            title="No cluster selected"
            description="Choose a cluster before managing maintenance campaigns."
          />
        ) : isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-[var(--color-border)] p-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-5/6" />
              </div>
              ))}
          </div>
        ) : error ? (
          <ErrorState
            message="Failed to load campaigns"
            description={error instanceof Error ? error.message : "Unknown error"}
            onRetry={() => void refetch()}
          />
        ) : !items.length ? (
          <EmptyState
            title="No campaigns"
            description="Create the first campaign for this cluster to switch maintenance from ad-hoc nightly scans to discovery-based execution."
            action={{ label: "Create campaign", onClick: openCreate }}
          />
        ) : (
          <>
            <div className="space-y-3">
              {items.map((campaign) => {
                const action = primaryAction(campaign.status);
                const period = `${campaign.start_date?.slice(0, 10) ?? "-"} - ${campaign.end_date?.slice(0, 10) ?? "-"}`;
                return (
                  <article
                    key={campaign.campaign_id ?? `${campaign.name}-${campaign.created_at}`}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", statusTone(campaign.status))}>
                            <StatusIcon status={campaign.status} />
                            {campaign.status ?? "UNKNOWN"}
                          </span>
                          <h4 className="text-[15px] font-semibold text-[var(--color-text)]">{campaign.name ?? "Untitled campaign"}</h4>
                          <span className="text-[12px] text-[var(--color-muted)]">{period}</span>
                        </div>
                        {campaign.description ? (
                          <p className="text-[13px] text-[var(--color-muted)]">{campaign.description}</p>
                        ) : null}
                        <div className="grid gap-2 text-[12px] text-[var(--color-muted)] sm:grid-cols-2 xl:grid-cols-4">
                          <span>Total: <span className="tabular text-[var(--color-text)]">{formatNumber(campaign.total_items)}</span></span>
                          <span>Done: <span className="tabular text-[var(--color-success)]">{formatNumber(campaign.done_count)}</span></span>
                          <span>Failed: <span className="tabular text-[var(--color-critical)]">{formatNumber(campaign.failed_count)}</span></span>
                          <span>Remaining: <span className="tabular text-[var(--color-text)]">{formatNumber(campaign.remaining_items)}</span></span>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {action ? (
                          <Button size="sm" variant="outline" onClick={() => openAction(campaign, action)}>
                            {actionLabel(action)}
                          </Button>
                        ) : null}
                        {canCancel(campaign.status) ? (
                          <Button size="sm" variant="danger" onClick={() => setPendingCancel(campaign)}>
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-primary)_0%,var(--color-success)_100%)] transition-[width] duration-200"
                          style={{ width: `${Math.max(0, Math.min(100, campaign.progress_pct))}%` }}
                          aria-hidden="true"
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-muted)]">
                        <span>{campaign.progress_pct}% complete</span>
                        <span>Updated {formatDetectedAt(campaign.updated_at)}</span>
                      </div>
                      {campaign.discovery_error ? (
                        <p className="rounded-md border border-[var(--color-critical-soft)] bg-[color:color-mix(in_srgb,var(--color-critical-soft)_55%,transparent)] px-2.5 py-2 text-[12px] text-[var(--color-critical)]">
                          Discovery error: {campaign.discovery_error}
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            {total > LIMIT ? (
              <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2">
                <span className="text-[12px] text-[var(--color-muted)]">Page {page + 1} / {pages}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(0)}>&lt;&lt;</Button>
                  <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((prev) => prev - 1)}>&lt;</Button>
                  <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setPage((prev) => prev + 1)}>&gt;</Button>
                  <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>&gt;&gt;</Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <CampaignForm
        open={isFormOpen}
        mode={formMode}
        clusterId={selectedClusterId ?? ""}
        campaign={editingCampaign}
        pending={activeMutationPending}
        onOpenChange={setIsFormOpen}
        onSubmit={handleSubmit}
      />

      <Dialog open={!!pendingCancel} onOpenChange={(open) => !open && setPendingCancel(null)}>
        <DialogContent className="w-[min(92vw,460px)]">
          <DialogHeader>
            <DialogTitle>Cancel Campaign</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-sm text-[var(--color-text)]">
              Cancel campaign <span className="font-semibold">{pendingCancel?.name ?? "-"}</span>?
            </p>
            <p className="text-[13px] text-[var(--color-muted)]">
              This keeps existing queue/history data, but execution will stop because the campaign becomes cancelled.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingCancel(null)} disabled={cancelMutation.isPending}>
              Close
            </Button>
            <Button variant="danger" onClick={() => void handleCancel()} loading={cancelMutation.isPending}>
              Cancel Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isFetching && !isLoading ? (
        <div className="px-3 pb-3 text-[12px] text-[var(--color-muted)]">Refreshing campaigns...</div>
      ) : null}
    </div>
  );
}
