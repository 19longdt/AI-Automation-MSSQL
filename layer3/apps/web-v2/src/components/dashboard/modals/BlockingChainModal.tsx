import { useState } from "react";
import { AlertCircle, BrainCircuit, Clock, Link2, Lock, Users } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useFindingById } from "@/hooks/useFindings";
import { cn } from "@/lib/utils";
import type { FindingWithAnalysis } from "@/types";

interface BlockedSession {
  session_id: number | string;
  blocking_session_id?: number | string | null;
  login_name?: string | null;
  database_name?: string | null;
  wait_sec?: number | null;
  wait_type?: string | null;
  query_text?: string | null;
}

interface HeldLock {
  resource_type?: string | null;
  request_mode?: string | null;
  object_name?: string | null;
  lock_count?: number | null;
}

const LOCK_CLS: Record<string, string> = {
  X: "bg-[var(--color-critical-soft)] text-[var(--color-critical)] border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)]",
  IX: "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)]",
  SIX: "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)]",
  U: "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)]",
  S: "bg-[var(--color-info-soft)] text-[var(--color-info)] border-[color:color-mix(in_srgb,var(--color-info)_25%,transparent)]",
  IS: "bg-[var(--color-surface-3)] text-[var(--color-muted)] border-[var(--color-border)]",
};

function lockModeCls(mode: string | null | undefined): string {
  return LOCK_CLS[mode?.toUpperCase() ?? ""] ?? "bg-[var(--color-surface-3)] text-[var(--color-text-2)] border-[var(--color-border)]";
}

function waitBadgeCls(sec: number | null | undefined): string {
  if (sec == null) return "bg-[var(--color-surface-3)] text-[var(--color-muted)]";
  if (sec >= 60) return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
  if (sec >= 10) return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
  return "bg-[var(--color-surface-3)] text-[var(--color-text-2)]";
}

function BlockingNode({ session, allVictims }: { session: BlockedSession; allVictims: BlockedSession[] }): React.ReactElement {
  const children = allVictims.filter((victim) => String(victim.blocking_session_id) === String(session.session_id));
  return (
    <li className="mt-2 select-none">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-[var(--color-surface-3)] px-2 py-0.5 font-code text-[13px] font-semibold text-[var(--color-text)]">#{session.session_id}</span>
        {session.login_name && <span className="text-[13px] text-[var(--color-text)]">{session.login_name}</span>}
        {session.database_name && <span className="font-code text-[11px] text-[var(--color-muted)]">{session.database_name}</span>}
        {session.wait_sec != null && (
          <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold", waitBadgeCls(session.wait_sec))}>
            <Clock className="h-3 w-3" aria-hidden="true" />{session.wait_sec}s
          </span>
        )}
        {session.wait_type && (
          <span className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 font-code text-[11px] text-[var(--color-muted)]">
            <GlossaryTip glossaryKey={session.wait_type.toLowerCase()}>{session.wait_type}</GlossaryTip>
          </span>
        )}
      </div>
      {session.query_text && (
        <pre className="mt-1.5 max-h-24 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-md bg-[var(--color-code-bg)] p-2 font-code text-[11px] text-[var(--color-code-text)]">
          {session.query_text}
        </pre>
      )}
      {children.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-l-2 border-[var(--color-border-2)] pl-4">
          {children.map((child) => (
            <BlockingNode key={String(child.session_id)} session={child} allVictims={allVictims} />
          ))}
        </ul>
      )}
    </li>
  );
}

function KpiStrip({ headId, blockedCount, depth, maxWaitSec }: { headId: string; blockedCount: number | null; depth: number | null; maxWaitSec: number | null }): React.ReactElement {
  const waitCls = maxWaitSec == null ? "" : maxWaitSec >= 60 ? "text-[var(--color-critical)]" : maxWaitSec >= 10 ? "text-[var(--color-warning)]" : "";
  return (
    <div className="grid grid-cols-4 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {[
        { icon: <AlertCircle className="h-3.5 w-3.5" />, label: "Head Blocker", glossaryKey: "head_blocker", value: `#${headId}`, cls: "text-[var(--color-critical)] font-code font-bold" },
        { icon: <Users className="h-3.5 w-3.5" />, label: "Blocked", glossaryKey: "blocked_session_count", value: blockedCount != null ? `${blockedCount}` : "-", cls: "text-[var(--color-text)] font-bold" },
        { icon: <Link2 className="h-3.5 w-3.5" />, label: "Depth", glossaryKey: "chain_depth", value: depth != null ? `${depth}` : "-", cls: "text-[var(--color-text)] font-bold" },
        { icon: <Clock className="h-3.5 w-3.5" />, label: "Max Wait", glossaryKey: "max_wait_sec", value: maxWaitSec != null ? `${maxWaitSec}s` : "-", cls: cn("font-code font-bold", waitCls || "text-[var(--color-text)]") },
      ].map((kpi) => (
        <div key={kpi.label} className="flex flex-col gap-0.5 px-4 py-3">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            <span aria-hidden="true" className="text-[var(--color-muted)]">{kpi.icon}</span>
            <GlossaryTip glossaryKey={kpi.glossaryKey}>{kpi.label}</GlossaryTip>
          </span>
          <span className={cn("text-[18px] tabular leading-tight", kpi.cls)}>{kpi.value}</span>
        </div>
      ))}
    </div>
  );
}

export function BlockingChainModal({ finding, onClose }: { finding: FindingWithAnalysis; onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState("chain");
  const { data: full, isLoading } = useFindingById(finding.finding_id);

  const active = full ?? finding;
  const m = (active.metrics ?? {}) as Record<string, unknown>;
  const ai = active.ai_analysis;

  const headId = m.head_blocker_session_id != null ? String(m.head_blocker_session_id) : "-";
  const headLogin = m.head_blocker_login ? String(m.head_blocker_login) : null;
  const headProgram = m.head_blocker_program_name ? String(m.head_blocker_program_name) : null;
  const headQuery = m.head_blocker_query ? String(m.head_blocker_query) : null;
  const isIdle = !!m.head_blocker_is_idle;
  const openTxn = Number(m.head_blocker_open_txn_count) || 0;

  const victims = Array.isArray(m.blocked_sessions) ? (m.blocked_sessions as BlockedSession[]) : [];
  const locks = Array.isArray(m.held_locks) ? (m.held_locks as HeldLock[]) : [];
  const rootVictims = victims.filter((victim) => String(victim.blocking_session_id) === String(m.head_blocker_session_id));
  const orphans = victims.filter((victim) =>
    String(victim.blocking_session_id) !== String(m.head_blocker_session_id) &&
    !victims.some((node) => String(node.session_id) === String(victim.blocking_session_id)),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(98vw,1400px)] overflow-hidden p-0">
        <DialogHeader className="px-5 py-3">
          <div className="flex items-center gap-2 flex-wrap pr-8">
            <DialogTitle>
              Blocking Chain - <span className="font-code text-[var(--color-critical)]">#{headId}</span>
            </DialogTitle>
          </div>
        </DialogHeader>

        <KpiStrip
          headId={headId}
          blockedCount={m.blocked_session_count != null ? Number(m.blocked_session_count) : null}
          depth={m.chain_depth != null ? Number(m.chain_depth) : null}
          maxWaitSec={m.max_wait_sec != null ? Number(m.max_wait_sec) : null}
        />

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="shrink-0 px-5">
            <TabsTrigger value="chain">Chain</TabsTrigger>
            <TabsTrigger value="locks">
              Locks
              {locks.length > 0 && <span className="ml-1.5 rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]">{locks.length}</span>}
            </TabsTrigger>
            {active.ai_analyzed && (
              <TabsTrigger value="ai">
                <BrainCircuit className="mr-1 h-3.5 w-3.5" aria-hidden="true" />AI
              </TabsTrigger>
            )}
            {active.has_diagnostics && <TabsTrigger value="diag">Diagnostics</TabsTrigger>}
          </TabsList>

          <DialogBody className="pt-4">
            <TabsContent value="chain" className="mt-0">
              {isLoading ? (
                <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Head Blocker</p>
                    <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--color-critical)_20%,transparent)] bg-[var(--color-critical-soft)] p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-code text-[17px] font-bold tabular text-[var(--color-critical)]">#{headId}</span>
                        {headLogin && <span className="text-[14px] font-medium text-[var(--color-text)]">{headLogin}</span>}
                        {headProgram && (
                          <>
                            <span className="select-none text-[var(--color-subtle)]">·</span>
                            <span className="text-[12px] text-[var(--color-muted)]">{headProgram}</span>
                          </>
                        )}
                        {isIdle && openTxn > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[var(--color-warning-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-warning)]">
                            <AlertCircle className="h-3 w-3" aria-hidden="true" />
                            <GlossaryTip glossaryKey="idle_txn">IDLE TXN</GlossaryTip> · {openTxn}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--color-success)_30%,transparent)] bg-[var(--color-success-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-success)]">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      {headQuery && (
                        <pre className="mt-2.5 max-h-36 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--color-code-bg)] p-2.5 font-code text-[11px] text-[var(--color-code-text)]">
                          {headQuery}
                        </pre>
                      )}
                    </div>
                  </div>

                  {victims.length > 0 ? (
                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                        Blocked Sessions ({victims.length})
                      </p>
                      <ul className="space-y-0.5 border-l-2 border-[color:color-mix(in_srgb,var(--color-critical)_30%,transparent)] pl-4">
                        {rootVictims.map((victim) => (
                          <BlockingNode key={String(victim.session_id)} session={victim} allVictims={victims} />
                        ))}
                        {orphans.map((victim) => (
                          <BlockingNode key={String(victim.session_id)} session={victim} allVictims={victims} />
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-[13px] text-[var(--color-muted)]">No blocked session details captured.</p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="locks" className="mt-0">
              {locks.length === 0 ? (
                <p className="py-2 text-[13px] text-[var(--color-muted)]">No held locks captured.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                        <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Resource</th>
                        <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]"><GlossaryTip glossaryKey="lock_mode">Mode</GlossaryTip></th>
                        <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Object</th>
                        <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locks.map((lock, index) => (
                        <tr key={index} className="border-b border-[var(--color-border)] transition-colors duration-[120ms] last:border-0 hover:bg-[var(--color-row-hover)]">
                          <td className="px-3 py-2.5 font-code text-[12px] text-[var(--color-text-2)]">{lock.resource_type ?? "-"}</td>
                          <td className="px-3 py-2.5">
                            <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold border", lockModeCls(lock.request_mode))}>
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              {lock.request_mode ?? "-"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-code text-[12px] text-[var(--color-text)]">{lock.object_name ?? "-"}</td>
                          <td className="px-3 py-2.5 tabular text-[var(--color-text-2)]">{lock.lock_count ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {active.ai_analyzed && (
              <TabsContent value="ai" className="mt-0">
                {!ai ? (
                  <p className="text-[13px] text-[var(--color-muted)]">No AI analysis data.</p>
                ) : (
                  <div className="space-y-4">
                    {ai.root_cause_summary && (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Root Cause</p>
                        <p className="text-[13px] leading-relaxed text-[var(--color-text)]">{ai.root_cause_summary}</p>
                      </div>
                    )}
                    {ai.top_actions && ai.top_actions.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Recommended Actions</p>
                        <ul className="space-y-1.5">
                          {ai.top_actions.map((action, index) => (
                            <li key={index} className="flex items-start gap-2 text-[13px] text-[var(--color-text)]">
                              <span className="mt-0.5 shrink-0 font-bold text-[var(--color-primary)]">{"->"}</span>
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="border-t border-[var(--color-border)] pt-1 font-code text-[11px] text-[var(--color-muted)]">
                      Model: {ai.model} · Cost: ${ai.cost_usd?.toFixed(4)} · {ai.completed_at?.slice(0, 19)}
                    </div>
                  </div>
                )}
              </TabsContent>
            )}

            {active.has_diagnostics && (
              <TabsContent value="diag" className="mt-0">
                <DiagnosticsPanel findingId={active.finding_id} />
              </TabsContent>
            )}
          </DialogBody>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
