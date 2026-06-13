import { cn } from "@/lib/utils";

interface Props { status: string; className?: string; }

export function AlertStatusBadge({ status, className }: Props) {
  const lower = String(status ?? "").toLowerCase();
  const cls =
    lower === "sent"       ? "bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success-soft)]" :
    lower === "suppressed" ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[var(--color-warning-soft)]" :
    "bg-[var(--color-surface-3)] text-[var(--color-muted)] border-[var(--color-border)]";

  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border", cls, className)}>
      {status || "—"}
    </span>
  );
}
