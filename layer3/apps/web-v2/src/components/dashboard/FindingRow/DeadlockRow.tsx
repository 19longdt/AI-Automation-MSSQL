import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { RoleNodeCell } from "@/components/shared/RoleNodeCell";
import { DeadlockModal } from "@/components/dashboard/modals/DeadlockModal";
import { formatDetectedAt, truncate } from "@/lib/format";
import type { FindingWithAnalysis } from "@/types";
import type { Severity } from "@layer3/core";

const TH = "px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide whitespace-nowrap";
const TD = "px-3 py-2.5 text-[13px] align-middle";

const COLS = ["Time", "Role+Node", "Severity", "Victim ID", "Deadlock Time", "Victim Query", "AI"];

export function DeadlockHeader(): React.ReactElement {
  return (
    <tr>
      {COLS.map((h) => <th key={h} className={TH}>{h}</th>)}
    </tr>
  );
}

export function DeadlockRow({
  finding,
  onOpen,
}: {
  finding: FindingWithAnalysis;
  onOpen: (f: FindingWithAnalysis) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const m = (finding.metrics ?? {}) as Record<string, unknown>;

  const victimId    = m.victim_id != null ? String(m.victim_id) : null;
  const deadlockTs  = m.deadlock_time != null ? String(m.deadlock_time) : null;
  const victimQuery = m.victim_query != null ? String(m.victim_query) : null;

  const handleOpen = useCallback((): void => {
    setOpen(true);
    onOpen(finding);
  }, [finding, onOpen]);

  return (
    <>
      <tr
        className="border-b border-[var(--color-border)] hover:bg-[var(--color-row-hover)] cursor-pointer transition-colors duration-[120ms]"
        onClick={handleOpen}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleOpen()}
        aria-label={`Deadlock — victim #${victimId ?? "unknown"}`}
      >
        {/* Time */}
        <td className={TD}>
          <span className="font-code text-[11px] text-[var(--color-muted)]">
            {formatDetectedAt(finding.detected_at)}
          </span>
        </td>

        {/* Role+Node */}
        <td className={TD}><RoleNodeCell role={finding.role} node={finding.node} /></td>

        {/* Severity */}
        <td className={TD}><SeverityBadge severity={finding.severity as Severity} /></td>

        {/* Victim ID — critical badge */}
        <td className={TD}>
          {victimId != null ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-bold font-code bg-[var(--color-critical-soft)] text-[var(--color-critical)] border border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)] tabular">
              #{victimId}
            </span>
          ) : (
            <span className="text-[var(--color-muted)]">—</span>
          )}
        </td>

        {/* Deadlock Time */}
        <td className={TD}>
          <span className="font-code text-[11px] text-[var(--color-muted)]">
            {deadlockTs ? formatDetectedAt(deadlockTs) : "—"}
          </span>
        </td>

        {/* Victim Query preview */}
        <td className={TD}>
          {victimQuery ? (
            <span className="font-code text-[11px] text-[var(--color-text-2)] bg-[var(--color-surface-3)] px-1.5 py-0.5 rounded block truncate max-w-[280px]">
              {truncate(victimQuery, 70)}
            </span>
          ) : (
            <span className="text-[var(--color-muted)]">—</span>
          )}
        </td>

        {/* AI status */}
        <td className={TD}>
          <span className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border",
            finding.ai_analyzed
              ? "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[color:color-mix(in_srgb,var(--color-success)_30%,transparent)]"
              : "bg-[var(--color-surface-3)] text-[var(--color-muted)] border-[var(--color-border)]",
          )}>
            {finding.ai_analyzed ? "Done" : "—"}
          </span>
        </td>
      </tr>

      {open && <DeadlockModal finding={finding} onClose={() => setOpen(false)} />}
    </>
  );
}
