import { useEffect, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
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

export function DashboardPage() {
  const { data: topics } = useTopics();
  const { data: timeline, isLoading: timelineLoading, isFetching: timelineFetching } = useTimeline();
  const { activeTopicId, setActiveTopicId } = useDashboardStore();
  const [showSlowQueryStats, setShowSlowQueryStats] = useState(false);

  // Set first topic as default once topics load
  useEffect(() => {
    if (!activeTopicId && topics?.length) {
      const defaultTopic = topics.find((t) => t.topic_id === "slow_sessions") ?? topics[0];
      setActiveTopicId(defaultTopic.topic_id);
    }
  }, [topics, activeTopicId, setActiveTopicId]);

  const showBlockingFilter = activeTopicId === "slow_sessions";
  const showAgHealthPreview = activeTopicId === "ag_health";
  const showAgRedoPreview = activeTopicId === "ag_redo_secondary";
  const showTempdbPreview = activeTopicId === "tempdb_memory";
  const showPleTrendPreview = activeTopicId === "ple_trend";
  const showSlowSessionStats = activeTopicId === "slow_sessions";

  return (
    <PageShell className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      {/* Topic tabs */}
      <TopicTabs topics={topics ?? []} />

      {/* Filter bar */}
      <FilterBar showBlockingFilter={showBlockingFilter} />

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
            <AgHealthPreview />
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
