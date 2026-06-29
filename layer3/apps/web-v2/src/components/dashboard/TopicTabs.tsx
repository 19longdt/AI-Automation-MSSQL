import type { LucideIcon } from "lucide-react";
import { Activity, AlertOctagon, ArrowDownUp, Clock3, DatabaseZap, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { MonitorTopic } from "@/types";

interface Props {
  topics: MonitorTopic[];
  criticalByTopic?: Record<string, number>;
  warnByTopic?: Record<string, boolean>;
}

const TOPIC_ICONS: Record<string, LucideIcon> = {
  slow_sessions: Activity,
  blocking_chain: ArrowDownUp,
  deadlock: AlertOctagon,
  ag_health: ShieldAlert,
  ag_redo_secondary: Clock3,
  tempdb_memory: DatabaseZap,
  ple_trend: Activity,
};

function formatTopicLabel(topic: MonitorTopic) {
  return topic.name?.trim() || topic.topic_id.replace(/_/g, " ");
}

export function TopicTabs({ topics, criticalByTopic = {}, warnByTopic = {} }: Props) {
  const { activeTopicId, setActiveTopicId } = useDashboardStore();

  if (!topics.length) return null;

  return (
    <div
      role="tablist"
      aria-label="Monitor topics"
      className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-sm scrollbar-none"
    >
      {topics.map((topic) => {
        const active = topic.topic_id === activeTopicId;
        const critCount = criticalByTopic[topic.topic_id] ?? 0;
        const warn = warnByTopic[topic.topic_id] ?? false;
        const Icon = TOPIC_ICONS[topic.topic_id] ?? Activity;

        return (
          <button
            key={topic.topic_id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${topic.topic_id}`}
            onClick={() => setActiveTopicId(topic.topic_id)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium whitespace-nowrap",
              "cursor-pointer transition-colors duration-150 motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
              active
                ? warn
                  ? "bg-amber-500/12 text-amber-600"
                  : "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                : warn
                  ? "text-amber-600 hover:bg-amber-500/10 hover:text-amber-700"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-text)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{formatTopicLabel(topic)}</span>

            {warn ? (
              <span
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500"
                aria-label="No secondary replica detected"
              />
            ) : null}

            {critCount > 0 && !warn ? (
              <span
                className={cn(
                  "absolute right-1.5 top-1.5 h-2 w-2 rounded-full",
                  active ? "bg-[var(--color-critical)]/80" : "bg-[var(--color-critical)]",
                )}
                aria-label={`${critCount} critical findings`}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
