import { useMemo, type ReactNode } from "react";
import type { WaitStatSummary } from "@layer3/core";
import { cn } from "@/lib/utils";
import { formatMs, waitCls } from "../planUtils";
import { GlossaryTip } from "../GlossaryTip";

interface PlanWaitStatsProps {
  waits: WaitStatSummary[];
}

export function PlanWaitStats({ waits }: PlanWaitStatsProps): ReactNode {
  const maxWaitMs = useMemo(() => Math.max(...waits.map((item) => item.ms), 0), [waits]);

  return (
    <div className="space-y-3">
      {waits.map((wait) => {
        const pct = maxWaitMs > 0 ? (wait.ms / maxWaitMs) * 100 : 0;
        return (
          <article key={`${wait.type}-${wait.count}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <div className="flex items-center gap-3">
              <span className={cn("font-code text-[12px] font-semibold", waitCls(wait.type))}>
                <GlossaryTip glossaryKey={wait.type.toLowerCase()}>{wait.type}</GlossaryTip>
              </span>
              <span className="font-code text-[12px] tabular text-[var(--color-text)]">{formatMs(wait.ms)}</span>
              <span className="text-[11px] text-[var(--color-muted)]">x{wait.count}</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-[var(--color-border)]">
              <div className={cn("h-2 rounded-full", barClass(pct))} style={{ width: `${Math.min(100, Math.max(6, pct))}%` }} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function barClass(pct: number): string {
  if (pct >= 75) return "bg-[var(--color-critical)]";
  if (pct >= 40) return "bg-[var(--color-warning)]";
  return "bg-[var(--color-success)]";
}

