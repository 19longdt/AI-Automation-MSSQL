import { useState, type ReactNode } from "react";
import { RotateCcw, Gauge, Clock, CalendarClock, BrainCircuit } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { SyncHealthBadge, SuspendedBadge } from "@/components/shared/AgBadges";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useFindingById } from "@/hooks/useFindings";
import { useTopicMetricThreshold } from "@/hooks/useTopics";
import { thresholdTextClass } from "@/lib/topic-thresholds";
import { cn } from "@/lib/utils";
import type { FindingWithAnalysis } from "@/types";
import type { Severity } from "@layer3/core";

function FieldRow({ label, glossaryKey, children }: { label: string; glossaryKey?: string; children: ReactNode }): React.ReactElement {
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="w-40 py-2 pr-4 align-middle text-[12px] font-medium text-[var(--color-muted)]">
        {glossaryKey ? <GlossaryTip glossaryKey={glossaryKey}>{label}</GlossaryTip> : label}
      </td>
      <td className="py-2 align-middle">{children}</td>
    </tr>
  );
}

const SECTION = "text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2 mt-5 first:mt-0";

function KpiStrip({ m }: { m: Record<string, unknown> }): React.ReactElement {
  const redoQueueThreshold = useTopicMetricThreshold("ag_redo_secondary", "redo_queue_size", {
    warning: 1000,
    critical: 5000,
  });
  const redoLagThreshold = useTopicMetricThreshold("ag_redo_secondary", "redo_lag_ms", {
    warning: 30_000,
    critical: 120_000,
  });
  const redoQ = m.redo_queue_size != null ? Number(m.redo_queue_size) : null;
  const redoRate = m.redo_rate != null ? Number(m.redo_rate) : null;
  const redoLag = m.redo_lag_ms != null ? Number(m.redo_lag_ms) : null;
  const lastCommit = m.last_commit_time ? String(m.last_commit_time).slice(0, 19) : "-";

  return (
    <div className="grid grid-cols-4 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {[
        { icon: <RotateCcw className="h-3.5 w-3.5" />, label: "Redo Queue", glossaryKey: "redo_queue_size", value: redoQ != null ? `${redoQ.toLocaleString()} KB` : "-", cls: cn("font-code font-bold tabular", redoQ != null ? thresholdTextClass(redoQ, redoQueueThreshold) : "text-[var(--color-muted)]") },
        { icon: <Gauge className="h-3.5 w-3.5" />, label: "Redo Rate", glossaryKey: "redo_rate", value: redoRate != null ? `${redoRate.toLocaleString()} KB/s` : "-", cls: "font-code font-bold tabular text-[var(--color-text)]" },
        { icon: <Clock className="h-3.5 w-3.5" />, label: "Redo Lag", glossaryKey: "secondary_lag_seconds", value: redoLag != null ? `${redoLag.toLocaleString()} ms` : "-", cls: cn("font-code font-bold tabular", redoLag != null ? thresholdTextClass(redoLag, redoLagThreshold) : "text-[var(--color-muted)]") },
        { icon: <CalendarClock className="h-3.5 w-3.5" />, label: "Last Commit", glossaryKey: "last_commit_time", value: lastCommit, cls: "font-code font-bold tabular text-[var(--color-text)]" },
      ].map((kpi) => (
        <div key={kpi.label} className="flex flex-col gap-0.5 px-4 py-3">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            <span aria-hidden="true">{kpi.icon}</span>
            <GlossaryTip glossaryKey={kpi.glossaryKey}>{kpi.label}</GlossaryTip>
          </span>
          <span className={cn("text-[15px] leading-tight", kpi.cls)}>{kpi.value}</span>
        </div>
      ))}
    </div>
  );
}

function RedoDetailBody({ m }: { m: Record<string, unknown> }): React.ReactElement {
  const redoQueueThreshold = useTopicMetricThreshold("ag_redo_secondary", "redo_queue_size", {
    warning: 1000,
    critical: 5000,
  });
  const redoLagThreshold = useTopicMetricThreshold("ag_redo_secondary", "redo_lag_ms", {
    warning: 30_000,
    critical: 120_000,
  });
  const redoQ = m.redo_queue_size != null ? Number(m.redo_queue_size) : null;
  const redoRate = m.redo_rate != null ? Number(m.redo_rate) : null;
  const redoLag = m.redo_lag_ms != null ? Number(m.redo_lag_ms) : null;
  const lagSec = m.secondary_lag_seconds != null ? Number(m.secondary_lag_seconds) : null;

  return (
    <div>
      <p className={SECTION}>Sync Status</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Replica" glossaryKey="replica_server_name">{String(m.replica_server_name ?? "-")}</FieldRow>
          <FieldRow label="Database" glossaryKey="database_name"><span className="font-medium">{String(m.database_name ?? "-")}</span></FieldRow>
          <FieldRow label="Sync State" glossaryKey="synchronization_state_desc"><span className="font-code text-[12px]">{String(m.synchronization_state_desc ?? "-")}</span></FieldRow>
          <FieldRow label="Sync Health" glossaryKey="synchronization_health_desc"><SyncHealthBadge value={String(m.synchronization_health_desc ?? "")} /></FieldRow>
          <FieldRow label="Suspended" glossaryKey="is_suspended">
            <SuspendedBadge isSuspended={Number(m.is_suspended) === 1} reason={m.suspend_reason_desc ? String(m.suspend_reason_desc) : undefined} />
          </FieldRow>
        </tbody>
      </table>

      <p className={SECTION}>Redo Throughput</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Redo Queue" glossaryKey="redo_queue_size">
            {redoQ != null ? <span className={cn("font-code text-[12px] tabular", thresholdTextClass(redoQ, redoQueueThreshold))}>{redoQ.toLocaleString()} KB</span> : <span className="text-[var(--color-muted)]">-</span>}
          </FieldRow>
          <FieldRow label="Redo Rate" glossaryKey="redo_rate">
            {redoRate != null ? <span className="font-code text-[12px] tabular text-[var(--color-text)]">{redoRate.toLocaleString()} KB/s</span> : <span className="text-[var(--color-muted)]">-</span>}
          </FieldRow>
          <FieldRow label="Secondary Lag" glossaryKey="secondary_lag_seconds">
            {lagSec != null
              ? <span className={cn("font-code text-[12px] tabular", thresholdTextClass(lagSec * 1000, redoLagThreshold))}>{lagSec} s</span>
              : <span className="text-[var(--color-muted)]">-</span>}
          </FieldRow>
          <FieldRow label="Redo Lag (ms)">
            {redoLag != null ? <span className={cn("font-code text-[12px] tabular", thresholdTextClass(redoLag, redoLagThreshold))}>{redoLag.toLocaleString()} ms</span> : <span className="text-[var(--color-muted)]">-</span>}
          </FieldRow>
        </tbody>
      </table>

      <p className={SECTION}>Timeline</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Last Commit" glossaryKey="last_commit_time"><span className="font-code text-[12px] text-[var(--color-text-2)]">{String(m.last_commit_time ?? "-")}</span></FieldRow>
          <FieldRow label="Last Redone" glossaryKey="last_redone_time"><span className="font-code text-[12px] text-[var(--color-text-2)]">{String(m.last_redone_time ?? "-")}</span></FieldRow>
        </tbody>
      </table>
    </div>
  );
}

export function AgRedoSecondaryModal({ finding, onClose }: { finding: FindingWithAnalysis; onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState("detail");
  const { data: full, isLoading, isFetching } = useFindingById(finding.finding_id);
  const resolved = full ?? finding;
  const m = (resolved.metrics ?? {}) as Record<string, unknown>;
  const ai = resolved.ai_analysis;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(98vw,1400px)] overflow-hidden p-0">
        <DialogHeader className="px-5 py-3">
          <div className="flex items-center gap-2 flex-wrap pr-8">
            <DialogTitle className="flex items-center gap-2">
              AG Redo Secondary -
              <span className="font-normal text-[var(--color-muted)]">{String(m.replica_server_name ?? finding.node ?? "")}</span>
              <SeverityBadge severity={finding.severity as Severity} />
            </DialogTitle>
          </div>
        </DialogHeader>

        <KpiStrip m={m} />

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="shrink-0 px-5">
            <TabsTrigger value="detail">Detail</TabsTrigger>
            {resolved.ai_analyzed && (
              <TabsTrigger value="ai">
                <BrainCircuit className="mr-1 h-3.5 w-3.5" aria-hidden="true" />AI
              </TabsTrigger>
            )}
            {resolved.has_diagnostics && <TabsTrigger value="diag">Diagnostics</TabsTrigger>}
          </TabsList>

          <DialogBody className="pt-4">
            <TabsContent value="detail" className="relative mt-0">
              {isLoading ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div> : <RedoDetailBody m={m} />}
              <RefreshingOverlay visible={isFetching && !isLoading && !!full} tone="modal" />
            </TabsContent>

            {resolved.ai_analyzed && (
              <TabsContent value="ai" className="mt-0 space-y-4">
                {ai?.root_cause_summary && (
                  <div>
                    <p className={SECTION}>Root Cause</p>
                    <p className="text-[13px] leading-relaxed text-[var(--color-text)]">{ai.root_cause_summary}</p>
                  </div>
                )}
                {(ai?.top_actions?.length ?? 0) > 0 && (
                  <div>
                    <p className={SECTION}>Recommended Actions</p>
                    <ul className="space-y-1.5">
                      {ai!.top_actions.map((action, index) => (
                        <li key={index} className="flex items-start gap-2 text-[13px] text-[var(--color-text)]">
                          <span className="mt-0.5 shrink-0 font-bold text-[var(--color-primary)]">{"->"}</span>{action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {ai && (
                  <p className="border-t border-[var(--color-border)] pt-1 font-code text-[11px] text-[var(--color-muted)]">
                    {ai.model} · ${ai.cost_usd.toFixed(4)}
                  </p>
                )}
              </TabsContent>
            )}

            {resolved.has_diagnostics && (
              <TabsContent value="diag" className="mt-0">
                <DiagnosticsPanel findingId={resolved.finding_id} />
              </TabsContent>
            )}
          </DialogBody>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
