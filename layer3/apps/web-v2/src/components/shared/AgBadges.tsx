import { Activity, CheckCircle2, Wifi, WifiOff, PauseCircle, ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function SyncHealthBadge({ value }: { value: string }): React.ReactElement {
  if (value === "NOT_HEALTHY") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-critical-soft)] text-[var(--color-critical)] border border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)]">
      <Activity className="w-3 h-3 shrink-0" aria-hidden="true" />NOT_HEALTHY
    </span>
  );
  if (value === "PARTIALLY_HEALTHY") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)]">
      <Activity className="w-3 h-3 shrink-0" aria-hidden="true" />PARTIAL
    </span>
  );
  if (!value || value === "—") return <span className="text-[var(--color-muted)] text-[12px]">—</span>;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[color:color-mix(in_srgb,var(--color-success)_25%,transparent)]">
      <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />{value}
    </span>
  );
}

export function ConnectedBadge({ value }: { value: string }): React.ReactElement {
  const off = value === "DISCONNECTED";
  if (!value || value === "—") return <span className="text-[var(--color-muted)] text-[12px]">—</span>;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border",
      off
        ? "bg-[var(--color-critical-soft)] text-[var(--color-critical)] border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)]"
        : "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[color:color-mix(in_srgb,var(--color-success)_25%,transparent)]",
    )}>
      {off ? <WifiOff className="w-3 h-3 shrink-0" aria-hidden="true" /> : <Wifi className="w-3 h-3 shrink-0" aria-hidden="true" />}
      {value}
    </span>
  );
}

export function SuspendedBadge({ isSuspended, reason }: { isSuspended: boolean; reason?: string }): React.ReactElement {
  if (isSuspended) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-critical-soft)] text-[var(--color-critical)] border border-[color:color-mix(in_srgb,var(--color-critical)_25%,transparent)]">
      <PauseCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
      SUSPENDED{reason ? ` · ${reason}` : ""}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[color:color-mix(in_srgb,var(--color-success)_25%,transparent)]">
      <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />RUNNING
    </span>
  );
}

export function FailoverBadge({ value }: { value: unknown }): React.ReactElement {
  if (value == null) return <span className="text-[var(--color-muted)] text-[12px]">—</span>;
  const ready = Number(value) === 1;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border",
      ready
        ? "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[color:color-mix(in_srgb,var(--color-success)_25%,transparent)]"
        : "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)]",
    )}>
      {ready
        ? <ShieldCheck className="w-3 h-3 shrink-0" aria-hidden="true" />
        : <ShieldAlert className="w-3 h-3 shrink-0" aria-hidden="true" />}
      {ready ? "READY" : "NOT READY"}
    </span>
  );
}
