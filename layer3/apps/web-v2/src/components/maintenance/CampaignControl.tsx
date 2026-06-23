import { useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, CheckCircle2, Clock3, Flag, FolderOpen, PauseCircle, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { CampaignForm } from "@/components/maintenance/CampaignForm";
import { CampaignList } from "@/components/maintenance/CampaignList";
import { useCampaigns, useCreateCampaign } from "@/hooks/useMaintenance";
import { formatDetectedAt, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { CampaignCreateBody, CampaignUpdateBody, MaintenanceCampaign } from "@/types";

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
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
    <div className="rounded-xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface)_92%,transparent)] px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</div>
      <div className={cn("mt-0.5 text-[13px] font-semibold tabular", valueClass)}>{value}</div>
    </div>
  );
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

function pickPrimaryCampaign(items: MaintenanceCampaign[]): MaintenanceCampaign | null {
  const order: Array<MaintenanceCampaign["status"]> = ["ACTIVE", "DISCOVERING", "DISCOVERY_FAILED", "PENDING", "EXPIRED", "COMPLETED", "CANCELLED"];
  for (const status of order) {
    const found = items.find((item) => item.status === status);
    if (found) return found;
  }
  return items[0] ?? null;
}

export function CampaignControl() {
  const [isListOpen, setIsListOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { selectedClusterId } = useDashboardStore();
  const { data, error, isLoading, isFetching, refetch } = useCampaigns({ page: 0, limit: 20 });
  const createMutation = useCreateCampaign();

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const primaryCampaign = useMemo(() => pickPrimaryCampaign(items), [items]);
  const hasActiveCampaign = primaryCampaign?.status === "ACTIVE";
  const period = primaryCampaign
    ? `${primaryCampaign.start_date?.slice(0, 10) ?? "-"} - ${primaryCampaign.end_date?.slice(0, 10) ?? "-"}`
    : "";

  async function handleCreate(payload: CampaignCreateBody | CampaignUpdateBody) {
    try {
      await createMutation.mutateAsync(payload as CampaignCreateBody);
      setIsCreateOpen(false);
    } catch {
      // mutation toast already shown
    }
  }

  return (
    <>
      <section className="rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <div className="flex flex-col gap-2 border-b border-[var(--color-border)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text)]">Campaign Control</h2>
            <p className="text-[12px] text-[var(--color-muted)]">Active campaign and execution progress.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              disabled={!selectedClusterId}
            >
              <Plus className="h-3.5 w-3.5" />
              Create Campaign
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsListOpen(true)}
              disabled={!selectedClusterId}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              View All
            </Button>
          </div>
        </div>

        <div className="px-3 py-2 sm:px-4">
          {!selectedClusterId ? (
            <EmptyState
              title="No cluster selected"
              description="Choose a cluster before controlling maintenance campaigns."
            />
          ) : isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : error ? (
            <ErrorState
              message="Failed to load campaign control"
              description={error instanceof Error ? error.message : "Unknown error"}
              onRetry={() => void refetch()}
            />
          ) : !primaryCampaign ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface-2)_78%,transparent)] px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[var(--color-text)]">No active campaign</div>
                <div className="text-[12px] text-[var(--color-muted)]">Queue execution stays idle until a campaign is scheduled.</div>
              </div>
              <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                Idle
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-surface)_0%,color-mix(in_srgb,var(--color-surface-2)_72%,transparent)_100%)] px-3 py-2.5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", statusTone(primaryCampaign.status))}>
                      <StatusIcon status={primaryCampaign.status} />
                      {primaryCampaign.status ?? "UNKNOWN"}
                    </span>
                    <h3 className="truncate text-[15px] font-semibold text-[var(--color-text)]">{primaryCampaign.name ?? "Unnamed campaign"}</h3>
                    <span className="text-[12px] text-[var(--color-muted)]">{period}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:max-w-[360px]">
                    <MetricChip label="Done" value={formatNumber(primaryCampaign.done_count)} tone="success" />
                    <MetricChip label="Total" value={formatNumber(primaryCampaign.total_items)} />
                    <MetricChip label="Remain" value={formatNumber(primaryCampaign.remaining_items)} tone={primaryCampaign.remaining_items > 0 ? "default" : "success"} />
                  </div>
                </div>

                <div className="min-w-[260px] space-y-2 xl:w-[320px]">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Progress</div>
                      <div className="mt-0.5 text-[18px] font-semibold leading-none text-[var(--color-text)]">
                        <span className="tabular">{primaryCampaign.progress_pct}%</span>
                      </div>
                    </div>
                    <div className="text-right text-[12px] text-[var(--color-muted)]">
                      <div className="tabular text-[var(--color-text)]">{formatNumber(primaryCampaign.done_count)}/{formatNumber(primaryCampaign.total_items)}</div>
                      <div>Updated {formatDetectedAt(primaryCampaign.updated_at)}</div>
                    </div>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-200",
                        hasActiveCampaign
                          ? "bg-[linear-gradient(90deg,var(--color-primary)_0%,var(--color-success)_100%)]"
                          : "bg-[linear-gradient(90deg,var(--color-warning)_0%,var(--color-critical)_100%)]"
                      )}
                      style={{ width: `${Math.max(0, Math.min(100, primaryCampaign.progress_pct))}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </div>

              {primaryCampaign.discovery_error ? (
                <p className="mt-3 rounded-xl border border-[color:color-mix(in_srgb,var(--color-critical)_34%,var(--color-border)_66%)] bg-[color:color-mix(in_srgb,var(--color-critical-soft)_72%,transparent)] px-2.5 py-2 text-[12px] text-[var(--color-critical)]">
                  Discovery error: {primaryCampaign.discovery_error}
                </p>
              ) : null}
            </div>
          )}

          {isFetching && !isLoading ? (
            <div className="pt-2 text-[12px] text-[var(--color-muted)]">Refreshing campaign control...</div>
          ) : null}
        </div>
      </section>

      <CampaignForm
        open={isCreateOpen}
        mode="create"
        clusterId={selectedClusterId ?? ""}
        pending={createMutation.isPending}
        onOpenChange={setIsCreateOpen}
        onSubmit={handleCreate}
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
