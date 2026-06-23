import type { ReactNode } from "react";
import { ArrowRight, BarChart2, Calendar, CheckCircle2, ListOrdered } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDetectedAt, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MaintenanceSummary } from "@/types";

function StageCard({
  icon,
  eyebrow,
  title,
  line1,
  line2,
  tone,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  line1: string;
  line2: string;
  tone?: string;
}) {
  return (
    <div
      className={cn(
        "group rounded-[18px] border bg-[var(--color-surface)] p-2.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_var(--color-shadow-sm)]",
        tone ? "shadow-[0_0_0_1px_color-mix(in_srgb,currentColor_18%,transparent)]" : "border-[var(--color-border)]"
      )}
      style={tone ? { color: tone, borderColor: tone } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">{eyebrow}</div>
          <div className="mt-1 text-[14px] font-semibold text-[var(--color-text)]" style={tone ? { color: tone } : undefined}>
            {title}
          </div>
        </div>
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] text-[var(--color-text)]"
          style={tone ? { color: tone, background: "color-mix(in srgb, currentColor 10%, transparent)" } : undefined}
        >
          {icon}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <p className="text-sm font-medium text-[var(--color-text)]">{line1}</p>
        <p className="text-[13px] leading-5 text-[var(--color-muted)]">{line2}</p>
      </div>
    </div>
  );
}

interface Props {
  data?: MaintenanceSummary;
  isLoading?: boolean;
}

export function PipelineStages({ data, isLoading = false }: Props) {
  if (isLoading) {
    return (
      <div className="grid gap-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="mt-3 h-5 w-32 rounded-full" />
            <Skeleton className="mt-6 h-4 w-40 rounded-full" />
            <Skeleton className="mt-2 h-4 w-28 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  const counts = data?.queue_counts ?? {};
  const approved = counts.approved ?? 0;
  const running = counts.running ?? 0;
  const paused = counts.paused ?? 0;
  const done = counts.done ?? 0;
  const failed = counts.failed ?? 0;
  const awaiting = counts.awaiting_approval ?? 0;
  const lastBatch = data?.last_batch;
  const lastScan = data?.last_scan_job;

  const stages = [
    {
      eyebrow: "Step 1",
      title: "Scan",
      icon: <Calendar className="h-4 w-4" />,
      line1: lastScan?.ran_at ? `Last scan ${formatDetectedAt(lastScan.ran_at)}` : "No scan recorded yet",
      line2: `${formatNumber(lastScan?.records_processed ?? 0)} candidate items detected`,
      tone: undefined,
    },
    {
      eyebrow: "Step 2",
      title: "Approval",
      icon: <CheckCircle2 className="h-4 w-4" />,
      line1: lastBatch?.status ?? "No batch available",
      line2: `${lastBatch?.decision ?? "Pending decision"} - ${formatNumber(lastBatch?.item_count ?? 0)} items`,
      tone: awaiting > 0 ? "var(--color-warning)" : undefined,
    },
    {
      eyebrow: "Step 3",
      title: "Queue",
      icon: <ListOrdered className="h-4 w-4" />,
      line1: `${approved} approved - ${running} running`,
      line2: `${paused} paused and waiting for the next window`,
      tone: running > 0 ? "var(--color-primary)" : undefined,
    },
    {
      eyebrow: "Step 4",
      title: "Results",
      icon: <BarChart2 className="h-4 w-4" />,
      line1: `${done} done - ${failed} failed`,
      line2: failed === 0 ? "No execution errors reported." : "Investigate failed actions in history.",
      tone: failed === 0 ? "var(--color-success)" : "var(--color-critical)",
    },
  ];

  return (
      <div className="grid gap-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] xl:items-stretch">
      {stages.map((stage, index) => (
        <div key={stage.title} className="contents">
          <StageCard {...stage} />
          {index < stages.length - 1 && (
            <div className="hidden items-center justify-center text-[var(--color-subtle)] xl:flex" aria-hidden="true">
              <ArrowRight className="h-4 w-4" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
