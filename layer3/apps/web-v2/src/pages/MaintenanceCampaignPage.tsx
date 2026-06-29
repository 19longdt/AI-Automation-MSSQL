import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CampaignControl, pickPrimaryCampaign } from "@/components/maintenance/CampaignControl";
import { HistoryTable } from "@/components/maintenance/HistoryTable";
import { MaintenanceSubNav } from "@/components/maintenance/MaintenanceSubNav";
import { QueueTable } from "@/components/maintenance/QueueTable";
import { WindowStatusBar } from "@/components/maintenance/WindowStatusBar";
import { PageShell } from "@/components/layout/PageShell";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useCampaignSummary, useCampaigns, useMaintenanceSummary } from "@/hooks/useMaintenance";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";

type SubTab = "queue" | "history";

export function MaintenanceCampaignPage() {
  const [subTab, setSubTab] = useState<SubTab>("queue");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const { selectedClusterId } = useDashboardStore();
  const queryClient = useQueryClient();
  const { data: summary, isLoading, isFetching } = useMaintenanceSummary();

  const { data: campaignData } = useCampaigns({ page: 0, limit: 20 });
  const campaigns = campaignData?.items ?? [];
  const hasCritical = campaigns.some((c) => c.status === "DISCOVERY_FAILED");
  const fallbackCampaign = useMemo(() => pickPrimaryCampaign(campaigns), [campaigns]);
  const selectedCampaign = useMemo(() => {
    if (selectedCampaignId) {
      return campaigns.find((campaign) => campaign.campaign_id === selectedCampaignId) ?? fallbackCampaign ?? null;
    }
    return fallbackCampaign ?? null;
  }, [campaigns, fallbackCampaign, selectedCampaignId]);

  useEffect(() => {
    setSubTab("queue");
    setSelectedCampaignId(null);
  }, [selectedClusterId]);

  useEffect(() => {
    if (!campaigns.length) {
      if (selectedCampaignId !== null) setSelectedCampaignId(null);
      return;
    }
    if (selectedCampaignId && campaigns.some((campaign) => campaign.campaign_id === selectedCampaignId)) {
      return;
    }
    const nextCampaignId = fallbackCampaign?.campaign_id ?? null;
    if (selectedCampaignId !== nextCampaignId) {
      setSelectedCampaignId(nextCampaignId);
    }
  }, [campaigns, fallbackCampaign, selectedCampaignId]);

  const {
    data: campaignSummary,
    isLoading: isCampaignSummaryLoading,
    isFetching: isCampaignSummaryFetching,
  } = useCampaignSummary(selectedCampaign?.campaign_id ?? null);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-campaign-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-history"] });
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  }, [queryClient, selectedClusterId]);

  return (
    <PageShell className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <MaintenanceSubNav hasCriticalCampaign={hasCritical} />

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col gap-2 pb-1">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 shadow-sm sm:px-4">
            <CampaignControl
              selectedCampaignId={selectedCampaignId}
              onSelectCampaignId={setSelectedCampaignId}
              campaignSummary={campaignSummary}
              isCampaignSummaryLoading={Boolean(selectedCampaign?.campaign_id) && isCampaignSummaryLoading}
            />
          </div>

          <WindowStatusBar clusterId={selectedClusterId} data={summary?.window} isLoading={isLoading && !summary} />

          <Tabs
            value={subTab}
            onValueChange={(v) => setSubTab(v as SubTab)}
            className="flex h-[520px] min-h-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
          >
            <div className="border-b border-[var(--color-border)] px-3 py-2.5 sm:px-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-[15px] font-semibold text-[var(--color-text)]">Execution</p>
                    {selectedCampaign?.name ? (
                      <p className="text-[12px] text-[var(--color-muted)]">
                        Context: <span className="font-medium text-[var(--color-text)]">{selectedCampaign.name}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="relative inline-grid w-fit shrink-0 grid-cols-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-lg bg-[var(--color-primary-soft)] ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--color-primary)_22%,transparent)]",
                      "transition-transform duration-250 ease-out",
                      subTab === "history" ? "translate-x-full" : "translate-x-0",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setSubTab("queue")}
                    className={cn(
                      "relative z-10 inline-flex min-w-[88px] items-center justify-center rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
                      subTab === "queue"
                        ? "text-[var(--color-primary)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
                    )}
                  >
                    Queue
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubTab("history")}
                    className={cn(
                      "relative z-10 inline-flex min-w-[88px] items-center justify-center rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
                      subTab === "history"
                        ? "text-[var(--color-primary)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
                    )}
                  >
                    History
                  </button>
                </div>
              </div>
            </div>
            <TabsContent value="queue" className="min-h-0 flex-1 px-3 py-2.5 transition-opacity duration-200 data-[state=active]:opacity-100 data-[state=inactive]:opacity-0 sm:px-4">
              <QueueTable
                campaignId={selectedCampaign?.campaign_id ?? null}
                campaignName={selectedCampaign?.name ?? null}
                embedded
              />
            </TabsContent>
            <TabsContent value="history" className="min-h-0 flex-1 px-3 py-2.5 transition-opacity duration-200 data-[state=active]:opacity-100 data-[state=inactive]:opacity-0 sm:px-4">
              <HistoryTable
                campaignId={selectedCampaign?.campaign_id ?? null}
                campaignName={selectedCampaign?.name ?? null}
                embedded
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {isFetching || isCampaignSummaryFetching ? <span className="sr-only">Refreshing maintenance summary</span> : null}
    </PageShell>
  );
}
