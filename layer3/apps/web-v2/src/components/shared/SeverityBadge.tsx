import type { Severity } from "@layer3/core";
import { cn } from "@/lib/utils";

const CONFIG: Record<Severity, { label: string; dot: string; cls: string }> = {
  CRITICAL: {
    label: "Critical",
    dot: "bg-[var(--color-critical)]",
    cls: "bg-[var(--color-critical-soft)] text-[var(--color-critical)] border-[color:color-mix(in_srgb,var(--color-critical)_30%,transparent)]",
  },
  WARNING: {
    label: "Warning",
    dot: "bg-[var(--color-warning)]",
    cls: "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[color:color-mix(in_srgb,var(--color-warning)_30%,transparent)]",
  },
  INFO: {
    label: "Info",
    dot: "bg-[var(--color-info)]",
    cls: "bg-[var(--color-info-soft)] text-[var(--color-info)] border-[color:color-mix(in_srgb,var(--color-info)_30%,transparent)]",
  },
};

interface Props {
  severity: Severity;
  className?: string;
}

export function SeverityBadge({ severity, className }: Props) {
  const cfg = CONFIG[severity] ?? CONFIG.INFO;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
        "text-[11px] font-semibold tracking-wide border",
        cfg.cls,
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}
