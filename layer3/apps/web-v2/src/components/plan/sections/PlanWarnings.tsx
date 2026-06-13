import type { FindingGroup, FindingInstance } from "@layer3/core";
import type { ReactNode } from "react";
import { GlossaryTip } from "../GlossaryTip";
import { renderText } from "../planText";
import { warnCat, warnLabel } from "../planUtils";
import { CopySqlButton } from "./CopySqlButton";

interface PlanWarningsProps {
  groups: FindingGroup[];
}

export function PlanWarnings({ groups }: PlanWarningsProps): ReactNode {
  return (
    <div className="space-y-3">
      {groups.map((group, index) => (
        <article
          key={`${group.type}-${index}`}
          className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-[inset_4px_0_0_0_var(--warn-color)]"
          style={{ ["--warn-color" as string]: severityColor(group.severity) }}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <SeverityPill severity={group.severity} />
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
              {warnCat(group.type)}
            </span>
            <span className="text-[12px] font-semibold text-[var(--color-text)]">{group.type}</span>
            <span className="ml-auto rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium tabular text-[var(--color-muted)]">
              x{group.count}
            </span>
          </div>
          <div className="space-y-2 px-3 py-3 text-[13px] text-[var(--color-text-2)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--color-muted)]">
              <GlossaryTip glossaryKey={group.type}>{warnLabel(group.type)}</GlossaryTip>
            </p>
            {group.count === 1 && group.instances.length > 0 && (
              <p className="text-[13px] leading-relaxed text-[var(--color-text)]">
                {renderText(group.instances[0].description)}
              </p>
            )}
            <div className="rounded-lg bg-[var(--color-surface)] px-3 py-2 text-[12px] leading-5 text-[var(--color-text)]">
              <span className="mr-1 text-[var(--color-warning)]">!</span>
              {renderText(group.recommendation)}
            </div>
            {group.shared_action?.ddl && <SqlBlock text={group.shared_action.ddl} />}
            {group.count > 1 && group.instances.length > 0 && (
              <div className="space-y-1.5 border-t border-[var(--color-border)] pt-2">
                {group.instances.map((instance, instanceIndex) => (
                  <InstanceRow key={`${group.type}-${instanceIndex}`} instance={instance} />
                ))}
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function InstanceRow({ instance }: { instance: FindingInstance }): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="shrink-0 text-[var(--color-muted)]">•</span>
        <span className="text-[var(--color-text)] leading-snug">{renderText(instance.description)}</span>
      </div>
      {instance.action?.ddl && <SqlBlock text={instance.action.ddl} />}
    </div>
  );
}

function SqlBlock({ text, className }: { text: string; className?: string }): ReactNode {
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">DDL</span>
        <CopySqlButton text={text} label="DDL" />
      </div>
      <pre className="overflow-x-auto rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] leading-5 text-[var(--color-code-text)] whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

function SeverityPill({ severity }: { severity: FindingGroup["severity"] }): ReactNode {
  const className =
    severity === "critical"
      ? "bg-[var(--color-critical-soft)] text-[var(--color-critical)]"
      : severity === "warning"
        ? "bg-[color:color-mix(in_srgb,var(--color-warning)_16%,transparent)] text-[var(--color-warning)]"
        : "bg-[var(--color-info-soft)] text-[var(--color-info)]";

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${className}`}>
      {severity}
    </span>
  );
}

function severityColor(severity: FindingGroup["severity"]): string {
  if (severity === "critical") return "var(--color-critical)";
  if (severity === "warning") return "var(--color-warning)";
  return "var(--color-info)";
}
