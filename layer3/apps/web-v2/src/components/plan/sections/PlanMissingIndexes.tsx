import type { IndexSuggestion } from "@layer3/core";
import type { ReactNode } from "react";
import { GlossaryTip } from "../GlossaryTip";
import { nullableNum } from "../planUtils";
import { CopySqlButton } from "./CopySqlButton";

interface PlanMissingIndexesProps {
  indexes: IndexSuggestion[];
}

export function PlanMissingIndexes({ indexes }: PlanMissingIndexesProps): ReactNode {
  return (
    <div className="space-y-3">
      {indexes.map((index, itemIndex) => (
        <article key={`${index.table}-${itemIndex}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color:color-mix(in_srgb,var(--color-warning)_16%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-warning)]">
              <GlossaryTip glossaryKey="missing_index_impact">Impact</GlossaryTip> {nullableNum(index.impact, 1)}%
            </span>
            <span className="text-[13px] font-semibold text-[var(--color-text)]">{index.table}</span>
          </div>
          <div className="mt-3 grid gap-2 text-[12px] md:grid-cols-3">
            <ColumnBox title="Equality" glossaryKey="idx_equality_col" values={index.equality_columns} />
            <ColumnBox title="Inequality" glossaryKey="idx_inequality_col" values={index.inequality_columns} />
            <ColumnBox title="Include" glossaryKey="idx_include_col" values={index.include_columns} />
          </div>
          {index.create_statement && (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">DDL</span>
                <CopySqlButton text={index.create_statement} label="missing index DDL" />
              </div>
              <pre className="overflow-x-auto rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] leading-5 text-[var(--color-code-text)] whitespace-pre-wrap">
                {index.create_statement}
              </pre>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function ColumnBox({ title, glossaryKey, values }: { title: string; glossaryKey: string; values: string[] }): ReactNode {
  return (
    <div className="rounded-md bg-[var(--color-surface)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
        <GlossaryTip glossaryKey={glossaryKey}>{title}</GlossaryTip>
      </p>
      <p className="mt-1 text-[12px] leading-5 text-[var(--color-text)]">{values.length > 0 ? values.join(", ") : "-"}</p>
    </div>
  );
}
