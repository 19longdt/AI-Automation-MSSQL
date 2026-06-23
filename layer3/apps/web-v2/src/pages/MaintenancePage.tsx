import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HistoryTable } from "@/components/maintenance/HistoryTable";
import { PipelineStages } from "@/components/maintenance/PipelineStages";
import { QueueTable } from "@/components/maintenance/QueueTable";
import { WindowStatusBar } from "@/components/maintenance/WindowStatusBar";
import { CampaignControl } from "@/components/maintenance/CampaignControl";
import { PageShell } from "@/components/layout/PageShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMaintenanceSummary } from "@/hooks/useMaintenance";
import { useDashboardStore } from "@/store/dashboard.store";

export function MaintenancePage() {
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const { selectedClusterId } = useDashboardStore();
  const queryClient = useQueryClient();
  const { data: summary, isLoading, isFetching } = useMaintenanceSummary();

  useEffect(() => {
    setTab("queue");
  }, [selectedClusterId]);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-history"] });
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  }, [queryClient, selectedClusterId]);

  return (
    <PageShell className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <section className="relative overflow-hidden rounded-[18px] border border-[var(--color-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary-soft)_82%,white_18%)_0%,var(--color-surface)_48%,color-mix(in_srgb,var(--color-success-soft)_70%,white_30%)_100%)] px-3 py-3 shadow-[0_8px_24px_var(--color-shadow-sm)]">
        <div className="absolute right-[-42px] top-[-52px] h-28 w-28 rounded-full bg-[color:color-mix(in_srgb,var(--color-primary)_14%,transparent)] blur-3xl" aria-hidden="true" />
        <div className="absolute bottom-[-46px] left-[-28px] h-20 w-20 rounded-full bg-[color:color-mix(in_srgb,var(--color-success)_12%,transparent)] blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <span className="inline-flex w-fit items-center rounded-full border border-[color:color-mix(in_srgb,var(--color-primary)_16%,transparent)] bg-[color:color-mix(in_srgb,var(--color-surface)_78%,transparent)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-primary)]">
              Maintenance Control
            </span>
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-tight text-[var(--color-text)]">
                Index and Statistics Maintenance
              </h1>
              <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--color-muted)]">
                Track nightly scan, approvals, execution queue, and result history for the active cluster.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <MetricCard label="Awaiting" value={summary?.queue_counts.awaiting_approval ?? 0} />
            <MetricCard label="Running" value={summary?.queue_counts.running ?? 0} />
            <MetricCard label="Done" value={summary?.queue_counts.done ?? 0} tone="var(--color-success)" />
            <MetricCard label="Failed" value={summary?.queue_counts.failed ?? 0} tone="var(--color-critical)" />
          </div>
        </div>
      </section>

      <WindowStatusBar data={summary?.window} isLoading={isLoading && !summary} />

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col gap-2 pb-1">
          <PipelineStages data={summary} isLoading={isLoading && !summary} />
          <CampaignControl />

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as "queue" | "history")}
            className="min-h-0 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 sm:px-4">
              <h2 className="text-[15px] font-semibold leading-none tracking-[-0.02em] text-[var(--color-text)]">
                Operations Detail
              </h2>
              <TabsList className="shrink-0 self-end border-b-0">
                <TabsTrigger value="queue">Queue</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="queue" className="px-3 py-2 sm:px-4">
              <QueueTable />
            </TabsContent>
            <TabsContent value="history" className="px-3 py-2 sm:px-4">
              <HistoryTable />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {isFetching ? <span className="sr-only">Refreshing maintenance summary</span> : null}
    </PageShell>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface)_88%,transparent)] px-2.5 py-2 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">{label}</div>
      <div className="mt-0.5 text-base font-semibold" style={{ color: tone ?? "var(--color-text)" }}>
        {value}
      </div>
    </div>
  );
}
