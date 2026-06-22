import { useState, useCallback } from "react";
import { XCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { RoleNodeCell } from "@/components/shared/RoleNodeCell";
import { CdcHealthModal } from "@/components/dashboard/modals/CdcHealthModal";
import { formatDetectedAt } from "@/lib/format";
import type { FindingWithAnalysis } from "@/types";
import type { Severity } from "@layer3/core";

const TH = "px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide whitespace-nowrap";
const TD = "px-3 py-2.5 text-[13px] align-middle";

const COLS = ["Time", "Node", "Severity", "Job Name", "Status", "Duration", "Message", "AI"];

type CdcStatus = "FAILED" | "RETRY" | "OK";

function cdcStatus(m: Record<string, unknown>): CdcStatus {
  if (Number(m.cdc_job_failed) === 1) return "FAILED";
  if (Number(m.cdc_job_retry)  === 1) return "RETRY";
  return "OK";
}

function StatusBadge({ status }: { status: CdcStatus }): React.ReactElement {
  if (status === "FAILED") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-critical-soft)] text-[var(--color-critical)] border border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)]">
      <XCircle className="w-3 h-3 shrink-0" aria-hidden="true" />FAILED
    </span>
  );
  if (status === "RETRY") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)]">
      <RefreshCw className="w-3 h-3 shrink-0" aria-hidden="true" />RETRY
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[color:color-mix(in_srgb,var(--color-success)_25%,transparent)]">
      <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />OK
    </span>
  );
}

export function CdcHealthHeader(): React.ReactElement {
  return (
    <tr>
      {COLS.map((h) => <th key={h} className={TH}>{h}</th>)}
    </tr>
  );
}

export function CdcHealthRow({
  finding,
  onOpen,
}: {
  finding: FindingWithAnalysis;
  onOpen: (f: FindingWithAnalysis) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const m = (finding.metrics ?? {}) as Record<string, unknown>;
  const status = cdcStatus(m);

  const jobName    = m.job_name     ? String(m.job_name)     : null;
  const duration   = m.run_duration ? String(m.run_duration) : null;
  const message    = m.message      ? String(m.message)      : null;

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
        aria-label={`CDC Health — ${jobName ?? finding.node}`}
      >
        <td className={TD}>
          <span className="font-code text-[11px] text-[var(--color-muted)]">{formatDetectedAt(finding.detected_at)}</span>
        </td>
        <td className={TD}><RoleNodeCell role={finding.role} node={finding.node} /></td>
        <td className={TD}><SeverityBadge severity={finding.severity as Severity} /></td>

        {/* Job Name */}
        <td className={TD}>
          {jobName ? (
            <span className="font-code text-[12px] text-[var(--color-text)]">{jobName}</span>
          ) : <span className="text-[var(--color-muted)]">—</span>}
        </td>

        {/* Status badge */}
        <td className={TD}><StatusBadge status={status} /></td>

        {/* Duration */}
        <td className={TD}>
          {duration ? (
            <span className="font-code text-[12px] text-[var(--color-text-2)] tabular">{duration}</span>
          ) : <span className="text-[var(--color-muted)]">—</span>}
        </td>

        {/* Message preview */}
        <td className={TD}>
          {message ? (
            <span className={cn(
              "font-code text-[11px] block truncate max-w-[220px]",
              status === "FAILED" ? "text-[var(--color-critical)]" : "text-[var(--color-text-2)]",
            )}>
              {message.slice(0, 80)}
            </span>
          ) : <span className="text-[var(--color-muted)]">—</span>}
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

      {open && <CdcHealthModal finding={finding} onClose={() => setOpen(false)} />}
    </>
  );
}
