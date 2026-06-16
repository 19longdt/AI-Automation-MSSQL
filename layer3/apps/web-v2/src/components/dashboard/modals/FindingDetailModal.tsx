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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
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
  const entries: Array<[string, unknown]> = [
    ["Finding ID",    finding.finding_id],
    ["Detected At",   finding.detected_at],
    ["Topic",         finding.topic_id],
    ["Issue Type",    finding.issue_type],
    ["Node",          finding.node],
    ["Role",          finding.role],
    ["Status",        finding.status],
    ["Finding Hash",  finding.finding_hash],
  ];

  return (
    <div className="space-y-4">
      <table className="w-full text-[13px]">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-[var(--color-border)]">
              <td className="py-2 pr-4 font-medium text-[var(--color-muted)] w-32 shrink-0">{k}</td>
              <td className="py-2 font-code text-[var(--color-text)]">{String(v ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>

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

function AiAnalysisTab({ finding }: { finding: FindingWithAnalysis }) {
  const a = finding.ai_analysis;
  if (!a) return <p className="text-[var(--color-muted)] text-[13px]">No analysis data.</p>;

  return (
    <div className="space-y-4">
      {a.root_cause_summary && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1">Root Cause</p>
          <p className="text-[13px] text-[var(--color-text)] leading-relaxed">{a.root_cause_summary}</p>
        </div>
      )}
      {a.top_actions?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1">Top Actions</p>
          <ul className="space-y-1">
            {a.top_actions.map((action, i) => (
              <li key={i} className="text-[13px] text-[var(--color-text)] flex items-start gap-2">
                <span className="text-[var(--color-primary)] mt-0.5">→</span>
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-[11px] text-[var(--color-muted)] font-code">
        Model: {a.model} · Cost: ${a.cost_usd?.toFixed(4)} · {a.completed_at?.slice(0,19)}
      </div>
    </div>
  );
}
