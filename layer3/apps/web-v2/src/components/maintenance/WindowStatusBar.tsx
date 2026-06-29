import React, { useState } from "react";
import { Power, PowerOff, Settings, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaintGlossaryTip } from "@/components/maintenance/MaintGlossaryTip";
import { WindowConfigDialog } from "@/components/maintenance/WindowConfigDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToggleKillSwitch, useToggleWindowEnabled } from "@/hooks/useMaintenance";
import { formatBytes } from "@/lib/format";
import type { MaintenanceWindowState } from "@/types";

function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${Math.round(value)} min`;
}

interface Props {
  clusterId?: string | null;
  data?: MaintenanceWindowState | null;
  isLoading?: boolean;
}

export function WindowStatusBar({ clusterId, data, isLoading = false }: Props) {
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const killSwitchMutation = useToggleKillSwitch();
  const enabledMutation = useToggleWindowEnabled();

  if (isLoading) {
    return (
      <div className="sticky top-0 z-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-sm">
        <div className="space-y-2">
          <Skeleton className="h-5 w-72 rounded-full" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="sticky top-0 z-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-critical-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-critical)]">
              <span className="h-2 w-2 rounded-full bg-[var(--color-critical)]" aria-hidden="true" />
              Closed
            </span>
            <span className="text-sm text-[var(--color-muted)]">Cluster nay chua duoc cau hinh maintenance window.</span>
          </div>
          <Button type="button" variant="primary" size="default" onClick={() => setConfigOpen(true)} disabled={!clusterId}>
            <Settings className="h-4 w-4" />
            Configure window
          </Button>
        </div>
        <WindowConfigDialog open={configOpen} onOpenChange={setConfigOpen} clusterId={clusterId ?? undefined} />
      </div>
    );
  }

  const progress =
    data.slot.time_budget_minutes > 0
      ? Math.min(100, (data.budget_used_minutes / data.slot.time_budget_minutes) * 100)
      : 0;
  const openTone = data.open ? "var(--color-success)" : "var(--color-critical)";

  return (
    <div className="sticky top-0 z-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-sm">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {data.enabled ? (
              <Button
                type="button"
                variant="outline"
                size="default"
                disabled={!clusterId || enabledMutation.isPending}
                onClick={() => clusterId && enabledMutation.mutate({ clusterId, value: false })}
              >
                <Power className="h-4 w-4" />
                <MaintGlossaryTip glossaryKey="window_enabled">Enabled</MaintGlossaryTip>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="default"
                disabled={!clusterId || enabledMutation.isPending}
                onClick={() => clusterId && enabledMutation.mutate({ clusterId, value: true })}
                className="border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)] hover:bg-[color:color-mix(in_srgb,var(--color-warning-soft)_80%,transparent)]"
              >
                <PowerOff className="h-4 w-4" />
                <MaintGlossaryTip glossaryKey="window_enabled">Disabled</MaintGlossaryTip>
              </Button>
            )}

            {confirmKill ? (
              <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-critical)] bg-[var(--color-critical-soft)] px-2.5 py-1.5 text-[12px] text-[var(--color-critical)]">
                <span className="font-medium">Xac nhan bat kill switch?</span>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 font-semibold hover:bg-[color:color-mix(in_srgb,var(--color-critical)_20%,transparent)]"
                  onClick={() => {
                    setConfirmKill(false);
                    if (clusterId) killSwitchMutation.mutate({ clusterId, value: true });
                  }}
                >
                  Bat
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 font-semibold hover:bg-[color:color-mix(in_srgb,var(--color-critical)_20%,transparent)]"
                  onClick={() => setConfirmKill(false)}
                >
                  Huy
                </button>
              </div>
            ) : data.kill_switch ? (
              <Button
                type="button"
                variant="outline"
                size="default"
                disabled={!clusterId || killSwitchMutation.isPending}
                onClick={() => clusterId && killSwitchMutation.mutate({ clusterId, value: false })}
                className="border-[var(--color-critical)] bg-[var(--color-critical-soft)] text-[var(--color-critical)] hover:bg-[color:color-mix(in_srgb,var(--color-critical-soft)_80%,transparent)]"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-critical)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-critical)]" />
                </span>
                <MaintGlossaryTip glossaryKey="kill_switch">Kill Switch ON</MaintGlossaryTip>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="default"
                disabled={!clusterId || killSwitchMutation.isPending}
                onClick={() => setConfirmKill(true)}
              >
                <ShieldOff className="h-4 w-4" />
                <MaintGlossaryTip glossaryKey="kill_switch">Kill Switch</MaintGlossaryTip>
              </Button>
            )}

            <Button type="button" variant="outline" size="default" onClick={() => setConfigOpen(true)} disabled={!clusterId}>
              <Settings className="h-4 w-4" />
              Configure
            </Button>
          </div>
        </div>

        <div className="grid gap-2 border-t border-[var(--color-border)] pt-2 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.8fr)_repeat(4,minmax(0,1fr))]">
          <BudgetRailCard
            usedMinutes={data.budget_used_minutes}
            totalMinutes={data.slot.time_budget_minutes}
            remainingMinutes={data.remaining_minutes}
            progress={progress}
          />
          <GateChip label={<MaintGlossaryTip glossaryKey="gate_cpu">CPU cap</MaintGlossaryTip>} value={`${data.gates.cpu_max_pct ?? "-"}%`} />
          <GateChip label={<MaintGlossaryTip glossaryKey="gate_requests">Requests cap</MaintGlossaryTip>} value={String(data.gates.active_requests_max ?? "-")} />
          <GateChip
            label={<MaintGlossaryTip glossaryKey="gate_ag_send">AG send cap</MaintGlossaryTip>}
            value={formatBytes(data.gates.log_send_queue_max_kb != null ? data.gates.log_send_queue_max_kb * 1024 : null)}
          />
          <GateChip
            label={<MaintGlossaryTip glossaryKey="gate_ag_redo">AG redo cap</MaintGlossaryTip>}
            value={formatBytes(data.gates.redo_queue_max_kb != null ? data.gates.redo_queue_max_kb * 1024 : null)}
          />
        </div>
      </div>

      <WindowConfigDialog open={configOpen} onOpenChange={setConfigOpen} clusterId={clusterId ?? undefined} />
    </div>
  );
}

function BudgetRailCard({
  usedMinutes,
  totalMinutes,
  remainingMinutes,
  progress,
}: {
  usedMinutes: number;
  totalMinutes: number;
  remainingMinutes: number;
  progress: number;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
            <MaintGlossaryTip glossaryKey="time_budget">Budget usage</MaintGlossaryTip>
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-[var(--color-text)]">
            {formatMinutes(usedMinutes)} / {formatMinutes(totalMinutes)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[13px] font-semibold tabular text-[var(--color-text)]">{Math.round(progress)}%</div>
          <div className="text-[11px] text-[var(--color-muted)]">~{formatMinutes(remainingMinutes)} remaining</div>
        </div>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-primary)_0%,color-mix(in_srgb,var(--color-success)_70%,var(--color-primary)_30%)_100%)] transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function GateChip({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium text-[var(--color-text-2)]">{value}</div>
    </div>
  );
}
