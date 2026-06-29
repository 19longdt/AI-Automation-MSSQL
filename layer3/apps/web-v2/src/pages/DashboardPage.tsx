import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { useTopics } from "@/hooks/useTopics";
import { useTimeline } from "@/hooks/useTimeline";
import { useDashboardStore } from "@/store/dashboard.store";
import { PageShell } from "@/components/layout/PageShell";
import { TopicTabs } from "@/components/dashboard/TopicTabs";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { Button } from "@/components/ui/button";
import { AgHealthPreview } from "@/components/dashboard/AgHealthPreview";
import { AgRedoSecondaryPreview } from "@/components/dashboard/AgRedoSecondaryPreview";
import { TempdbMemoryPreview } from "@/components/dashboard/TempdbMemoryPreview";
import { PleTrendPreview } from "@/components/dashboard/PleTrendPreview";
import { SlowQueryStatsTable } from "@/components/dashboard/SlowQueryStatsTable";
import { TimelineChart } from "@/components/dashboard/TimelineChart";
import { FindingsTable } from "@/components/dashboard/FindingsTable";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import type { AgSecondaryStatus } from "@/types";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: topics } = useTopics();
  const { data: timeline, isLoading: timelineLoading, isFetching: timelineFetching } = useTimeline();
  const { activeTopicId, setActiveTopicId, selectedClusterId, timeRange, refreshNow } = useDashboardStore();
  const [showSlowQueryStats, setShowSlowQueryStats] = useState(false);

  const { data: secondaryStatus } = useQuery({
    queryKey: qk.agSecondaryStatus(selectedClusterId ?? null),
    queryFn: () => apiGet<AgSecondaryStatus>("/api/findings/ag-secondary-status", {
      cluster_id: selectedClusterId ?? "",
    }),
    staleTime: 30_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  const noSecondary = secondaryStatus?.status === "no_secondary";

  // Set first topic as default once topics load
  useEffect(() => {
    if (!activeTopicId && topics?.length) {
      const defaultTopic = topics.find((t) => t.topic_id === "slow_sessions") ?? topics[0];
      setActiveTopicId(defaultTopic.topic_id);
    }
  }, [topics, activeTopicId, setActiveTopicId]);

  useEffect(() => {
    if (!activeTopicId) {
      return;
    }

    setShowSlowQueryStats(false);

    if (timeRange.mode !== "absolute") {
      refreshNow();
      return;
    }

    void queryClient.invalidateQueries({ type: "active" });
  }, [activeTopicId, selectedClusterId, timeRange.mode, refreshNow, queryClient]);

  const showBlockingFilter = activeTopicId === "slow_sessions";
  const showAgHealthPreview = activeTopicId === "ag_health";
  const showAgRedoPreview = activeTopicId === "ag_redo_secondary";
  const showTempdbPreview = activeTopicId === "tempdb_memory";
  const showPleTrendPreview = activeTopicId === "ple_trend";
  const showSlowSessionStats = activeTopicId === "slow_sessions";

  return (
    <PageShell className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      {/* Topic tabs */}
      <TopicTabs topics={topics ?? []} warnByTopic={noSecondary ? { ag_health: true } : {}} />

      {/* Filter bar */}
      <FilterBar showBlockingFilter={showBlockingFilter} />

      {/* AG secondary warning banner — chỉ hiển thị khi đang ở tab ag_health */}
      {noSecondary && showAgHealthPreview && (
        <div className="flex shrink-0 items-start gap-3 rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-3 shadow-sm">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-amber-600 dark:text-amber-400">
              Secondary replica không khả dụng
            </p>
            <p className="mt-0.5 text-[12px] text-amber-600/80 dark:text-amber-400/80">
              Không phát hiện secondary replica trong 2 phút gần nhất — cụm có thể đang chạy chỉ với Primary.
            </p>
          </div>
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
        </div>
      )}

      {showAgRedoPreview ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="flex min-h-full flex-col gap-3 pb-1">
            <KpiCards />
            <AgRedoSecondaryPreview />
            <div className="min-h-[420px] shrink-0">
              <FindingsTable useOuterScroll />
            </div>
          </div>
        </div>
      ) : showAgHealthPreview ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="flex min-h-full flex-col gap-3 pb-1">
            <KpiCards />
            <AgHealthPreview noSecondary={noSecondary} />
            <div className="min-h-[520px] shrink-0">
              <FindingsTable useOuterScroll />
            </div>
          </div>
        </div>
      ) : showPleTrendPreview ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="flex min-h-full flex-col gap-3 pb-1">
            <KpiCards />
            <PleTrendPreview />
            <div className="min-h-[420px] shrink-0">
              <FindingsTable useOuterScroll />
            </div>
          </div>
        </div>
      ) : showTempdbPreview ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="flex min-h-full flex-col gap-3 pb-1">
            <KpiCards />
            <TempdbMemoryPreview />
            <div className="min-h-[420px] shrink-0">
              <FindingsTable useOuterScroll />
            </div>
          </div>
        </div>
      ) : showSlowSessionStats ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="flex min-h-full flex-col gap-3 pb-1">
            <KpiCards />
            <TimelineChart data={timeline} isLoading={timelineLoading} isFetching={timelineFetching} />
            <div className="flex items-center justify-end">
              <Button
                variant={showSlowQueryStats ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowSlowQueryStats((current) => !current)}
                className="gap-1.5"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                {showSlowQueryStats ? "Hide Top Query" : "Open Top Query"}
                {showSlowQueryStats ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {showSlowQueryStats ? <SlowQueryStatsTable /> : null}
            <div className="min-h-[420px] shrink-0">
              <FindingsTable useOuterScroll />
            </div>
          </div>
        </div>
      ) : (
        <>
          <KpiCards />
          <TimelineChart data={timeline} isLoading={timelineLoading} isFetching={timelineFetching} />
          <div className="flex-1 min-h-0">
            <FindingsTable />
          </div>
        </>
      )}
    </PageShell>
  );
}
