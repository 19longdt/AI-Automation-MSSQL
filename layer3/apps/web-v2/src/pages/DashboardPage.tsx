import { useEffect } from "react";
import { useTopics } from "@/hooks/useTopics";
import { useTimeline } from "@/hooks/useTimeline";
import { useDashboardStore } from "@/store/dashboard.store";
import { PageShell } from "@/components/layout/PageShell";
import { TopicTabs } from "@/components/dashboard/TopicTabs";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { AgHealthPreview } from "@/components/dashboard/AgHealthPreview";
import { AgRedoSecondaryPreview } from "@/components/dashboard/AgRedoSecondaryPreview";
import { TimelineChart } from "@/components/dashboard/TimelineChart";
import { FindingsTable } from "@/components/dashboard/FindingsTable";

export function DashboardPage() {
  const { data: topics } = useTopics();
  const { data: timeline, isLoading: timelineLoading } = useTimeline();
  const { activeTopicId, setActiveTopicId } = useDashboardStore();

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
      ) : (
        <>
          {/* KPI row */}
          <KpiCards />

          {/* Timeline chart */}
          <TimelineChart data={timeline} isLoading={timelineLoading} />

          {/* Findings table */}
          <div className="flex-1 min-h-0">
            <FindingsTable />
          </div>
        </>
      )}
    </PageShell>
  );
}
