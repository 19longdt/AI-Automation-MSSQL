import { useState, type ReactNode } from "react";
import { Activity, Wifi, HardDrive, Zap, BrainCircuit } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { SyncHealthBadge, ConnectedBadge, SuspendedBadge, FailoverBadge } from "@/components/shared/AgBadges";
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
  const logSendQueueThreshold = useTopicMetricThreshold("ag_health", "log_send_queue_size", {
    warning: 500,
    critical: 1000,
  });
  const health = String(m.synchronization_health_desc ?? "-");
  const conn = String(m.connected_state_desc ?? "-");
  const logQ = m.log_send_queue_size != null ? Number(m.log_send_queue_size) : null;
  const logRate = m.log_send_rate != null ? Number(m.log_send_rate) : null;

  const healthCls =
    health === "NOT_HEALTHY" ? "text-[var(--color-critical)]"
    : health === "PARTIALLY_HEALTHY" ? "text-[var(--color-warning)]"
    : health === "-" ? "text-[var(--color-muted)]"
    : "text-[var(--color-success)]";
  const connCls = conn === "DISCONNECTED" ? "text-[var(--color-critical)]" : conn === "-" ? "text-[var(--color-muted)]" : "text-[var(--color-success)]";

  return (
    <div className="grid grid-cols-4 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {[
        { icon: <Activity className="h-3.5 w-3.5" />, label: "Sync Health", glossaryKey: "synchronization_health_desc", value: health, cls: cn("font-bold", healthCls) },
        { icon: <Wifi className="h-3.5 w-3.5" />, label: "Connected", glossaryKey: "connected_state_desc", value: conn, cls: cn("font-bold", connCls) },
        { icon: <HardDrive className="h-3.5 w-3.5" />, label: "Log Send Q", glossaryKey: "log_send_queue_size", value: logQ != null ? `${logQ.toLocaleString()} KB` : "-", cls: cn("font-code font-bold tabular", logQ != null ? thresholdTextClass(logQ, logSendQueueThreshold) : "text-[var(--color-muted)]") },
        { icon: <Zap className="h-3.5 w-3.5" />, label: "Log Rate", glossaryKey: "log_send_rate", value: logRate != null ? `${logRate.toLocaleString()} KB/s` : "-", cls: "font-code font-bold tabular text-[var(--color-text)]" },
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

function CdcBody({ m }: { m: Record<string, unknown> }): React.ReactElement {
  const ok = Number(m.run_status) === 1;
  return (
    <div className="space-y-3">
      <p className={SECTION}>CDC Job</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Job" glossaryKey="job_name">{String(m.job_name ?? "-")}</FieldRow>
          <FieldRow label="Run Status" glossaryKey="run_status">
            <span className={cn("font-semibold", ok ? "text-[var(--color-success)]" : "text-[var(--color-critical)]")}>
              {ok ? "Succeeded" : "Failed"}
            </span>
          </FieldRow>
          <FieldRow label="Duration" glossaryKey="run_duration"><span className="font-code text-[12px]">{String(m.run_duration ?? "-")}</span></FieldRow>
          <FieldRow label="Node" glossaryKey="node_name"><span className="font-code text-[12px]">{String(m.node_name ?? "-")}</span></FieldRow>
          <FieldRow label="Message" glossaryKey="message"><span className="text-[12px] text-[var(--color-text-2)]">{String(m.message ?? "-")}</span></FieldRow>
        </tbody>
      </table>
    </div>
  );
}

function AgHealthBody({ m }: { m: Record<string, unknown> }): React.ReactElement {
  const logSendQueueThreshold = useTopicMetricThreshold("ag_health", "log_send_queue_size", {
    warning: 500,
    critical: 1000,
  });
  const logQ = m.log_send_queue_size != null ? Number(m.log_send_queue_size) : null;
  const logRate = m.log_send_rate != null ? Number(m.log_send_rate) : null;

  return (
    <div>
      <p className={SECTION}>Sync Status</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Replica" glossaryKey="replica_server_name">{String(m.replica_server_name ?? "-")}</FieldRow>
          <FieldRow label="Database" glossaryKey="database_name"><span className="font-medium">{String(m.database_name ?? "-")}</span></FieldRow>
          <FieldRow label="Role" glossaryKey="role_desc"><span className="font-code text-[12px]">{String(m.role_desc ?? "-")}</span></FieldRow>
          <FieldRow label="Sync State" glossaryKey="synchronization_state_desc"><span className="font-code text-[12px]">{String(m.synchronization_state_desc ?? "-")}</span></FieldRow>
          <FieldRow label="Sync Health" glossaryKey="synchronization_health_desc"><SyncHealthBadge value={String(m.synchronization_health_desc ?? "")} /></FieldRow>
          <FieldRow label="Connected" glossaryKey="connected_state_desc"><ConnectedBadge value={String(m.connected_state_desc ?? "")} /></FieldRow>
          <FieldRow label="Operational" glossaryKey="operational_state_desc"><span className="font-code text-[12px]">{String(m.operational_state_desc ?? "-")}</span></FieldRow>
        </tbody>
      </table>

      <p className={SECTION}>Log Throughput</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Log Send Queue" glossaryKey="log_send_queue_size">
            {logQ != null ? <span className={cn("font-code text-[12px] tabular", thresholdTextClass(logQ, logSendQueueThreshold))}>{logQ.toLocaleString()} KB</span> : <span className="text-[var(--color-muted)]">-</span>}
          </FieldRow>
          <FieldRow label="Log Send Rate" glossaryKey="log_send_rate">
            {logRate != null ? <span className="font-code text-[12px] tabular text-[var(--color-text)]">{logRate.toLocaleString()} KB/s</span> : <span className="text-[var(--color-muted)]">-</span>}
          </FieldRow>
        </tbody>
      </table>

      <p className={SECTION}>Suspend & Failover</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Suspended" glossaryKey="is_suspended"><SuspendedBadge isSuspended={Number(m.is_suspended) === 1} reason={m.suspend_reason_desc ? String(m.suspend_reason_desc) : undefined} /></FieldRow>
          <FieldRow label="Suspend Reason" glossaryKey="suspend_reason_desc"><span className="font-code text-[12px]">{String(m.suspend_reason_desc ?? "-")}</span></FieldRow>
          <FieldRow label="Failover Ready" glossaryKey="is_failover_ready"><FailoverBadge value={m.is_failover_ready} /></FieldRow>
        </tbody>
      </table>
    </div>
  );
}

export function AgHealthModal({ finding, onClose }: { finding: FindingWithAnalysis; onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState("detail");
  const { data: full, isLoading, isFetching } = useFindingById(finding.finding_id);
  const resolved = full ?? finding;
  const m = (resolved.metrics ?? {}) as Record<string, unknown>;
  const ai = resolved.ai_analysis;
  const isCdc = String(finding.issue_type ?? "").includes("cdc") || !!m.job_name;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(98vw,1400px)] overflow-hidden p-0">
        <DialogHeader className="px-5 py-3">
          <div className="flex items-center gap-2 flex-wrap pr-8">
            <DialogTitle className="flex items-center gap-2">
              AG Health -
              <span className="font-normal text-[var(--color-muted)]">{String(m.replica_server_name ?? finding.node ?? "")}</span>
              <SeverityBadge severity={finding.severity as Severity} />
            </DialogTitle>
          </div>
        </DialogHeader>

        {!isCdc && <KpiStrip m={m} />}

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
              {isLoading
                ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
                : isCdc ? <CdcBody m={m} /> : <AgHealthBody m={m} />}
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
