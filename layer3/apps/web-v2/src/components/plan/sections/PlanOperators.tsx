import { useMemo, type ReactNode } from "react";
import type { OperatorSummary } from "@layer3/core";
import { cn } from "@/lib/utils";
import { GlossaryTip } from "../GlossaryTip";
import { nullableNum, opDisplayName, opGlossaryKey, opTagClass } from "../planUtils";

interface PlanOperatorsProps {
  operators: OperatorSummary[];
}

export function PlanOperators({ operators }: PlanOperatorsProps): ReactNode {
  const topOperators = useMemo(() => operators.slice(0, 10), [operators]);

  return (
    <div className="space-y-3">
      {topOperators.map((operator) => {
        const width = Math.min(100, Math.max(8, operator.cost_pct));
        const costTone =
          operator.cost_pct >= 70
            ? "text-[var(--color-critical)]"
            : operator.cost_pct >= 30
              ? "text-[var(--color-warning)]"
              : "text-[var(--color-text)]";

        return (
          <article key={operator.node_id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-text)]">
                <GlossaryTip glossaryKey={opGlossaryKey(operator.physical_op, operator.logical_op)}>
                  {opDisplayName(operator)}
                </GlossaryTip>
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white", opTagClass(operator.op_type_tag))}>
                {operator.op_type_tag}
              </span>
              {operator.has_row_est_off && (
                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--color-warning)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                  Row Est Off
                </span>
              )}
              {operator.has_spill && (
                <span className="rounded-full bg-[var(--color-critical-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-critical)]">
                  <GlossaryTip glossaryKey="spill_to_tempdb">Spill</GlossaryTip>
                </span>
              )}
              <span className="ml-auto text-[11px] tabular text-[var(--color-muted)]">#{operator.node_id}</span>
            </div>

            <div className="mt-2 grid gap-2 text-[12px] text-[var(--color-text-2)] md:grid-cols-4">
              <Metric label="Cost" value={nullableNum(operator.cost, 2)} />
              <Metric label="% Total" value={`${nullableNum(operator.cost_pct, 1)}%`} valueClassName={costTone} />
              <Metric label="Est Rows" glossaryKey="estimated_rows" value={nullableNum(operator.estimated_rows, 0)} />
              <Metric label="Act Rows" value={nullableNum(operator.actual_rows, 0)} />
            </div>

            <div className="mt-3 h-2 rounded-full bg-[var(--color-border)]">
              <div className={cn("h-2 rounded-full", opTagClass(operator.op_type_tag))} style={{ width: `${width}%` }} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Metric({ label, value, valueClassName, glossaryKey }: { label: string; value: string; valueClassName?: string; glossaryKey?: string }): ReactNode {
  return (
    <div className="rounded-md bg-[var(--color-surface)] px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
        {glossaryKey ? <GlossaryTip glossaryKey={glossaryKey}>{label}</GlossaryTip> : label}
      </p>
      <p className={cn("mt-1 font-code tabular text-[var(--color-text)]", valueClassName)}>{value}</p>
    </div>
  );
}
