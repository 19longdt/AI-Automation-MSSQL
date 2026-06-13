import { useMemo, type ReactNode } from "react";
import type { OperatorSummary } from "@layer3/core";
import { cn } from "@/lib/utils";
import { GlossaryTip } from "../GlossaryTip";
import { nullableNum, opDisplayName } from "../planUtils";

interface PlanRowEstProps {
  operators: OperatorSummary[];
}

export function PlanRowEst({ operators }: PlanRowEstProps): ReactNode {
  const mismatches = useMemo(() => {
    return [...operators]
      .filter((item) => item.has_row_est_off && item.actual_rows != null && item.estimated_rows > 0)
      .sort((left, right) => mismatchScore(right) - mismatchScore(left));
  }, [operators]);

  return (
    <div className="space-y-3">
      {mismatches.map((operator) => {
        const ratio = operator.actual_rows != null && operator.estimated_rows > 0 ? operator.actual_rows / operator.estimated_rows : null;
        const magnitude = ratio == null ? 0 : Math.max(ratio, 1 / Math.max(ratio, 0.0001));
        const width = Math.min(100, Math.max(8, magnitude * 10));

        return (
          <article key={operator.node_id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-text)]">{opDisplayName(operator)}</span>
              <span className="ml-auto font-code text-[12px] tabular text-[var(--color-critical)]">{formatRatio(ratio)}</span>
            </div>
            <div className="mt-2 grid gap-2 text-[12px] md:grid-cols-3">
              <Metric label="Est Rows" glossaryKey="estimated_rows" value={nullableNum(operator.estimated_rows, 0)} />
              <Metric label="Act Rows" glossaryKey="actual_rows" value={nullableNum(operator.actual_rows, 0)} />
              <Metric label="Ratio" glossaryKey="row_est_ratio" value={formatRatio(ratio)} valueClassName="text-[var(--color-critical)]" />
            </div>
            <div className="mt-3 h-2 rounded-full bg-[var(--color-border)]">
              <div className="h-2 rounded-full bg-[var(--color-critical)]" style={{ width: `${width}%` }} />
            </div>
          </article>
        );
      })}
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

function mismatchScore(operator: OperatorSummary): number {
  if (operator.actual_rows == null || operator.estimated_rows <= 0) return 0;
  const ratio = operator.actual_rows / operator.estimated_rows;
  return Math.max(ratio, 1 / Math.max(ratio, 0.0001));
}

function formatRatio(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "-";
  if (ratio >= 1) return `+${ratio.toFixed(1)}x`;
  return `/${(1 / Math.max(ratio, 0.0001)).toFixed(1)}x`;
}
