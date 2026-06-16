import type { CompilationInfo } from "@layer3/core";
import type { ReactNode } from "react";
import { GlossaryTip } from "../GlossaryTip";

interface PlanCompilationProps {
  compilation: CompilationInfo;
}

export function PlanCompilation({ compilation }: PlanCompilationProps): ReactNode {
  const rows: Array<[string, string, string | undefined]> = [
    ["CE Model", String(compilation.ce_model_version), "cardinality_estimation"],
    ["Opt Level", compilation.optm_level ?? "-", "optm_level"],
    ["DOP", String(compilation.dop), "dop"],
    ["Compile CPU", `${compilation.compile_cpu_ms} ms`, "compile_cpu"],
    ["Compile Memory", `${compilation.compile_memory_kb} KB`, "compile_memory"],
    ["Cached Plan Size", `${compilation.cached_plan_size_kb} KB`, undefined],
    ...optionalRows("Non-Parallel Reason", compilation.non_parallel_reason, "non_parallel_reason"),
    ...optionalRows("Early Abort", compilation.early_abort_reason),
    ...optionalRows("Query Hash", compilation.query_hash, "query_hash"),
    ...optionalRows("Plan Hash", compilation.query_plan_hash, "plan_hash"),
  ];

  return (
    <div className="grid gap-2 text-[12px] md:grid-cols-2">
      {rows.map(([label, value, glossaryKey]) => (
        <div key={label} className="rounded-md bg-[var(--color-surface-2)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
              {glossaryKey ? <GlossaryTip glossaryKey={glossaryKey}>{label}</GlossaryTip> : label}
            </span>
            {label === "CE Model" && compilation.ce_model_version === 70 && (
              <span className="rounded-full bg-[color:color-mix(in_srgb,var(--color-warning)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                Legacy SQL 2012
              </span>
            )}
          </div>
          <p className="mt-1 break-all font-code text-[var(--color-text)]">{value}</p>
        </div>
      ))}
    </div>
  );
}

function optionalRows(label: string, value: string | null, glossaryKey?: string): Array<[string, string, string | undefined]> {
  return value ? [[label, value, glossaryKey]] : [];
}
