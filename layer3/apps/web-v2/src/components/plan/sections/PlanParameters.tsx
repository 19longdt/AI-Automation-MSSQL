import { useMemo, type ReactNode } from "react";
import type { ParameterInfo } from "@layer3/core";
import { cn } from "@/lib/utils";
import { GlossaryTip } from "../GlossaryTip";

interface PlanParametersProps {
  parameters: ParameterInfo[];
}

export function PlanParameters({ parameters }: PlanParametersProps): ReactNode {
  const declareBlock = useMemo(() => buildDeclareBlock(parameters), [parameters]);

  return (
    <div className="space-y-3">
      <pre className="overflow-x-auto rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] leading-5 text-[var(--color-code-text)] whitespace-pre-wrap">
        {declareBlock}
      </pre>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="min-w-full border-collapse text-left text-[12px]">
          <thead className="bg-[var(--color-surface-2)]">
            <tr>
              {["Name", "Type", "Compiled", "Runtime"].map((heading) => (
                <th key={heading} scope="col" className="border-b border-[var(--color-border)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  {heading === "Compiled" || heading === "Runtime" ? <GlossaryTip glossaryKey="parameter_sniffing">{heading}</GlossaryTip> : heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parameters.map((parameter) => {
              const mismatch = parameter.compiled_value !== parameter.runtime_value && parameter.runtime_value != null;
              return (
                <tr key={parameter.name} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-3 py-2 font-code text-[var(--color-info)]">{parameter.name}</td>
                  <td className="px-3 py-2 font-code text-[var(--color-muted)]">{parameter.data_type ?? "-"}</td>
                  <td className="px-3 py-2 font-code text-[var(--color-text)]">{parameter.compiled_value ?? "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-code text-[var(--color-text)]", mismatch && "text-[var(--color-critical)]")}>
                        {parameter.runtime_value ?? "-"}
                      </span>
                      {mismatch && (
                        <span className="rounded-full bg-[var(--color-critical-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-critical)]">
                          Sniffing
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildDeclareBlock(parameters: ParameterInfo[]): string {
  if (parameters.length === 0) return "-- No parameters";
  return parameters
    .map((parameter) => {
      const type = parameter.data_type ?? "sql_variant";
      const value = parameter.runtime_value ?? parameter.compiled_value ?? "NULL";
      return `DECLARE ${parameter.name} ${type} = ${value};`;
    })
    .join("\n");
}
