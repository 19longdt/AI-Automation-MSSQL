import { useDiagnostics } from "@/hooks/useDiagnostics";
import { Skeleton } from "@/components/ui/skeleton";

const PHASE_GROUPS = [
  { label: "Phase 1 – DMV Snapshot",     tools: ["get_blocking_chain","get_blocked_victims_snapshot","get_wait_stats","get_memory_grant","get_tempdb_usage","get_ag_status","get_memory_pressure","get_resource_governor_stats","get_cdc_status","get_missing_indexes","get_query_stats","get_query_store_history"] },
  { label: "Phase 2 – Static Analysis",  tools: ["get_plan_analysis","get_query_structure"] },
  { label: "Phase 3 – Table Details",    tools: ["get_index_usage","get_statistics_info"] },
  { label: "Phase 4 – Historical Context",tools: ["get_table_context","get_recent_findings","get_analysis_history"] },
];

const STATUS_CLS: Record<string, string> = {
  ok:      "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success-soft)]",
  empty:   "bg-[var(--color-surface-3)] text-[var(--color-muted)] border-[var(--color-border)]",
  skipped: "bg-[var(--color-surface-3)] text-[var(--color-subtle)] border-[var(--color-border)]",
  timeout: "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[var(--color-warning-soft)]",
  error:   "bg-[var(--color-critical-soft)] text-[var(--color-critical)] border-[var(--color-critical-soft)]",
};

interface Props { findingId: string; }

export function DiagnosticsPanel({ findingId }: Props) {
  const { data: diag, isLoading, error } = useDiagnostics(findingId);

  if (isLoading) return <div className="space-y-3 p-1">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  if (error)     return <p className="text-[13px] text-[var(--color-muted)] py-4">Diagnostics not available.</p>;
  if (!diag)     return <p className="text-[13px] text-[var(--color-muted)] py-4">No diagnostics data.</p>;

  const results: Record<string, { status: string; row_count?: number; duration_ms?: number }> = (diag as { results?: Record<string, { status: string; row_count?: number; duration_ms?: number }> }).results ?? {};
  const requested: string[] = (diag as { tools_requested?: string[] }).tools_requested ?? [];

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-[var(--color-muted)] font-code">
        Captured in {(diag as { capture_duration_ms?: number }).capture_duration_ms ? ((diag as { capture_duration_ms: number }).capture_duration_ms / 1000).toFixed(1) : "?"}s
      </div>

      {PHASE_GROUPS.map((g) => {
        const inPhase = requested.filter((t) => g.tools.includes(t));
        if (!inPhase.length) return null;
        return (
          <div key={g.label}>
            <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">{g.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {inPhase.map((tid) => {
                const r = results[tid];
                if (!r) return null;
                const cls = STATUS_CLS[r.status] ?? STATUS_CLS.error;
                return (
                  <span key={tid} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${cls}`}>
                    {tid.replace(/^get_/, "").replace(/_/g, " ")}
                    {r.status === "ok" && r.row_count ? <span className="opacity-70">({r.row_count})</span> : null}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
