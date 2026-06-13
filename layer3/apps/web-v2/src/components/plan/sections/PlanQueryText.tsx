import type { ReactNode } from "react";
import { formatQueryText } from "../planUtils";

interface PlanQueryTextProps {
  statementText: string;
}

export function PlanQueryText({ statementText }: PlanQueryTextProps): ReactNode {
  return (
    <pre className="overflow-x-auto rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] leading-5 text-[var(--color-code-text)] whitespace-pre-wrap">
      {formatQueryText(statementText)}
    </pre>
  );
}

