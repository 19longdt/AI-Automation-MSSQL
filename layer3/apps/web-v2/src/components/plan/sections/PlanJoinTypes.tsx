import type { JoinTypeSummary } from "@layer3/core";
import type { ReactNode } from "react";
import { GlossaryTip } from "../GlossaryTip";

interface PlanJoinTypesProps {
  joins: JoinTypeSummary[];
}

export function PlanJoinTypes({ joins }: PlanJoinTypesProps): ReactNode {
  const hasSpill = joins.some((item) => item.has_spill || item.join_type === "__spill__");
  const hasHashMatch = joins.some((item) => item.join_type.toLowerCase().includes("hash"));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {joins.map((join, index) => (
          <span key={`${join.join_type}-${index}`} className={chipClass(join)}>
            {labelFor(join)} x{join.count}
          </span>
        ))}
      </div>
      {hasSpill && (
        <p className="rounded-lg bg-[var(--color-critical-soft)] px-3 py-2 text-[12px] text-[var(--color-critical)]">
          <GlossaryTip glossaryKey="spill_to_tempdb">Spills detected: operations exceeded memory grant and wrote to disk.</GlossaryTip>
        </p>
      )}
      {hasHashMatch && (
        <p className="rounded-lg bg-[var(--color-info-soft)] px-3 py-2 text-[12px] text-[var(--color-info)]">
          <GlossaryTip glossaryKey="hash_match">Hash Match present: check indexes on join columns.</GlossaryTip>
        </p>
      )}
    </div>
  );
}

function chipClass(join: JoinTypeSummary): string {
  const type = join.join_type.toLowerCase();
  if (join.has_spill || type === "__spill__") {
    return "rounded-full border border-[var(--color-critical)] bg-[var(--color-critical-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-critical)]";
  }
  if (type.includes("parallel")) {
    return "rounded-full bg-[color:color-mix(in_srgb,var(--color-info)_18%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-info)]";
  }
  if (type.includes("sort")) {
    return "rounded-full bg-[var(--color-critical-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-critical)]";
  }
  return "rounded-full bg-[var(--color-info-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-info)]";
}

function labelFor(join: JoinTypeSummary): string {
  if (join.join_type === "__spill__") return "Spill";
  return join.join_type;
}
