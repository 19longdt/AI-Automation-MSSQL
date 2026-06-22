import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { AlertStatusBadge } from "@/components/shared/AlertStatusBadge";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import type { FindingWithAnalysis } from "@/types";
import type { Severity } from "@layer3/core";

interface Props {
  finding: FindingWithAnalysis;
  onClose: () => void;
}

export function FindingDetailModal({ finding, onClose }: Props) {
  const [tab, setTab] = useState("detail");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(98vw,1200px)]">
        <DialogHeader className="px-5 py-3">
          <div className="flex items-center gap-2 flex-wrap pr-8">
            <DialogTitle className="font-code text-[13px]">{finding.finding_id}</DialogTitle>
            <SeverityBadge severity={finding.severity as Severity} />
            <AlertStatusBadge status={finding.alert_status ?? ""} />
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="px-5 shrink-0">
            <TabsTrigger value="detail">Detail</TabsTrigger>
            {finding.has_diagnostics && <TabsTrigger value="diag">Diagnostics</TabsTrigger>}
            {finding.ai_analyzed && <TabsTrigger value="ai">AI Analysis</TabsTrigger>}
          </TabsList>

          <DialogBody className="pt-4">
            <TabsContent value="detail" className="mt-0">
              <DetailTab finding={finding} />
            </TabsContent>

            {finding.has_diagnostics && (
              <TabsContent value="diag" className="mt-0">
                <DiagnosticsPanel findingId={finding.finding_id} />
              </TabsContent>
            )}

            {finding.ai_analyzed && finding.ai_analysis && (
              <TabsContent value="ai" className="mt-0">
                <AiAnalysisTab finding={finding} />
              </TabsContent>
            )}
          </DialogBody>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DetailTab({ finding }: { finding: FindingWithAnalysis }) {
  const metrics = finding.metrics ?? {};
  const entries: Array<[string, unknown]> = [
    ["Finding ID", finding.finding_id],
    ["Detected At", finding.detected_at],
    ["Topic", finding.topic_id],
    ["Issue Type", finding.issue_type],
    ["Node", finding.node],
    ["Role", finding.role],
    ["Status", finding.status],
    ["Finding Hash", finding.finding_hash],
  ];
  const isPleFinding = finding.topic_id === "tempdb_memory" && hasNumeric(metrics.ple_sec);

  return (
    <div className="space-y-4">
      <table className="w-full text-[13px]">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b border-[var(--color-border)]">
              <td className="py-2 pr-4 font-medium text-[var(--color-muted)] w-32 shrink-0">{key}</td>
              <td className="py-2 font-code text-[var(--color-text)]">{String(value ?? "-")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {isPleFinding && <PleSummary metrics={metrics} severity={finding.severity as Severity} />}

      {finding.metrics && Object.keys(finding.metrics).length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">Metrics</p>
          <pre className="p-3 rounded-lg bg-[var(--color-code-bg)] text-[var(--color-code-text)] text-[11px] font-code overflow-x-auto">
            {JSON.stringify(finding.metrics, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function PleSummary({
  metrics,
  severity,
}: {
  metrics: Record<string, unknown>;
  severity: Severity;
}) {
  const ple = toNumber(metrics.ple_sec);
  const warning = toNumber(metrics.threshold_warning);
  const critical = toNumber(metrics.threshold_critical);
  const pendingGrants = toNumber(metrics.pending_grants);
  const numaNode = typeof metrics.numa_node === "string" ? metrics.numa_node : null;
  const tone = severityTone(severity);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">PLE Signal</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[20px] font-bold tabular ${tone}`}>
              {formatSeconds(ple)}
            </span>
            {numaNode && <span className="text-[12px] text-[var(--color-text-2)]">{numaNode}</span>}
          </div>
        </div>
        <div className="text-right text-[12px] text-[var(--color-text-2)]">
          <div>Warning: {formatSeconds(warning)}</div>
          <div>Critical: {formatSeconds(critical)}</div>
        </div>
      </div>

      {(pendingGrants !== null || numaNode) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--color-text-2)]">
          {pendingGrants !== null && <span>Pending grants: {pendingGrants}</span>}
          {numaNode && <span>NUMA node specific reading</span>}
        </div>
      )}
    </div>
  );
}

function AiAnalysisTab({ finding }: { finding: FindingWithAnalysis }) {
  const analysis = finding.ai_analysis;
  if (!analysis) return <p className="text-[var(--color-muted)] text-[13px]">No analysis data.</p>;

  return (
    <div className="space-y-4">
      {analysis.root_cause_summary && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1">Root Cause</p>
          <p className="text-[13px] text-[var(--color-text)] leading-relaxed">{analysis.root_cause_summary}</p>
        </div>
      )}
      {analysis.top_actions?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1">Top Actions</p>
          <ul className="space-y-1">
            {analysis.top_actions.map((action, index) => (
              <li key={index} className="text-[13px] text-[var(--color-text)] flex items-start gap-2">
                <span className="text-[var(--color-primary)] mt-0.5">-&gt;</span>
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-[11px] text-[var(--color-muted)] font-code">
        Model: {analysis.model} | Cost: ${analysis.cost_usd?.toFixed(4)} | {analysis.completed_at?.slice(0, 19)}
      </div>
    </div>
  );
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

function hasNumeric(value: unknown): boolean {
  return toNumber(value) !== null;
}

function formatSeconds(value: number | null): string {
  if (value === null) return "-";
  return `${Math.round(value).toLocaleString()}s`;
}

function severityTone(severity: Severity): string {
  if (severity === "CRITICAL") {
    return "border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
  }
  if (severity === "WARNING") {
    return "border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
  }
  return "border-[color:color-mix(in_srgb,var(--color-success)_25%,transparent)] bg-[var(--color-success-soft)] text-[var(--color-success)]";
}
