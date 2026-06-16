import { useState, useCallback } from "react";
import { AlertCircle, Cpu, Link2, Users, Clock } from "lucide-react";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { RoleNodeCell } from "@/components/shared/RoleNodeCell";
import { KillSessionConfirm } from "@/components/dashboard/modals/KillSessionConfirm";
import { BlockingChainModal } from "@/components/dashboard/modals/BlockingChainModal";
import { Button } from "@/components/ui/button";
import { useTopicMetricThreshold } from "@/hooks/useTopics";
import { getThresholdSeverity } from "@/lib/topic-thresholds";
import { cn } from "@/lib/utils";
import { formatDetectedAt } from "@/lib/format";
import type { FindingWithAnalysis, TopicThresholdConfig } from "@/types";
import type { Severity } from "@layer3/core";

const TH =
  "px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide whitespace-nowrap";
const TD = "px-3 py-2.5 text-[13px] align-middle";

interface BlockingMetrics {
  head_blocker_session_id?: number | string | null;
  head_blocker_login?: string | null;
  head_blocker_query?: string | null;
  head_blocker_is_idle?: boolean | number | null;
  head_blocker_open_txn_count?: number | null;
  chain_depth?: number | null;
  blocked_session_count?: number | null;
  max_wait_sec?: number | null;
  wait_type?: string | null;
}

function asBlockingMetrics(raw: unknown): BlockingMetrics {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    head_blocker_session_id: r.head_blocker_session_id as number | null,
    head_blocker_login: r.head_blocker_login as string | null,
    head_blocker_query: r.head_blocker_query as string | null,
    head_blocker_is_idle: r.head_blocker_is_idle as boolean | null,
    head_blocker_open_txn_count: r.head_blocker_open_txn_count as number | null,
    chain_depth: r.chain_depth as number | null,
    blocked_session_count: r.blocked_session_count as number | null,
    max_wait_sec: r.max_wait_sec as number | null,
    wait_type: r.wait_type as string | null,
  };
}

function waitSeverityCls(sec: number, threshold: TopicThresholdConfig): string {
  const severity = getThresholdSeverity(sec, threshold);
  if (severity === "critical") return "bg-[var(--color-critical-soft)] text-[var(--color-critical)] border border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)]";
  if (severity === "warning") return "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)]";
  return "bg-[var(--color-surface-3)] text-[var(--color-text-2)] border border-[var(--color-border)]";
}

function depthSeverityCls(d: number, threshold: TopicThresholdConfig): string {
  const severity = getThresholdSeverity(d, threshold);
  if (severity === "critical") return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
  if (severity === "warning") return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
  return "bg-[var(--color-info-soft)] text-[var(--color-info)]";
}

/* ── Header ── */
export function BlockingHeader(): React.ReactElement {
  return (
    <tr>
      {[
        "Time", "Role+Node", "Severity", "Head Blocker",
        "State", "Depth", "Blocked", "Max Wait", "Wait Type", "AI", "Action",
      ].map((h) => (
        <th key={h} className={TH}>{h}</th>
      ))}
    </tr>
  );
}

/* ── Row ── */
type ModalState = "chain" | "kill" | null;

export function BlockingRow({
  finding,
  onOpen,
}: {
  finding: FindingWithAnalysis;
  onOpen: (f: FindingWithAnalysis) => void;
}): React.ReactElement {
  const [modal, setModal] = useState<ModalState>(null);
  const m = asBlockingMetrics(finding.metrics);
  const waitThreshold = useTopicMetricThreshold("blocking", "wait_sec", {
    warning: 30,
    critical: 120,
  });
  const depthThreshold = useTopicMetricThreshold("blocking", "chain_depth", {
    warning: 3,
    critical: 5,
  });
  const blockedThreshold = useTopicMetricThreshold("blocking", "blocked_session_count", {
    warning: 5,
    critical: 20,
  });

  const headId = Number(m.head_blocker_session_id) || 0;
  const isIdle = !!(m.head_blocker_is_idle);
  const openTxnCount = Number(m.head_blocker_open_txn_count) || 0;
  const depth = m.chain_depth != null ? Number(m.chain_depth) : null;
  const blockedCount = m.blocked_session_count != null ? Number(m.blocked_session_count) : null;
  const maxWaitSec = m.max_wait_sec != null ? Number(m.max_wait_sec) : null;

  const handleOpen = useCallback(() => {
    setModal("chain");
    onOpen(finding);
  }, [finding, onOpen]);
  const stopAndKill = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setModal("kill");
  }, []);

  return (
    <>
      <tr
        className="border-b border-[var(--color-border)] hover:bg-[var(--color-row-hover)] cursor-pointer transition-colors duration-[120ms]"
        onClick={handleOpen}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleOpen()}
        aria-label={`Blocking chain — head blocker #${headId || "unknown"}`}
      >
        {/* Time */}
        <td className={TD}>
          <span className="font-code text-[11px] text-[var(--color-muted)]">
            {formatDetectedAt(finding.detected_at)}
          </span>
        </td>

        {/* Role+Node */}
        <td className={TD}>
          <RoleNodeCell role={finding.role} node={finding.node} />
        </td>

        {/* Severity */}
        <td className={TD}>
          <SeverityBadge severity={finding.severity as Severity} />
        </td>

        {/* Head Blocker — ID + login stacked */}
        <td className={TD}>
          <div className="flex flex-col gap-0.5">
            <span className="font-code font-bold text-[14px] text-[var(--color-critical)] tabular leading-none">
              #{headId > 0 ? headId : "—"}
            </span>
            {m.head_blocker_login && (
              <span className="text-[11px] text-[var(--color-muted)] max-w-[110px] truncate">
                {m.head_blocker_login}
              </span>
            )}
          </div>
        </td>

        {/* State — icon badge */}
        <td className={TD}>
          {isIdle && openTxnCount > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[color:color-mix(in_srgb,var(--color-warning)_30%,transparent)]">
              <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
              IDLE TXN
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[color:color-mix(in_srgb,var(--color-success)_30%,transparent)]">
              <Cpu className="w-3 h-3 shrink-0" aria-hidden="true" />
              ACTIVE
            </span>
          )}
        </td>

        {/* Depth — color-coded pill */}
        <td className={TD}>
          {depth != null ? (
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular",
              depthSeverityCls(depth, depthThreshold),
            )}>
              <Link2 className="w-3 h-3 shrink-0" aria-hidden="true" />
              {depth}
            </span>
          ) : (
            <span className="text-[var(--color-muted)]">—</span>
          )}
        </td>

        {/* Blocked count — icon + number */}
        <td className={TD}>
          {blockedCount != null ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[13px] font-semibold tabular",
                getThresholdSeverity(blockedCount, blockedThreshold) === "critical"
                  ? "text-[var(--color-critical)]"
                  : getThresholdSeverity(blockedCount, blockedThreshold) === "warning"
                    ? "text-[var(--color-warning)]"
                    : "text-[var(--color-text)]",
              )}
            >
              <Users className="w-3.5 h-3.5 text-[var(--color-muted)] shrink-0" aria-hidden="true" />
              {blockedCount}
            </span>
          ) : (
            <span className="text-[var(--color-muted)]">—</span>
          )}
        </td>

        {/* Max Wait — severity-colored badge */}
        <td className={TD}>
          {maxWaitSec != null ? (
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold tabular",
              waitSeverityCls(maxWaitSec, waitThreshold),
            )}>
              <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
              {maxWaitSec}s
            </span>
          ) : (
            <span className="text-[var(--color-muted)]">—</span>
          )}
        </td>

        {/* Wait Type — code badge */}
        <td className={TD}>
          {m.wait_type ? (
            <span className="font-code text-[11px] text-[var(--color-text-2)] bg-[var(--color-surface-3)] px-1.5 py-0.5 rounded">
              {m.wait_type}
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

        {/* Kill action */}
        <td className={cn(TD, "whitespace-nowrap")} onClick={(e) => e.stopPropagation()}>
          <Button
            variant="danger"
            size="sm"
            disabled={headId <= 0}
            onClick={stopAndKill}
            aria-label={`Kill head blocker session #${headId}`}
          >
            Kill
          </Button>
        </td>
      </tr>

      {modal === "chain" && (
        <BlockingChainModal finding={finding} onClose={() => setModal(null)} />
      )}

      {modal === "kill" && headId > 0 && (
        <KillSessionConfirm
          sessionId={headId}
          node={finding.node}
          sourceLabel="head_blocker"
          sqlText={m.head_blocker_query ?? undefined}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
