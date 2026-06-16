import { useMemo, type ReactNode } from "react";
import type { IOStatSummary } from "@layer3/core";
import { cn } from "@/lib/utils";
import { GlossaryTip } from "../GlossaryTip";
import { fmtReads } from "../planUtils";

interface PlanIoStatsProps {
  stats: IOStatSummary[];
}

export function PlanIoStats({ stats }: PlanIoStatsProps): ReactNode {
  const maxLogicalReads = useMemo(() => Math.max(...stats.map((item) => item.logical_reads), 0), [stats]);

  return (
    <div className="space-y-3">
      {stats.slice(0, 12).map((stat, index) => {
        const pct = maxLogicalReads > 0 ? (stat.logical_reads / maxLogicalReads) * 100 : 0;
        return (
          <article key={`${stat.node_id}-${index}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-text)]">
                {stat.physical_op}: {stat.table_name ?? "-"}{stat.index_name ? ` / ${stat.index_name}` : ""}
              </span>
              {index === 0 && (
                <span className="ml-auto rounded-full bg-[color:color-mix(in_srgb,var(--color-warning)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                  Highest
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <Chip label="log" glossaryKey="logical_reads" value={fmtReads(stat.logical_reads)} tone={barTone(pct)} />
              {stat.physical_reads > 0 && <Chip label="phys" glossaryKey="physical_reads" value={fmtReads(stat.physical_reads)} tone="text-[var(--color-critical)]" />}
              {stat.read_ahead_reads > 0 && <Chip label="RA" glossaryKey="read_ahead" value={fmtReads(stat.read_ahead_reads)} tone="text-[var(--color-info)]" />}
              {stat.scan_count > 0 && <Chip label="scans" glossaryKey="scan_count" value={fmtReads(stat.scan_count)} tone="text-[var(--color-text)]" />}
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

function Chip({ label, glossaryKey, value, tone }: { label: string; glossaryKey: string; value: string; tone: string }): ReactNode {
  return (
    <span className={cn("rounded-full bg-[var(--color-surface)] px-2 py-1 font-code tabular", tone)}>
      <GlossaryTip glossaryKey={glossaryKey}>{label}</GlossaryTip>: {value}
    </span>
  );
}

function barClass(pct: number): string {
  if (pct >= 75) return "bg-[var(--color-critical)]";
  if (pct >= 40) return "bg-[var(--color-warning)]";
  if (pct >= 15) return "bg-[var(--color-success)]";
  return "bg-[var(--color-muted)]";
}

function barTone(pct: number): string {
  if (pct >= 75) return "text-[var(--color-critical)]";
  if (pct >= 40) return "text-[var(--color-warning)]";
  if (pct >= 15) return "text-[var(--color-success)]";
  return "text-[var(--color-text)]";
}
