import { SeverityBadge } from "@/components/shared/SeverityBadge";
import type { IssueInsight } from "@/types";
import type { Severity } from "@layer3/core";

interface Props {
  insight: IssueInsight;
  onClick?: () => void;
}

export function InsightCard({ insight, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col gap-3 transition-all duration-200 hover:border-[var(--color-border-2)] hover:shadow-md cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[var(--color-primary)]">
            {insight.issue_type?.replace(/_/g, " ")}
          </span>
          <span className="text-[11px] text-[var(--color-muted)] font-code">
            {insight.created_at?.slice(0, 16).replace("T", " ")}
          </span>
        </div>
        {insight.severity && (
          <SeverityBadge severity={insight.severity as Severity} className="shrink-0" />
        )}
      </div>

      {/* Root cause */}
      {insight.root_cause_summary && (
        <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed line-clamp-3">
          {insight.root_cause_summary}
        </p>
      )}

      {/* Affected tables */}
      {insight.affected_tables?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {insight.affected_tables.slice(0, 4).map((t) => (
            <span key={t} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-code bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)]">
              {t}
            </span>
          ))}
          {insight.affected_tables.length > 4 && (
            <span className="text-[11px] text-[var(--color-muted)]">+{insight.affected_tables.length - 4} more</span>
          )}
        </div>
      )}

      {/* Top action */}
      {insight.actions?.[0] && (
        <div className="flex items-start gap-2 pt-1 border-t border-[var(--color-border)]">
          <span className="text-[var(--color-primary)] text-[12px] mt-0.5 shrink-0">→</span>
          <p className="text-[12px] text-[var(--color-text-2)]">{insight.actions[0].action}</p>
        </div>
      )}
    </div>
  );
}
