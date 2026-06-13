import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog";
import { formatMs } from "@/lib/format";
import type { FindingWithAnalysis } from "@/types";

interface Props {
  finding: FindingWithAnalysis;
  onClose: () => void;
}

const TD_KEY = "py-1.5 pr-4 text-[var(--color-muted)] text-[12px] w-40 shrink-0";
const TD_VAL = "py-1.5 text-[13px] font-code text-[var(--color-text)]";

export function AiAnalysisModal({ finding, onClose }: Props) {
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const a = finding.ai_analysis;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(90vw,760px)]">
        <DialogHeader>
          <DialogTitle>AI Analysis — {finding.issue_type}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {!finding.ai_analyzed || !a ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <p className="text-[14px] text-[var(--color-muted)]">No AI analysis yet.</p>
              <p className="text-[13px] text-[var(--color-subtle)]">
                Run{" "}
                <code className="font-code px-1.5 py-0.5 rounded bg-[var(--color-code-bg)] text-[var(--color-code-text)]">
                  /analyze
                </code>{" "}
                in Telegram to trigger analysis.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Root Cause */}
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
                  Root Cause Summary
                </p>
                <p className="text-[13px] text-[var(--color-text)] leading-relaxed">
                  {a.root_cause_summary}
                </p>
              </div>

              {/* Top Actions */}
              {a.top_actions.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
                    Top Actions
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5">
                    {a.top_actions.map((action, i) => (
                      <li key={i} className="text-[13px] text-[var(--color-text)]">
                        {action}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Analysis Text — collapsible */}
              <div>
                <button
                  type="button"
                  onClick={() => setAnalysisExpanded((v) => !v)}
                  className="flex items-center gap-2 cursor-pointer hover:text-[var(--color-text)] transition-colors mb-2"
                >
                  <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">
                    Analysis Text
                  </p>
                  <span className="text-[10px] text-[var(--color-subtle)] normal-case font-normal">
                    {analysisExpanded ? "▲ collapse" : "▼ expand"}
                  </span>
                </button>
                {analysisExpanded && (
                  <pre className="p-3 rounded-lg bg-[var(--color-code-bg)] text-[var(--color-code-text)] text-[11px] font-code overflow-x-auto whitespace-pre-wrap max-h-64">
                    {a.analysis_text}
                  </pre>
                )}
              </div>

              {/* Metadata kv-table */}
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
                  Metadata
                </p>
                <table className="w-full border-collapse">
                  <tbody>
                    <tr>
                      <td className={TD_KEY}>Model</td>
                      <td className={TD_VAL}>{a.model}</td>
                    </tr>
                    <tr>
                      <td className={TD_KEY}>Cost (USD)</td>
                      <td className={TD_VAL}>${a.cost_usd.toFixed(6)}</td>
                    </tr>
                    <tr>
                      <td className={TD_KEY}>Duration</td>
                      <td className={TD_VAL}>
                        {a.total_duration_ms != null ? formatMs(a.total_duration_ms) : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
