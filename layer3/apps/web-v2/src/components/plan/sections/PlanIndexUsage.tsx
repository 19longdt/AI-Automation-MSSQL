import type { IndexUsage } from "@layer3/core";
import type { ReactNode } from "react";
import { GlossaryTip } from "../GlossaryTip";

interface PlanIndexUsageProps {
  items: IndexUsage[];
}

export function PlanIndexUsage({ items }: PlanIndexUsageProps): ReactNode {
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const hasLookup = item.op_type.toUpperCase().includes("LOOKUP");
        return (
          <article key={`${item.table}-${item.index}-${index}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-text)]">{item.table}</span>
              <span className="font-code text-[12px] text-[var(--color-text-2)]">{item.index}</span>
              {hasLookup && (
                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--color-warning)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                  <GlossaryTip glossaryKey="key_lookup">Lookup</GlossaryTip>
                </span>
              )}
              {item.is_partitioned && (
                <span className="rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-info)]">
                  Partitioned
                </span>
              )}
            </div>
            <div className="mt-2 grid gap-2 text-[12px] md:grid-cols-3">
              <Metric label="Kind" value={item.index_kind} />
              <Metric label="Operation" value={item.op_type} />
              <Metric label="Partitioned" value={item.is_partitioned ? "Yes" : "No"} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="rounded-md bg-[var(--color-surface)] px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 text-[var(--color-text)]">{value || "-"}</p>
    </div>
  );
}
