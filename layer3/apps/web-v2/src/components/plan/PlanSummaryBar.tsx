import { Fragment, useMemo, type ReactNode } from "react";
import type { StatementResult } from "@layer3/core";
import { cn } from "@/lib/utils";
import { GlossaryTip } from "./GlossaryTip";
import { cpuCls, elapsedCls, fmtKbOrMb, formatMs, memCls, nullableNum, topWait, totalWaitMs, waitCls } from "./planUtils";

interface PlanSummaryBarProps {
  s: StatementResult;
}

interface SummaryItem {
  label: string;
  value: string;
  glossaryKey: string;
  valueClassName?: string;
  truncate?: boolean;
}

export function PlanSummaryBar({ s }: PlanSummaryBarProps): ReactNode {
  const warningTotal = useMemo(
    () => (s.finding_groups ?? []).reduce((sum, group) => sum + group.count, 0),
    [s.finding_groups],
  );
  const top = useMemo(() => topWait(s.wait_stats ?? []), [s.wait_stats]);
  const waitTotal = useMemo(() => totalWaitMs(s.wait_stats ?? []), [s.wait_stats]);

  const row1: SummaryItem[] = [
    { label: "STMT TYPE", value: s.statement_type || "-", glossaryKey: "statement_type" },
    { label: "OPTIMIZATION", value: s.compilation?.optm_level || "-", glossaryKey: "optm_level", valueClassName: "text-[var(--color-info)]" },
    {
      label: "WARNINGS",
      value: String(warningTotal),
      glossaryKey: "warnings_count",
      valueClassName:
        s.critical_count > 0
          ? "text-[var(--color-critical)]"
          : s.warning_count > 0
            ? "text-[var(--color-warning)]"
            : "text-[var(--color-text)]",
    },
    {
      label: "MISSING IDX",
      value: String(s.missing_indexes.length),
      glossaryKey: "missing_index_impact",
      valueClassName: s.missing_indexes.length > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-text)]",
    },
    {
      label: "PARALLELISM",
      value: s.dop > 1 ? `DOP ${s.dop}` : s.dop === 1 ? "None" : "-",
      glossaryKey: "dop",
      valueClassName: s.dop > 1 ? "text-[var(--color-info)]" : "text-[var(--color-text)]",
    },
  ];

  const row2: SummaryItem[] = [
    { label: "EST. COST", value: nullableNum(s.total_cost, 4), glossaryKey: "total_cost", valueClassName: "text-[var(--color-info)]" },
    { label: "ELAPSED", value: formatMs(s.elapsed_ms), glossaryKey: "actual_elapsed", valueClassName: elapsedCls(s.elapsed_ms) },
    { label: "CPU TIME", value: formatMs(s.cpu_ms), glossaryKey: "cpu_time", valueClassName: cpuCls(s.cpu_ms) },
    {
      label: "MEM USED",
      value: fmtKbOrMb(s.memory_grant?.max_used_kb),
      glossaryKey: "mem_used",
      valueClassName: memCls(s.memory_grant?.max_used_kb, s.memory_grant?.granted_kb),
    },
    { label: "TOP WAIT", value: top?.type ?? "-", glossaryKey: (top?.type ?? "").toLowerCase() || "wait_stat", valueClassName: waitCls(top?.type), truncate: true },
    {
      label: "WAIT TIME",
      value: waitTotal > 0 ? formatMs(waitTotal) : "-",
      glossaryKey: "wait_stat",
      valueClassName: elapsedCls(waitTotal || null),
    },
  ];

  return (
    <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <SummaryRow items={row1} />
      <div className="mx-auto h-px w-full bg-[var(--color-border)] opacity-50" />
      <SummaryRow items={row2} />
    </div>
  );
}

function SummaryRow({ items }: { items: SummaryItem[] }): ReactNode {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-0 gap-y-1 px-4 py-[5px]">
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 && (
            <span className="mx-2 select-none text-[var(--color-border)]" aria-hidden="true">|</span>
          )}
          <span className="inline-flex flex-col items-center gap-[2px]">
            <span className={cn(
              "text-[18px] font-extrabold leading-tight tabular",
              item.truncate && "max-w-[140px] truncate",
              item.valueClassName ?? "text-[var(--color-text)]",
            )}>
              {item.value}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--color-muted)]">
              <GlossaryTip glossaryKey={item.glossaryKey}>{item.label}</GlossaryTip>
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}
