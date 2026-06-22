import type { ReactNode } from "react";
import type { StatsSummary } from "@layer3/core";
import { nullableNum } from "../planUtils";

interface PlanStatisticsProps {
  statistics: StatsSummary[];
}

export function PlanStatistics({ statistics }: PlanStatisticsProps): ReactNode {
  return (
    <div className="space-y-3">
      {statistics.map((stat, index) => (
        <article
          key={`${stat.table}-${stat.statistic}-${index}`}
          className="rounded-lg border bg-[var(--color-surface-2)] p-3"
          style={{ borderColor: stat.is_stale ? "var(--color-warning)" : "var(--color-border)" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--color-text)]">{stat.statistic}</span>
            <span className="text-[12px] text-[var(--color-muted)]">{stat.table}</span>
            {stat.is_stale && (
              <span className="ml-auto rounded-full bg-[color:color-mix(in_srgb,var(--color-warning)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                Stale
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-2 text-[12px] md:grid-cols-3">
            <Metric label="Last Update" value={stat.last_update?.slice(0, 19).replace("T", " ") ?? "\u2014"} />
            <Metric label="Sampling %" value={stat.sampling_percent != null ? `${nullableNum(stat.sampling_percent, 1)}%` : "\u2014"} />
            <Metric label="Modifications" value={nullableNum(stat.modification_count, 0)} />
          </div>
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="rounded-md bg-[var(--color-surface)] px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-code tabular text-[var(--color-text)]">{value}</p>
    </div>
  );
}

