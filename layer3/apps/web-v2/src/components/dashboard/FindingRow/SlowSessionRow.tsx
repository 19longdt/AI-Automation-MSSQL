import { useState } from "react";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { AlertStatusBadge } from "@/components/shared/AlertStatusBadge";
import { RoleNodeCell } from "@/components/shared/RoleNodeCell";
import { AiStatusBadge } from "@/components/shared/AiStatusBadge";
import { AiAnalysisModal } from "@/components/shared/AiAnalysisModal";
import { KillSessionConfirm } from "@/components/dashboard/modals/KillSessionConfirm";
import { SlowSessionMetricsModal } from "@/components/dashboard/modals/SlowSessionMetricsModal";
import { Button } from "@/components/ui/button";
import { formatDetectedAt } from "@/lib/format";
import type { FindingWithAnalysis } from "@/types";
import type { Severity } from "@layer3/core";

const TH = "px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide whitespace-nowrap";
const TD = "px-3 py-2.5 text-[13px] align-middle";

type ModalState =
  | { type: "metrics" }
  | { type: "ai" }
  | { type: "kill"; sessionId: number; sourceLabel: string; sqlText?: string }
  | null;

export function SlowSessionHeader() {
  return (
    <tr>
      {["Time","Role+Node","Severity","Alert","Elapsed(s)","CPU(s)","Login","Host","Session","Blocking","AI","Action"].map((h) => (
        <th key={h} className={TH}>{h}</th>
      ))}
    </tr>
  );
}

export function SlowSessionRow({ finding, onOpen }: { finding: FindingWithAnalysis; onOpen: (f: FindingWithAnalysis) => void }) {
  const [modal, setModal] = useState<ModalState>(null);
  const m = (finding.metrics ?? {}) as Record<string, unknown>;

  const sessionId  = Number(m.session_id);
  const blockId    = Number(m.blocking_session_id);
  const isBlocked  = isFinite(blockId) && blockId > 0;
  const hasSession = isFinite(sessionId) && sessionId > 0;

  const elapsed = m.elapsed_seconds != null ? `${String(m.elapsed_seconds)} s` : "—";
  const cpu     = m.cpu_time_seconds != null ? `${String(m.cpu_time_seconds)} s` : "—";

  function openKill(sid: number, label: string, sqlField?: string) {
    setModal({
      type: "kill",
      sessionId: sid,
      sourceLabel: label,
      sqlText: sqlField ? String(m[sqlField] ?? "") || undefined : undefined,
    });
  }

  return (
    <>
      <tr
        className="border-b border-[var(--color-border)] hover:bg-[var(--color-row-hover)] cursor-pointer transition-colors"
        onClick={() => { onOpen(finding); setModal({ type: "metrics" }); }}
      >
        {/* Time */}
        <td className={TD}>
          <span className="font-code text-[11px] text-[var(--color-muted)]">{formatDetectedAt(finding.detected_at)}</span>
        </td>

        {/* Role+Node */}
        <td className={TD}><RoleNodeCell role={finding.role} node={finding.node} /></td>

        {/* Severity */}
        <td className={TD}><SeverityBadge severity={finding.severity as Severity} /></td>

        {/* Alert */}
        <td className={TD}><AlertStatusBadge status={finding.alert_status ?? ""} /></td>

        {/* Elapsed */}
        <td className={TD}><span className="tabular text-[var(--color-text-2)]">{elapsed}</span></td>

        {/* CPU */}
        <td className={TD}><span className="tabular text-[var(--color-text-2)]">{cpu}</span></td>

        {/* Login */}
        <td className={TD}><span className="text-[var(--color-text-2)]">{String(m.login_name ?? "—")}</span></td>

        {/* Host */}
        <td className={TD}><span className="text-[var(--color-text-2)] text-[12px]">{String(m.host_name ?? "—")}</span></td>

        {/* Session badge — click to kill */}
        <td className={TD} onClick={(e) => e.stopPropagation()}>
          {hasSession ? (
            <button
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold font-code bg-[var(--color-primary-soft)] text-[var(--color-primary)] border border-[color:color-mix(in_srgb,var(--color-primary)_30%,transparent)] hover:bg-[var(--color-primary)] hover:text-white transition-colors cursor-pointer"
              onClick={() => openKill(sessionId, "session_id", "sql_text")}
              title={`Kill session #${sessionId}`}
              aria-label={`Kill session #${sessionId}`}
            >
              #{sessionId}
            </button>
          ) : (
            <span className="text-[var(--color-subtle)] text-[12px]">—</span>
          )}
        </td>

        {/* Blocking badge — click to kill blocker */}
        <td className={TD} onClick={(e) => e.stopPropagation()}>
          {isBlocked ? (
            <button
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold font-code bg-[var(--color-critical-soft)] text-[var(--color-critical)] border border-[color:color-mix(in_srgb,var(--color-critical)_30%,transparent)] hover:bg-[var(--color-critical)] hover:text-white transition-colors cursor-pointer"
              onClick={() => openKill(blockId, "blocking_session_id", "blocker_sql_text")}
              title={`Kill blocking session #${blockId}`}
              aria-label={`Kill blocking session #${blockId}`}
            >
              #{blockId}
            </button>
          ) : (
            <span className="text-[var(--color-subtle)] text-[12px]">None</span>
          )}
        </td>

        {/* AI status */}
        <td className={TD}>
          <AiStatusBadge analyzed={finding.ai_analyzed} />
        </td>

        {/* Action */}
        <td className={TD} onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm" variant="ghost"
            disabled={!finding.ai_analyzed}
            onClick={() => setModal({ type: "ai" })}
          >
            AI Analysis
          </Button>
        </td>
      </tr>

      {/* Modals */}
      {modal?.type === "metrics" && (
        <SlowSessionMetricsModal finding={finding} onClose={() => setModal(null)} />
      )}
      {modal?.type === "ai" && (
        <AiAnalysisModal finding={finding} onClose={() => setModal(null)} />
      )}
      {modal?.type === "kill" && (
        <KillSessionConfirm
          sessionId={modal.sessionId}
          node={finding.node}
          clusterId={finding.cluster_id}
          sourceLabel={modal.sourceLabel}
          sqlText={modal.sqlText}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
