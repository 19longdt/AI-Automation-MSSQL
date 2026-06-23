import { ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format";
import type { MaintenanceWindowState } from "@/types";

function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${Math.round(value)} min`;
}

interface Props {
  data?: MaintenanceWindowState;
  isLoading?: boolean;
}

export function WindowStatusBar({ data, isLoading = false }: Props) {
  if (isLoading) {
    return (
      <div className="sticky top-0 z-20 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-sm">
        <div className="space-y-2">
          <Skeleton className="h-5 w-72 rounded-full" />
          <Skeleton className="h-10 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="sticky top-0 z-20 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-critical-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-critical)]">
            <span className="h-2 w-2 rounded-full bg-[var(--color-critical)]" aria-hidden="true" />
            Closed
          </span>
          <span className="text-sm text-[var(--color-muted)]">No maintenance window configuration was found for this cluster.</span>
        </div>
      </div>
    );
  }

  const progress =
    data.slot.time_budget_minutes > 0
      ? Math.min(100, (data.budget_used_minutes / data.slot.time_budget_minutes) * 100)
      : 0;
  const openTone = data.open ? "var(--color-success)" : "var(--color-critical)";

  return (
    <div className="sticky top-0 z-20 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-sm">
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)] xl:items-center">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{
                color: openTone,
                background: data.open ? "var(--color-success-soft)" : "var(--color-critical-soft)",
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: openTone }} aria-hidden="true" />
              {data.open ? "Open" : "Closed"}
            </span>
            <span className="text-sm font-semibold text-[var(--color-text)]">
              {data.slot.start}-{data.slot.end}
            </span>
            <span className="text-[13px] text-[var(--color-muted)]">Status reason: {data.reason}</span>
          </div>

          <div className="grid gap-2 text-[11px] text-[var(--color-muted)] sm:grid-cols-2 xl:grid-cols-4">
            <GateChip label="CPU cap" value={`${data.gates.cpu_max_pct ?? "-"}%`} />
            <GateChip label="Requests cap" value={String(data.gates.max_active_requests ?? "-")} />
            <GateChip
              label="AG send cap"
              value={formatBytes(data.gates.max_log_send_queue_kb != null ? data.gates.max_log_send_queue_kb * 1024 : null)}
            />
            <GateChip
              label="AG redo cap"
              value={formatBytes(data.gates.max_redo_queue_kb != null ? data.gates.max_redo_queue_kb * 1024 : null)}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Budget usage</div>
              <div className="mt-0.5 text-sm font-medium text-[var(--color-text)]">
                {formatMinutes(data.budget_used_minutes)} / {formatMinutes(data.slot.time_budget_minutes)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-base font-semibold text-[var(--color-text)] tabular">{Math.round(progress)}%</div>
              <div className="text-xs text-[var(--color-muted)]">~{formatMinutes(data.remaining_minutes)} remaining</div>
            </div>
          </div>

          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-primary)_0%,color-mix(in_srgb,var(--color-success)_70%,var(--color-primary)_30%)_100%)] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Kill switch: {data.kill_switch ? "ON" : "Off"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GateChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium text-[var(--color-text-2)]">{value}</div>
    </div>
  );
}
