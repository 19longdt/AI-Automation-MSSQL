import type { MemoryGrantSummary } from "@layer3/core";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlossaryTip } from "../GlossaryTip";
import { fmtKbOrMb } from "../planUtils";

interface PlanMemoryGrantProps {
  grant: MemoryGrantSummary;
}

export function PlanMemoryGrant({ grant }: PlanMemoryGrantProps): ReactNode {
  const usedPct = grant.max_used_kb != null && grant.granted_kb > 0 ? (grant.max_used_kb / grant.granted_kb) * 100 : 0;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <div className="grid gap-2 text-[12px] md:grid-cols-3">
        <Metric label="Granted" glossaryKey="memory_grant" value={fmtKbOrMb(grant.granted_kb)} />
        <Metric
          label="Used"
          glossaryKey="memory_grant"
          value={`${fmtKbOrMb(grant.max_used_kb)}${grant.max_used_kb != null ? ` (${usedPct.toFixed(0)}%)` : ""}`}
          valueClassName={usedPct >= 90 ? "text-[var(--color-critical)]" : usedPct >= 50 ? "text-[var(--color-warning)]" : "text-[var(--color-success)]"}
        />
        <Metric label="Wait" glossaryKey="resource_semaphore" value={`${grant.grant_wait_ms.toLocaleString()} ms`} />
      </div>
      <div className="relative mt-3 h-3 rounded-full bg-[var(--color-border)]">
        <div className={cn("h-3 rounded-full", barClass(usedPct))} style={{ width: `${Math.min(100, usedPct)}%` }} />
        <span className="absolute inset-y-0 w-px bg-[var(--color-warning)]" style={{ left: "50%" }} aria-hidden="true" />
        <span className="absolute inset-y-0 w-px bg-[var(--color-critical)]" style={{ left: "90%" }} aria-hidden="true" />
      </div>
    </div>
  );
}

function Metric({ label, glossaryKey, value, valueClassName }: { label: string; glossaryKey: string; value: string; valueClassName?: string }): ReactNode {
  return (
    <div className="rounded-md bg-[var(--color-surface)] px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
        <GlossaryTip glossaryKey={glossaryKey}>{label}</GlossaryTip>
      </p>
      <p className={cn("mt-1 font-code tabular text-[var(--color-text)]", valueClassName)}>{value}</p>
    </div>
  );
}

function barClass(pct: number): string {
  if (pct >= 90) return "bg-[var(--color-critical)]";
  if (pct >= 50) return "bg-[var(--color-warning)]";
  return "bg-[var(--color-success)]";
}
