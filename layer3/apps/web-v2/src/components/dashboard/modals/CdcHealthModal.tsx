import { useState, type ReactNode } from "react";
import { BrainCircuit, CheckCircle2, Clock, Database, RefreshCw, Server, XCircle } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useFindingById } from "@/hooks/useFindings";
import { cn } from "@/lib/utils";
import type { FindingWithAnalysis } from "@/types";
import type { Severity } from "@layer3/core";

const SECTION = "text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2 mt-5 first:mt-0";

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

type CdcStatus = "FAILED" | "RETRY" | "OK";

function resolveCdcStatus(m: Record<string, unknown>): CdcStatus {
  if (Number(m.cdc_job_failed) === 1) return "FAILED";
  if (Number(m.cdc_job_retry) === 1) return "RETRY";
  return "OK";
}

function StatusBadgeLarge({ status }: { status: CdcStatus }): React.ReactElement {
  if (status === "FAILED") return <span className="inline-flex items-center gap-1.5 rounded border border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[var(--color-critical-soft)] px-2.5 py-1 text-[13px] font-bold text-[var(--color-critical)]"><XCircle className="h-4 w-4" aria-hidden="true" />FAILED</span>;
  if (status === "RETRY") return <span className="inline-flex items-center gap-1.5 rounded border border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)] bg-[var(--color-warning-soft)] px-2.5 py-1 text-[13px] font-bold text-[var(--color-warning)]"><RefreshCw className="h-4 w-4" aria-hidden="true" />RETRY</span>;
  return <span className="inline-flex items-center gap-1.5 rounded border border-[color:color-mix(in_srgb,var(--color-success)_25%,transparent)] bg-[var(--color-success-soft)] px-2.5 py-1 text-[13px] font-bold text-[var(--color-success)]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />OK</span>;
}

function KpiStrip({ m, status }: { m: Record<string, unknown>; status: CdcStatus }): React.ReactElement {
  const jobName = m.job_name ? String(m.job_name) : "-";
  const duration = m.run_duration ? String(m.run_duration) : "-";
  const node = m.node_name ? String(m.node_name) : "-";
  const statusCls = status === "FAILED" ? "text-[var(--color-critical)] font-bold" : status === "RETRY" ? "text-[var(--color-warning)] font-bold" : "text-[var(--color-success)] font-bold";

  return (
    <div className="grid grid-cols-4 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {[
        { icon: <XCircle className="h-3.5 w-3.5" />, label: "Status", glossaryKey: "run_status", value: status, cls: statusCls },
        { icon: <Database className="h-3.5 w-3.5" />, label: "Job", glossaryKey: "job_name", value: jobName, cls: "font-code font-bold text-[var(--color-text)]" },
        { icon: <Clock className="h-3.5 w-3.5" />, label: "Duration", glossaryKey: "run_duration", value: duration, cls: "font-code font-bold tabular text-[var(--color-text)]" },
        { icon: <Server className="h-3.5 w-3.5" />, label: "Node", glossaryKey: "node_name", value: node, cls: "font-bold text-[var(--color-text)]" },
      ].map((kpi) => (
        <div key={kpi.label} className="flex flex-col gap-0.5 px-4 py-3">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            <span aria-hidden="true">{kpi.icon}</span>
            <GlossaryTip glossaryKey={kpi.glossaryKey}>{kpi.label}</GlossaryTip>
          </span>
          <span className={cn("truncate text-[15px] leading-tight", kpi.cls)}>{kpi.value}</span>
        </div>
      ))}
    </div>
  );
}

function DetailBody({ m, status }: { m: Record<string, unknown>; status: CdcStatus }): React.ReactElement {
  return (
    <div>
      <p className={SECTION}>Job Info</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Job Name" glossaryKey="job_name"><span className="font-code text-[12px]">{String(m.job_name ?? "-")}</span></FieldRow>
          <FieldRow label="Status" glossaryKey="run_status"><StatusBadgeLarge status={status} /></FieldRow>
          <FieldRow label="Run Duration" glossaryKey="run_duration"><span className="font-code text-[12px] tabular">{String(m.run_duration ?? "-")}</span></FieldRow>
          <FieldRow label="Node" glossaryKey="node_name"><span className="font-code text-[12px]">{String(m.node_name ?? "-")}</span></FieldRow>
        </tbody>
      </table>

      {Boolean(m.message) && (
        <>
          <p className={SECTION}>Message</p>
          <div className={cn("rounded-lg border p-3 font-code text-[12px] leading-relaxed", status === "FAILED" ? "border-[color:color-mix(in_srgb,var(--color-critical)_20%,transparent)] bg-[var(--color-critical-soft)] text-[var(--color-critical)]" : "border-[var(--color-border)] bg-[var(--color-surface-3)] text-[var(--color-text-2)]")}>
            {String(m.message)}
          </div>
        </>
      )}
    </div>
  );
}

export function CdcHealthModal({ finding, onClose }: { finding: FindingWithAnalysis; onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState("detail");
  const { data: full, isLoading, isFetching } = useFindingById(finding.finding_id);
  const resolved = full ?? finding;
  const m = (resolved.metrics ?? {}) as Record<string, unknown>;
  const ai = resolved.ai_analysis;
  const status = resolveCdcStatus(m);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(98vw,1400px)] overflow-hidden p-0">
        <DialogHeader className="px-5 py-3">
          <div className="flex items-center gap-2 flex-wrap pr-8">
            <DialogTitle className="flex items-center gap-2">
              CDC Health - <span className="font-normal text-[var(--color-muted)]">{String(m.job_name ?? finding.node ?? "")}</span>
              <SeverityBadge severity={finding.severity as Severity} />
            </DialogTitle>
          </div>
        </DialogHeader>

        <KpiStrip m={m} status={status} />

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
              {isLoading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div> : <DetailBody m={m} status={status} />}
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
