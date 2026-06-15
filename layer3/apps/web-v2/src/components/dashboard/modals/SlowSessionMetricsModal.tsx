import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { QpCanvas } from "@/components/plan/QpCanvas";
import { PlanAnalysisPanel } from "@/components/plan/PlanAnalysisPanel";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { useFindingById } from "@/hooks/useFindings";
import { apiPost } from "@/lib/api-client";
import type { FindingWithAnalysis } from "@/types";
import type { PlanAnalysisResult } from "@layer3/core";
import type { Severity } from "@layer3/core";

interface Props {
  finding: FindingWithAnalysis;
  onClose: () => void;
}

function PlanBox({ xml, sqlFallback, onError }: { xml: string; sqlFallback?: string; onError?(msg: string): void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const trimmed = xml.trim();

    if (!trimmed) {
      const fb = (sqlFallback ?? "").trim();
      el.innerHTML = fb
        ? `<div style="padding:12px 14px">
             <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">SQL Text</div>
             <pre style="font-family:Consolas,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;margin:0;color:#172033">${fb.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
           </div>`
        : `<p style="font-size:13px;color:#64748b;padding:12px 14px;margin:0">No execution plan available.</p>`;
      return;
    }

    return undefined;
  }, [xml, sqlFallback, onError]);

  return (
    <div>
      {xml.trim() ? (
        <QpCanvas
          xml={xml}
          compact
          onError={onError}
          ariaLabel="Execution plan preview"
          style={{ "--qp-block-height": "420px", "--qp-block-height-dvh": "420px", minHeight: 80 } as React.CSSProperties}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
          <div
            ref={ref}
            className="min-h-[80px]"
            aria-label="Execution plan preview"
          />
        </div>
      )}
    </div>
  );
}

function AnalyzeDropdown({ onAnalyze, disabled }: { onAnalyze(kind: "compile" | "actual"): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen(v => !v)} className="gap-1">
        Analyze <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[150px] overflow-hidden rounded-lg border border-[var(--color-border-2)] bg-[var(--color-surface)] shadow-lg animate-[fade-in_100ms_ease]">
            {(["compile", "actual"] as const).map(kind => (
              <button
                key={kind}
                className="w-full cursor-pointer px-3 py-2 text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--color-row-hover)]"
                onClick={() => { setOpen(false); onAnalyze(kind); }}
              >
                {kind === "compile" ? "Compile XML" : "Actual XML"}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const PLAN_FIELDS = new Set(["query_plan_xml", "actual_plan_xml", "blocker_plan_xml"]);

function MetricTable({
  fields, metrics, planPayload, onOpenPlan,
}: {
  fields: string[];
  metrics: Record<string, unknown>;
  planPayload: Record<string, string>;
  onOpenPlan(xml: string, sqlFallback: string): void;
}) {
  function asText(v: unknown): string {
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
      <div className="overflow-x-auto">
        <table className="border-collapse text-[12px]" style={{ minWidth: "100%" }}>
          <thead>
            <tr className="bg-[var(--color-surface-2)]">
              {fields.map(f => (
                <th
                  key={f}
                  className="whitespace-nowrap border-b border-r border-[var(--color-border)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]"
                >
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr
              className="cursor-pointer transition-colors hover:bg-[var(--color-row-hover)]"
              title="Click to show execution plan"
              onClick={() => {
                const xml = planPayload.query_plan_xml || planPayload.actual_plan_xml || planPayload.blocker_plan_xml || "";
                const sql = planPayload.sql_text || planPayload.blocker_sql_text || "";
                if (xml || sql) onOpenPlan(xml, sql);
              }}
            >
              {fields.map(f => {
                const isPlan = PLAN_FIELDS.has(f);
                const val = asText(metrics[f]);
                return (
                  <td
                    key={f}
                    className="align-top border-b border-r border-[var(--color-border)] px-3 py-2"
                    style={{ maxWidth: 200 }}
                  >
                    {isPlan ? (
                      val ? (
                        <button
                          className="inline-flex cursor-pointer items-center whitespace-nowrap rounded border border-[color:color-mix(in_srgb,var(--color-primary)_30%,transparent)] bg-[var(--color-primary-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)] hover:text-white"
                          onClick={e => {
                            e.stopPropagation();
                            const xml = planPayload[f] ?? "";
                            const sql = f === "blocker_plan_xml"
                              ? planPayload.blocker_sql_text ?? ""
                              : planPayload.sql_text ?? "";
                            onOpenPlan(xml, sql);
                          }}
                        >
                          Open Plan
                        </button>
                      ) : (
                        <span className="text-[var(--color-subtle)]">-</span>
                      )
                    ) : (
                      <pre
                        className="m-0 max-h-16 overflow-y-auto whitespace-pre-wrap break-all font-code text-[12px] text-[var(--color-text)]"
                      >
                        {val || "-"}
                      </pre>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanAnalysisOverlay({ result, onClose }: { result: PlanAnalysisResult; onClose(): void }) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="w-[min(95vw,1100px)] max-h-[90vh] p-0"
        hideClose
      >
        <DialogHeader className="px-5 py-3">
          <DialogTitle>Plan Analysis</DialogTitle>
          <button
            onClick={onClose}
            className="ml-auto text-[18px] leading-none text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] cursor-pointer"
            aria-label="Close plan analysis"
          >
            ×
          </button>
        </DialogHeader>
        <DialogBody className="p-0">
          <PlanAnalysisPanel result={result} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

const SESSION_FIELDS = ["session_id", "query_hash", "elapsed_seconds", "cpu_time_seconds", "logical_reads", "command", "host_name", "query_plan_xml", "actual_plan_xml"];
const BLOCKING_FIELDS = ["blocking_session_id", "wait_type", "wait_seconds", "blocker_login", "blocker_host", "blocker_status", "blocker_open_txn", "wait_resource", "blocker_plan_xml"];

export function SlowSessionMetricsModal({ finding, onClose }: Props) {
  const { data: full, isLoading } = useFindingById(finding.finding_id);
  const resolved = full ?? finding;
  const m = (resolved.metrics ?? {}) as Record<string, unknown>;

  const s = (k: string) => String(m[k] ?? "").trim();
  const planPayload = {
    sql_text: s("sql_text"),
    query_plan_xml: s("query_plan_xml"),
    actual_plan_xml: s("actual_plan_xml"),
    blocker_sql_text: s("blocker_sql_text"),
    blocker_plan_xml: s("blocker_plan_xml"),
  };

  const hasBlocking = Number(m.blocking_session_id) > 0;
  const hasPlan = !!(planPayload.query_plan_xml || planPayload.actual_plan_xml);

  const [planXml, setPlanXml] = useState("");
  const [planSql, setPlanSql] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const [planAnalysis, setPlanAnalysis] = useState<PlanAnalysisResult | null>(null);

  const ai = resolved.ai_analysis;

  useEffect(() => {
    if (planPayload.query_plan_xml) {
      setPlanXml(planPayload.query_plan_xml);
      setPlanSql(planPayload.sql_text);
    } else if (planPayload.actual_plan_xml) {
      setPlanXml(planPayload.actual_plan_xml);
      setPlanSql(planPayload.sql_text);
    } else if (planPayload.sql_text) {
      setPlanXml("");
      setPlanSql(planPayload.sql_text);
    }
  }, [planPayload.query_plan_xml, planPayload.actual_plan_xml, planPayload.sql_text]);

  const handleOpenPlan = useCallback((xml: string, sql: string) => {
    setPlanError(null);
    setPlanXml(xml);
    setPlanSql(sql);
  }, []);

  const analyzeMutation = useMutation({
    mutationFn: (xml: string) => apiPost<PlanAnalysisResult>("/api/plan/analyze", { plan_xml: xml }),
    onSuccess: data => setPlanAnalysis(data),
    onError: err => toast.error("Plan analysis failed", { description: err instanceof Error ? err.message : "Check Layer 2" }),
  });

  function handleAnalyze(kind: "compile" | "actual") {
    const xml = kind === "actual" ? planPayload.actual_plan_xml : planPayload.query_plan_xml;
    if (!xml) {
      toast.error(`No ${kind === "actual" ? "Actual" : "Compile"} XML available`);
      return;
    }
    analyzeMutation.mutate(xml);
  }

  return (
    <>
      <Dialog open onOpenChange={o => !o && onClose()}>
        <DialogContent className="w-[min(98vw,1400px)] max-h-[90vh]">
          <DialogHeader className="px-4 py-3">
            <div className="flex w-full items-center justify-between gap-3 pr-8">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="font-code text-[13px]">{finding.finding_id}</DialogTitle>
                <SeverityBadge severity={finding.severity as Severity} />
              </div>
              <AnalyzeDropdown onAnalyze={handleAnalyze} disabled={!hasPlan || analyzeMutation.isPending} />
            </div>
          </DialogHeader>

          <DialogBody className="space-y-3 p-4">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
              </div>
            ) : (
              <>
                <MetricTable
                  fields={SESSION_FIELDS}
                  metrics={m}
                  planPayload={planPayload}
                  onOpenPlan={handleOpenPlan}
                />

                {hasBlocking && (
                  <MetricTable
                    fields={BLOCKING_FIELDS}
                    metrics={m}
                    planPayload={planPayload}
                    onOpenPlan={handleOpenPlan}
                  />
                )}

                {(planXml || planSql) && (
                  <div className="rounded-lg border border-[var(--color-border)]">
                    {/*<div className="flex items-center justify-end px-3 py-1.5">*/}
                    {/*  <div className="flex items-center gap-2">*/}
                    {/*    {analyzeMutation.isPending && (*/}
                    {/*      <span className="text-[11px] text-[var(--color-muted)] animate-pulse">Analyzing...</span>*/}
                    {/*    )}*/}
                    {/*    {planError && (*/}
                    {/*      <span className="text-[11px] text-[var(--color-critical)]">{planError}</span>*/}
                    {/*    )}*/}
                    {/*  </div>*/}
                    {/*</div>*/}
                    <div className="overflow-x-auto">
                      <PlanBox xml={planXml} sqlFallback={planSql} onError={setPlanError} />
                    </div>
                  </div>
                )}

                {finding.ai_analyzed && ai && (
                  <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
                    <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)] select-none">
                      AI Analysis
                    </summary>
                    <div className="space-y-3 px-3 pb-3">
                      {ai.root_cause_summary && (
                        <p className="text-[13px] leading-relaxed text-[var(--color-text)]">{ai.root_cause_summary}</p>
                      )}
                      {(ai.top_actions?.length ?? 0) > 0 && (
                        <ol className="list-decimal list-inside space-y-1.5">
                          {ai.top_actions.map((a, i) => (
                            <li key={i} className="text-[13px] text-[var(--color-text)]">{a}</li>
                          ))}
                        </ol>
                      )}
                      {ai.analysis_text && (
                        <pre className="max-h-64 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--color-code-bg)] p-3 font-code text-[11px] text-[var(--color-code-text)]">
                          {ai.analysis_text}
                        </pre>
                      )}
                      <p className="font-code text-[11px] text-[var(--color-muted)]">
                        {ai.model} · ${ai.cost_usd.toFixed(4)}
                      </p>
                    </div>
                  </details>
                )}

                {finding.has_diagnostics && (
                  <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
                    <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)] select-none">
                      Diagnostics
                    </summary>
                    <div className="px-3 pb-3">
                      <DiagnosticsPanel findingId={finding.finding_id} />
                    </div>
                  </details>
                )}
              </>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {planAnalysis && (
        <PlanAnalysisOverlay result={planAnalysis} onClose={() => setPlanAnalysis(null)} />
      )}
    </>
  );
}
