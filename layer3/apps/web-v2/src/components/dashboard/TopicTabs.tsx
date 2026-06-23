import { useDashboardStore } from "@/store/dashboard.store";
import { cn } from "@/lib/utils";
import type { MonitorTopic } from "@/types";

interface Props {
  topics: MonitorTopic[];
  criticalByTopic?: Record<string, number>;
  warnByTopic?: Record<string, boolean>;
}

export function TopicTabs({ topics, criticalByTopic = {}, warnByTopic = {} }: Props) {
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
        const warn = warnByTopic[t.topic_id] ?? false;
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
                ? warn
                  ? "text-amber-500 border-amber-500"
                  : "text-[var(--color-primary)] border-[var(--color-primary)]"
                : warn
                  ? "text-amber-500/80 border-amber-500/60 hover:text-amber-500 hover:bg-[var(--color-row-hover)]"
                  : "text-[var(--color-muted)] border-transparent hover:text-[var(--color-text)] hover:bg-[var(--color-row-hover)]",
            )}
          >
            {t.topic_id.replace(/_/g, " ")}

            {/* Warning dot — no secondary replica */}
            {warn && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-500"
                aria-label="No secondary replica detected"
              />
            )}

            {/* Critical dot — only show when no warn dot */}
            {critCount > 0 && !active && !warn && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[var(--color-critical)]"
                aria-label={`${critCount} critical findings`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
