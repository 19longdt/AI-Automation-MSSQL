import type { LookupQueries } from "@layer3/core";
import type { ReactNode } from "react";
import { CopySqlButton } from "./CopySqlButton";

interface PlanLookupQueriesProps {
  queries: LookupQueries;
}

export function PlanLookupQueries({ queries }: PlanLookupQueriesProps): ReactNode {
  return (
    <div className="space-y-3">
      {queries.plan_cache_sql && <SqlQueryCard title="Plan Cache" text={queries.plan_cache_sql} label="plan cache SQL" />}
      {queries.query_store_sql && <SqlQueryCard title="Query Store" text={queries.query_store_sql} label="query store SQL" />}
    </div>
  );
}

function SqlQueryCard({ title, text, label }: { title: string; text: string; label: string }): ReactNode {
  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{title}</span>
        <CopySqlButton text={text} label={label} />
      </div>
      <pre className="overflow-x-auto rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] leading-5 text-[var(--color-code-text)] whitespace-pre-wrap">
        {text}
      </pre>
    </article>
  );
}

