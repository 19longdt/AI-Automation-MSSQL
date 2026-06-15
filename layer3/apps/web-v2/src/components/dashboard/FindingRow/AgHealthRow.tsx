import { useState } from "react";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { RoleNodeCell } from "@/components/shared/RoleNodeCell";
import { SyncHealthBadge, ConnectedBadge, SuspendedBadge, FailoverBadge } from "@/components/shared/AgBadges";
import { AgHealthModal } from "@/components/dashboard/modals/AgHealthModal";
import { formatDetectedAt } from "@/lib/format";
import { useTopicMetricThreshold } from "@/hooks/useTopics";
import { thresholdTextClass } from "@/lib/topic-thresholds";
import type { FindingWithAnalysis } from "@/types";
import type { Severity } from "@layer3/core";

const TH = "px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide whitespace-nowrap";
const TD = "px-3 py-2.5 text-[13px] align-middle";

const COLS = [
  "Time", "Role+Node", "Database", "Replica", "Severity",
  "Sync State", "Sync Health", "Connected", "Suspended", "Failover",
  "Log Send Q", "Log Rate", "AI",
];

export function AgHealthHeader(): React.ReactElement {
  return (
    <tr>
      {COLS.map((h) => <th key={h} className={TH}>{h}</th>)}
    </tr>
  );
}

export function AgHealthRow({
  finding,
  onOpen,
}: {
  finding: FindingWithAnalysis;
  onOpen: (f: FindingWithAnalysis) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const m = (finding.metrics ?? {}) as Record<string, unknown>;
  const logSendQueueThreshold = useTopicMetricThreshold("ag_health", "log_send_queue_size", {
    warning: 500,
    critical: 1000,
  });

  const logQ    = m.log_send_queue_size != null ? Number(m.log_send_queue_size) : null;
  const logRate = m.log_send_rate       != null ? Number(m.log_send_rate)       : null;

  const handleOpen = (): void => { setOpen(true); onOpen(finding); };

  return (
    <>
      <tr
        className="border-b border-[var(--color-border)] hover:bg-[var(--color-row-hover)] cursor-pointer transition-colors duration-[120ms]"
        onClick={handleOpen}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleOpen()}
        aria-label={`AG Health — ${String(m.replica_server_name ?? finding.node)}`}
      >
        <td className={TD}>
          <span className="font-code text-[11px] text-[var(--color-muted)]">{formatDetectedAt(finding.detected_at)}</span>
        </td>
        <td className={TD}><RoleNodeCell role={finding.role} node={finding.node} /></td>
        <td className={TD}>
          <span className="font-medium text-[var(--color-text)]">{String(m.database_name ?? "—")}</span>
        </td>
        <td className={TD}>
          <span className="text-[var(--color-text-2)] text-[12px]">{String(m.replica_server_name ?? "—")}</span>
        </td>
        <td className={TD}><SeverityBadge severity={finding.severity as Severity} /></td>
        <td className={TD}>
          <span className="font-code text-[11px] text-[var(--color-text-2)]">
            {String(m.synchronization_state_desc ?? "—")}
          </span>
        </td>
        <td className={TD}>
          <SyncHealthBadge value={String(m.synchronization_health_desc ?? "")} />
        </td>
        <td className={TD}>
          <ConnectedBadge value={String(m.connected_state_desc ?? "")} />
        </td>
        <td className={TD}>
          <SuspendedBadge
            isSuspended={Number(m.is_suspended) === 1}
            reason={m.suspend_reason_desc ? String(m.suspend_reason_desc) : undefined}
          />
        </td>
        <td className={TD}><FailoverBadge value={m.is_failover_ready} /></td>
        <td className={TD}>
          {logQ != null ? (
            <span
              className={cn(
                "tabular font-code text-[12px]",
                thresholdTextClass(logQ, logSendQueueThreshold, "text-[var(--color-text-2)]"),
              )}
            >
              {logQ.toLocaleString()} KB
            </span>
          ) : <span className="text-[var(--color-muted)]">—</span>}
        </td>
        <td className={TD}>
          {logRate != null ? (
            <span className="tabular font-code text-[12px] text-[var(--color-text-2)]">
              {logRate.toLocaleString()} KB/s
            </span>
          ) : <span className="text-[var(--color-muted)]">—</span>}
        </td>
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

      {open && <AgHealthModal finding={finding} onClose={() => setOpen(false)} />}
    </>
  );
}
