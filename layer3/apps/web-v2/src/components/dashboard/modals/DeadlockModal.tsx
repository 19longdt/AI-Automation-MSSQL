import { useState, type ReactNode } from "react";
import { BrainCircuit, Clock, Copy, Server, Shield, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useFindingById } from "@/hooks/useFindings";
import { cn } from "@/lib/utils";
import { formatDetectedAt } from "@/lib/format";
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

function KpiStrip({ victimId, deadlockTime, node, role }: { victimId: string | null; deadlockTime: string | null; node: string; role: string }): React.ReactElement {
  return (
    <div className="grid grid-cols-4 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {[
        { icon: <Swords className="h-3.5 w-3.5" />, label: "Victim", glossaryKey: "deadlock_victim", value: victimId != null ? `#${victimId}` : "-", cls: "font-code font-bold tabular text-[var(--color-critical)]" },
        { icon: <Clock className="h-3.5 w-3.5" />, label: "Deadlock Time", glossaryKey: "deadlock_time", value: deadlockTime ? formatDetectedAt(deadlockTime) : "-", cls: "font-code font-bold tabular text-[var(--color-text)]" },
        { icon: <Server className="h-3.5 w-3.5" />, label: "Node", value: node || "-", cls: "font-bold text-[var(--color-text)]" },
        { icon: <Shield className="h-3.5 w-3.5" />, label: "Role", value: role || "-", cls: cn("font-bold", role?.toLowerCase() === "primary" && "text-[var(--color-role-primary)]", role?.toLowerCase() === "secondary" && "text-[var(--color-role-secondary)]") },
      ].map((kpi) => (
        <div key={kpi.label} className="flex flex-col gap-0.5 px-4 py-3">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            <span aria-hidden="true">{kpi.icon}</span>
            {"glossaryKey" in kpi && kpi.glossaryKey ? <GlossaryTip glossaryKey={kpi.glossaryKey}>{kpi.label}</GlossaryTip> : kpi.label}
          </span>
          <span className={cn("text-[15px] leading-tight", kpi.cls)}>{kpi.value}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryBody({ finding, m }: { finding: FindingWithAnalysis; m: Record<string, unknown> }): React.ReactElement {
  return (
    <div>
      <p className={SECTION}>Event</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Detected"><span className="font-code text-[12px]">{formatDetectedAt(finding.detected_at)}</span></FieldRow>
          <FieldRow label="Deadlock Time" glossaryKey="deadlock_time"><span className="font-code text-[12px]">{m.deadlock_time ? formatDetectedAt(String(m.deadlock_time)) : "-"}</span></FieldRow>
          <FieldRow label="Node"><span className="font-code text-[12px]">{finding.node ?? "-"}</span></FieldRow>
          <FieldRow label="Role"><span className="font-code text-[12px]">{finding.role ?? "-"}</span></FieldRow>
          <FieldRow label="Severity"><SeverityBadge severity={finding.severity as Severity} /></FieldRow>
        </tbody>
      </table>

      <p className={SECTION}>Victim</p>
      <table className="w-full border-collapse">
        <tbody>
          <FieldRow label="Victim ID" glossaryKey="deadlock_victim">
            {m.victim_id != null ? <span className="font-code font-bold tabular text-[var(--color-critical)]">#{String(m.victim_id)}</span> : <span className="text-[var(--color-muted)]">-</span>}
          </FieldRow>
        </tbody>
      </table>
    </div>
  );
}

function AiTabBody({ finding }: { finding: FindingWithAnalysis }): React.ReactElement {
  const analysis = finding.ai_analysis;
  const [expanded, setExpanded] = useState(false);
  if (!analysis) return <p className="text-[13px] text-[var(--color-muted)]">No analysis data.</p>;
  return (
    <div className="space-y-4">
      {analysis.root_cause_summary && (
        <div>
          <p className={SECTION}>Root Cause</p>
          <p className="text-[13px] leading-relaxed text-[var(--color-text)]">{analysis.root_cause_summary}</p>
        </div>
      )}
      {analysis.top_actions?.length > 0 && (
        <div>
          <p className={SECTION}>Recommended Actions</p>
          <ul className="space-y-1.5">
            {analysis.top_actions.map((action, index) => (
              <li key={index} className="flex items-start gap-2 text-[13px] text-[var(--color-text)]">
                <span className="mt-0.5 shrink-0 font-bold text-[var(--color-primary)]">{"->"}</span>{action}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]">
          Analysis Text <span className="normal-case font-normal opacity-60">{expanded ? "collapse" : "expand"}</span>
        </button>
        {expanded && (
          <pre className="max-h-56 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] text-[var(--color-code-text)]">
            {analysis.analysis_text}
          </pre>
        )}
      </div>
      <p className="border-t border-[var(--color-border)] pt-1 font-code text-[11px] text-[var(--color-muted)]">{analysis.model} · ${analysis.cost_usd?.toFixed(4)}</p>
    </div>
  );
}

export function DeadlockModal({ finding, onClose }: { finding: FindingWithAnalysis; onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState("summary");
  const { data: full, isLoading } = useFindingById(finding.finding_id);
  const resolved = full ?? finding;
  const m = (resolved.metrics ?? {}) as Record<string, unknown>;

  const victimId = m.victim_id != null ? String(m.victim_id) : null;
  const deadlockTs = m.deadlock_time != null ? String(m.deadlock_time) : null;
  const victimQuery = m.victim_query != null ? String(m.victim_query) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(92vw,860px)] overflow-hidden p-0">
        <DialogHeader className="px-5 pt-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            Deadlock - Victim <span className="font-code text-[var(--color-critical)]">{victimId != null ? `#${victimId}` : "-"}</span>
            <SeverityBadge severity={finding.severity as Severity} />
          </DialogTitle>
        </DialogHeader>

        <KpiStrip victimId={victimId} deadlockTime={deadlockTs} node={resolved.node} role={resolved.role} />

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="shrink-0 px-5">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="victim_query">Victim Query</TabsTrigger>
            {resolved.ai_analyzed && (
              <TabsTrigger value="ai">
                <BrainCircuit className="mr-1 h-3.5 w-3.5" aria-hidden="true" />AI
              </TabsTrigger>
            )}
            <TabsTrigger value="raw">Raw</TabsTrigger>
            {resolved.has_diagnostics && <TabsTrigger value="diag">Diagnostics</TabsTrigger>}
          </TabsList>

          <DialogBody className="pt-4">
            <TabsContent value="summary" className="mt-0">
              {isLoading ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div> : <SummaryBody finding={resolved} m={m} />}
            </TabsContent>
            <TabsContent value="victim_query" className="mt-0 space-y-3">
              <pre className="min-h-[80px] overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] text-[var(--color-code-text)]">
                {victimQuery ?? "No query captured."}
              </pre>
              {victimQuery && (
                <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(victimQuery)} aria-label="Copy victim SQL to clipboard">
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Copy SQL
                </Button>
              )}
            </TabsContent>
            {resolved.ai_analyzed && (
              <TabsContent value="ai" className="mt-0">
                <AiTabBody finding={resolved} />
              </TabsContent>
            )}
            <TabsContent value="raw" className="mt-0">
              <pre className="max-h-[400px] overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] text-[var(--color-code-text)]">
                {JSON.stringify({ finding_id: resolved.finding_id, issue_type: resolved.issue_type, detected_at: resolved.detected_at, node: resolved.node, role: resolved.role, severity: resolved.severity, metrics: resolved.metrics }, null, 2)}
              </pre>
            </TabsContent>
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
