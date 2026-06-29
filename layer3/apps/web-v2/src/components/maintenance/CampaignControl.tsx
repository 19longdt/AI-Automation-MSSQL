import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  CheckCheck,
  Clock3,
  Flag,
  FolderOpen,
  Loader2,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  XCircle,
} from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { CampaignForm } from "@/components/maintenance/CampaignForm";
import { CampaignList } from "@/components/maintenance/CampaignList";
import { MaintGlossaryTip } from "@/components/maintenance/MaintGlossaryTip";
import { PipelineStages } from "@/components/maintenance/PipelineStages";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useBulkQueueAction, useCampaigns, useCreateCampaign, useCreateMaintenanceCommand, useUpdateCampaign } from "@/hooks/useMaintenance";
import { formatDetectedAt, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type {
  CampaignCreateBody,
  CampaignUpdateBody,
  MaintenanceCampaign,
  MaintenanceCampaignSummary,
} from "@/types";

function statusGlossaryKey(status: MaintenanceCampaign["status"]): string {
  const map: Partial<Record<NonNullable<MaintenanceCampaign["status"]>, string>> = {
    ACTIVE: "status_active",
    DISCOVERING: "status_discovering",
    DISCOVERY_FAILED: "status_discovery_failed",
    PENDING: "status_pending",
    COMPLETED: "status_completed",
    EXPIRED: "status_expired",
    CANCELLED: "status_cancelled",
  };
  if (!status) return "";
  return map[status] ?? "";
}

type CampaignEditMode = "edit" | "extend";

function campaignEditMode(status: MaintenanceCampaign["status"]): CampaignEditMode | null {
  if (status === "PENDING" || status === "DISCOVERY_FAILED") return "edit";
  if (status === "ACTIVE" || status === "EXPIRED") return "extend";
  return null;
}

type CampaignFilter =
  | "ALL"
  | "ACTIVE"
  | "DISCOVERING"
  | "DISCOVERY_FAILED"
  | "PENDING"
  | "COMPLETED"
  | "EXPIRED"
  | "CANCELLED";

function MetricChip({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: string;
  tone?: "success" | "critical" | "default";
}) {
  const valueClass =
    tone === "success"
      ? "text-[var(--color-success)]"
      : tone === "critical"
        ? "text-[var(--color-critical)]"
        : "text-[var(--color-text)]";

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface)_92%,transparent)] px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</div>
      <div className={cn("mt-0.5 text-[13px] font-semibold tabular", valueClass)}>{value}</div>
    </div>
  );
}

function progressBarClass(progress: number): string {
  if (progress >= 100) {
    return "bg-[linear-gradient(90deg,#d9f99d_0%,#22c55e_100%)]";
  }
  if (progress >= 35) {
    return "bg-[linear-gradient(90deg,#f8fafc_0%,#facc15_100%)]";
  }
  return "bg-[linear-gradient(90deg,#ffffff_0%,#e5e7eb_100%)]";
}

function statusTone(status: MaintenanceCampaign["status"]): string {
  switch (status) {
    case "ACTIVE":
      return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
    case "DISCOVERING":
      return "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";
    case "DISCOVERY_FAILED":
      return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
    case "COMPLETED":
      return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
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

function hasLiveCampaign(items: MaintenanceCampaign[]): boolean {
  return items.some((item) =>
    item.status === "ACTIVE" ||
    item.status === "DISCOVERING" ||
    item.status === "DISCOVERY_FAILED" ||
    item.status === "PENDING"
  );
}

export function pickPrimaryCampaign(items: MaintenanceCampaign[]): MaintenanceCampaign | null {
  const live = hasLiveCampaign(items);
  const order: Array<MaintenanceCampaign["status"]> = live
    ? ["ACTIVE", "DISCOVERING", "DISCOVERY_FAILED", "PENDING", "COMPLETED", "EXPIRED", "CANCELLED"]
    : ["COMPLETED", "EXPIRED", "CANCELLED", "ACTIVE", "DISCOVERING", "DISCOVERY_FAILED", "PENDING"];

  for (const status of order) {
    const found = items.find((item) => item.status === status);
    if (found) return found;
  }
  return items[0] ?? null;
}

function sortCampaigns(items: MaintenanceCampaign[]): MaintenanceCampaign[] {
  const live = hasLiveCampaign(items);
  const priority = new Map<MaintenanceCampaign["status"], number>(
    (live
      ? [
          ["ACTIVE", 0],
          ["DISCOVERING", 1],
          ["DISCOVERY_FAILED", 2],
          ["PENDING", 3],
          ["COMPLETED", 4],
          ["EXPIRED", 5],
          ["CANCELLED", 6],
        ]
      : [
          ["COMPLETED", 0],
          ["EXPIRED", 1],
          ["CANCELLED", 2],
          ["ACTIVE", 3],
          ["DISCOVERING", 4],
          ["DISCOVERY_FAILED", 5],
          ["PENDING", 6],
        ]) as Array<[MaintenanceCampaign["status"], number]>
  );

  return [...items].sort((a, b) => {
    const rankA = priority.get(a.status) ?? 99;
    const rankB = priority.get(b.status) ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
}

function CampaignMiniCard({
  campaign,
  selected,
  onSelect,
  onEdit,
}: {
  campaign: MaintenanceCampaign;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
}) {
  const progress = Math.max(0, Math.min(100, campaign.progress_pct ?? 0));

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group w-[248px] shrink-0 cursor-pointer rounded-lg border px-3 py-3 text-left transition-colors duration-150",
        selected
          ? "border-[var(--color-primary)] bg-[color:color-mix(in_srgb,var(--color-primary-soft)_28%,var(--color-surface)_72%)] shadow-sm"
          : "border-[var(--color-border)] bg-[var(--color-surface-2)] hover:bg-[var(--color-row-hover)]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold", statusTone(campaign.status))}>
            <StatusIcon status={campaign.status} />
            <span>{campaign.status ?? "UNKNOWN"}</span>
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="truncate text-[14px] font-semibold text-[var(--color-text)]">{campaign.name ?? "Unnamed campaign"}</div>
            <div className="truncate text-[11px] text-[var(--color-muted)]">
              {(campaign.start_date?.slice(0, 10) ?? "-")} - {(campaign.end_date?.slice(0, 10) ?? "-")}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onEdit ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              title="Edit campaign"
            >
              <Pencil className="h-3 w-3" />
            </button>
          ) : null}
          {selected ? <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
        <span className="uppercase tracking-[0.12em]">Progress</span>
        <span className="tabular text-[var(--color-text)]">{progress}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-surface)]">
        <div
          className={cn("h-full rounded-full", progressBarClass(progress))}
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      </div>
    </button>
  );
}

export function CampaignControl({
  selectedCampaignId,
  onSelectCampaignId,
  campaignSummary,
  isCampaignSummaryLoading = false,
}: {
  selectedCampaignId?: string | null;
  onSelectCampaignId?: (campaignId: string | null) => void;
  campaignSummary?: MaintenanceCampaignSummary | null;
  isCampaignSummaryLoading?: boolean;
}) {
  const [isListOpen, setIsListOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<MaintenanceCampaign | null>(null);
  const [editMode, setEditMode] = useState<CampaignEditMode>("edit");
  const [filter, setFilter] = useState<CampaignFilter>("ALL");
  const { selectedClusterId } = useDashboardStore();
  const { data, error, isLoading, isFetching, refetch } = useCampaigns({ page: 0, limit: 20 });
  const createMutation = useCreateCampaign();
  const updateMutation = useUpdateCampaign();
  const commandMutation = useCreateMaintenanceCommand();
  const bulkQueueActionMutation = useBulkQueueAction();

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const sortedItems = useMemo(() => sortCampaigns(items), [items]);
  const primaryCampaign = useMemo(() => pickPrimaryCampaign(sortedItems), [sortedItems]);
  const visibleItems = useMemo(
    () => (filter === "ALL" ? sortedItems : sortedItems.filter((item) => item.status === filter)),
    [filter, sortedItems]
  );
  const selectedCampaign = useMemo(() => {
    if (selectedCampaignId) {
      return sortedItems.find((item) => item.campaign_id === selectedCampaignId) ?? null;
    }
    return primaryCampaign;
  }, [sortedItems, primaryCampaign, selectedCampaignId]);
  const counts = useMemo(
    () => ({
      ALL: sortedItems.length,
      ACTIVE: sortedItems.filter((item) => item.status === "ACTIVE").length,
      DISCOVERING: sortedItems.filter((item) => item.status === "DISCOVERING").length,
      DISCOVERY_FAILED: sortedItems.filter((item) => item.status === "DISCOVERY_FAILED").length,
      PENDING: sortedItems.filter((item) => item.status === "PENDING").length,
      COMPLETED: sortedItems.filter((item) => item.status === "COMPLETED").length,
      EXPIRED: sortedItems.filter((item) => item.status === "EXPIRED").length,
      CANCELLED: sortedItems.filter((item) => item.status === "CANCELLED").length,
    }),
    [sortedItems]
  );
  const hasActiveCampaign = selectedCampaign?.status === "ACTIVE";
  const canRunDiscovery =
    selectedCampaign?.status === "PENDING" || selectedCampaign?.status === "DISCOVERY_FAILED";
  const period = selectedCampaign
    ? `${selectedCampaign.start_date?.slice(0, 10) ?? "-"} - ${selectedCampaign.end_date?.slice(0, 10) ?? "-"}`
    : "";

  async function handleCreate(payload: CampaignCreateBody | CampaignUpdateBody) {
    try {
      await createMutation.mutateAsync(payload as CampaignCreateBody);
      setIsCreateOpen(false);
    } catch {
      // toast handled in mutation hook
    }
  }

  async function handleUpdate(payload: CampaignCreateBody | CampaignUpdateBody) {
    if (!editingCampaign?.campaign_id) return;
    try {
      await updateMutation.mutateAsync({ id: editingCampaign.campaign_id, body: payload as CampaignUpdateBody });
      setIsEditOpen(false);
    } catch {
      // toast handled in mutation hook
    }
  }

  function openEdit(campaign: MaintenanceCampaign) {
    const mode = campaignEditMode(campaign.status);
    if (!mode) return;
    setEditMode(mode);
    setEditingCampaign(campaign);
    setIsEditOpen(true);
  }

  function handleRunDiscovery() {
    if (!selectedClusterId || commandMutation.isPending || !canRunDiscovery) return;
    commandMutation.mutate({ cluster_id: selectedClusterId, type: "run_discovery" });
  }

  function handleApproveAll() {
    if (!selectedClusterId || !selectedCampaign?.campaign_id || !campaignSummary?.approval.awaiting_count) return;
    bulkQueueActionMutation.mutate({
      action: "approve",
      cluster_id: selectedClusterId,
      campaign_id: selectedCampaign.campaign_id,
    });
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
              <MaintGlossaryTip glossaryKey="campaign">Campaign Context</MaintGlossaryTip>
            </h2>
            <p className="text-[12px] text-[var(--color-muted)]">
              Active campaign is auto-selected. Switch context by clicking any card below.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedClusterId || !canRunDiscovery || commandMutation.isPending}
              onClick={handleRunDiscovery}
              title={
                !selectedCampaign
                  ? "No campaign selected"
                  : !canRunDiscovery
                    ? `Discovery is not available in ${selectedCampaign.status ?? "current"} state`
                    : "Queue a discovery run immediately"
              }
            >
              {commandMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <MaintGlossaryTip glossaryKey="run_discovery">Run Discovery</MaintGlossaryTip>
            </Button>
            <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)} disabled={!selectedClusterId}>
              <Plus className="h-3.5 w-3.5" />
              Create
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsListOpen(true)} disabled={!selectedClusterId}>
              <FolderOpen className="h-3.5 w-3.5" />
              View All
            </Button>
          </div>
        </div>

        {!selectedClusterId ? (
          <EmptyState
            title="No cluster selected"
            description="Choose a cluster before managing maintenance campaigns."
          />
        ) : isLoading ? (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-24 rounded-full" />
              ))}
            </div>
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-40 w-[248px] rounded-lg" />
              ))}
            </div>
          </div>
        ) : error ? (
          <ErrorState
            message="Failed to load campaign context"
            description={error instanceof Error ? error.message : "Unknown error"}
            onRetry={() => void refetch()}
          />
        ) : !selectedCampaign ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-[var(--color-text)]">No campaign available</div>
              <div className="text-[12px] text-[var(--color-muted)]">
                Create the first campaign to switch maintenance into campaign-driven execution.
              </div>
            </div>
            <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
              Idle
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {([
                ["ALL", "All"],
                ["ACTIVE", "Active"],
                ["DISCOVERING", "Discovering"],
                ["DISCOVERY_FAILED", "Disc. Failed"],
                ["PENDING", "Pending"],
                ["COMPLETED", "Completed"],
                ["EXPIRED", "Expired"],
                ["CANCELLED", "Cancelled"],
              ] as Array<[CampaignFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1.5 text-[12px] transition-colors",
                    filter === value
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]"
                  )}
                >
                  <span>{label}</span>
                  <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-semibold tabular text-[var(--color-text)]">
                    {counts[value]}
                  </span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-full gap-3">
                {visibleItems.length ? (
                  visibleItems.map((campaign) => (
                    <CampaignMiniCard
                      key={campaign.campaign_id ?? campaign.name ?? "campaign"}
                      campaign={campaign}
                      selected={campaign.campaign_id === selectedCampaign?.campaign_id}
                      onSelect={() => onSelectCampaignId?.(campaign.campaign_id ?? null)}
                      onEdit={campaignEditMode(campaign.status) ? () => openEdit(campaign) : undefined}
                    />
                  ))
                ) : (
                  <div className="w-full rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-6 text-center text-[12px] text-[var(--color-muted)]">
                    No campaign matches the current status filter.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex flex-1 flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", statusTone(selectedCampaign.status))}>
                      <StatusIcon status={selectedCampaign.status} />
                      <MaintGlossaryTip glossaryKey={statusGlossaryKey(selectedCampaign.status)}>
                        {selectedCampaign.status ?? "UNKNOWN"}
                      </MaintGlossaryTip>
                      {selectedCampaign.status === "DISCOVERING" ? (
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-primary)] opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                        </span>
                      ) : null}
                    </span>
                    <h3 className="truncate text-[15px] font-semibold text-[var(--color-text)]">{selectedCampaign.name ?? "Unnamed campaign"}</h3>
                    <span className="text-[12px] text-[var(--color-muted)]">{period}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:max-w-[360px] xl:min-w-[320px]">
                    <MetricChip label={<MaintGlossaryTip glossaryKey="metric_done">Done</MaintGlossaryTip>} value={formatNumber(selectedCampaign.done_count)} tone="success" />
                    <MetricChip label={<MaintGlossaryTip glossaryKey="metric_total">Total</MaintGlossaryTip>} value={formatNumber(selectedCampaign.total_items)} />
                    <MetricChip
                      label={<MaintGlossaryTip glossaryKey="metric_remaining">Remain</MaintGlossaryTip>}
                      value={formatNumber(selectedCampaign.remaining_items)}
                      tone={selectedCampaign.remaining_items > 0 ? "default" : "success"}
                    />
                  </div>
                </div>

                <div className="min-w-[260px] space-y-2 xl:w-[320px] xl:pl-2">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Progress</div>
                      <div className="mt-0.5 text-[18px] font-semibold leading-none text-[var(--color-text)]">
                        <span className="tabular">{selectedCampaign.progress_pct}%</span>
                      </div>
                    </div>
                    <div className="text-right text-[12px] text-[var(--color-muted)]">
                      <div className="tabular text-[var(--color-text)]">
                        {formatNumber(selectedCampaign.done_count)}/{formatNumber(selectedCampaign.total_items)}
                      </div>
                      <div>Last updated {formatDetectedAt(selectedCampaign.updated_at)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {selectedCampaign.discovery_error ? (
                <p className="mt-3 rounded-md border border-[color:color-mix(in_srgb,var(--color-critical)_34%,var(--color-border)_66%)] bg-[color:color-mix(in_srgb,var(--color-critical-soft)_72%,transparent)] px-2.5 py-2 text-[12px] text-[var(--color-critical)]">
                  Discovery error: {selectedCampaign.discovery_error}
                </p>
              ) : null}

              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                {campaignSummary?.approval.awaiting_count ? (
                  <div className="mb-3 flex flex-col gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--color-warning)_28%,var(--color-border)_72%)] bg-[color:color-mix(in_srgb,var(--color-warning-soft)_72%,transparent)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[12px] font-semibold text-[var(--color-text)]">
                        {formatNumber(campaignSummary.approval.awaiting_count)} item(s) are awaiting approval
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        Approve the whole campaign directly from the web UI.
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleApproveAll}
                      disabled={!selectedClusterId || !selectedCampaign?.campaign_id}
                      loading={bulkQueueActionMutation.isPending}
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Approve All
                    </Button>
                  </div>
                ) : null}
                <PipelineStages
                  data={campaignSummary}
                  isLoading={Boolean(selectedCampaign.campaign_id) && isCampaignSummaryLoading && !campaignSummary}
                />
              </div>
            </div>
          </div>
        )}

        {isFetching && !isLoading ? (
          <div className="text-[12px] text-[var(--color-muted)]">Refreshing campaign context...</div>
        ) : null}
      </div>

      <CampaignForm
        open={isCreateOpen}
        mode="create"
        clusterId={selectedClusterId ?? ""}
        pending={createMutation.isPending}
        onOpenChange={setIsCreateOpen}
        onSubmit={handleCreate}
      />

      <CampaignForm
        open={isEditOpen}
        mode={editMode}
        clusterId={selectedClusterId ?? ""}
        campaign={editingCampaign}
        pending={updateMutation.isPending}
        onOpenChange={setIsEditOpen}
        onSubmit={handleUpdate}
      />

      <Dialog open={isListOpen} onOpenChange={setIsListOpen}>
        <DialogContent className="w-[min(96vw,1100px)] max-h-[88vh]">
          <DialogHeader>
            <DialogTitle>Campaign Library</DialogTitle>
          </DialogHeader>
          <DialogBody className="p-4">
            <CampaignList />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
