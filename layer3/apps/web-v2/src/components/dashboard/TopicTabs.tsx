import { useDashboardStore } from "@/store/dashboard.store";
import { cn } from "@/lib/utils";
import type { MonitorTopic } from "@/types";

interface Props {
  topics: MonitorTopic[];
  criticalByTopic?: Record<string, number>;
}

export function TopicTabs({ topics, criticalByTopic = {} }: Props) {
  const { activeTopicId, setActiveTopicId } = useDashboardStore();

  if (!topics.length) return null;

  return (
    <div
      role="tablist"
      aria-label="Monitor topics"
      className="flex items-end gap-0 border-b border-[var(--color-border)] scrollbar-none shrink-0"
    >
      {topics.map((t) => {
        const active = t.topic_id === activeTopicId;
        const critCount = criticalByTopic[t.topic_id] ?? 0;
        return (
          <button
            key={t.topic_id}
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${t.topic_id}`}
            onClick={() => setActiveTopicId(t.topic_id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium whitespace-nowrap",
              "border-b-2 -mb-px transition-colors duration-150 cursor-pointer shrink-0",
              active
                ? "text-[var(--color-primary)] border-[var(--color-primary)]"
                : "text-[var(--color-muted)] border-transparent hover:text-[var(--color-text)] hover:bg-[var(--color-row-hover)]",
            )}
          >
            {t.topic_id.replace(/_/g, " ")}

            {/* Alert dot for topics with critical findings */}
            {critCount > 0 && !active && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[var(--color-critical)] animate-pulse"
                aria-label={`${critCount} critical findings`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
