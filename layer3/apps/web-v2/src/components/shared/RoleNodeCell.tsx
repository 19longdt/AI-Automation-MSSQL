import { cn } from "@/lib/utils";

interface Props { role: string; node: string; className?: string; }

export function RoleNodeCell({ role, node, className }: Props) {
  const lower = role?.toLowerCase() ?? "";
  return (
    <span className={cn("tabular text-[12px]", className)}>
      <span className={cn(
        "font-semibold",
        lower === "primary"   && "text-[var(--color-role-primary)]",
        lower === "secondary" && "text-[var(--color-role-secondary)]",
        lower !== "primary" && lower !== "secondary" && "text-[var(--color-muted)]",
      )}>
        {role || "—"}
      </span>
      <span className="text-[var(--color-subtle)] mx-1">|</span>
      <span className="text-[var(--color-text-2)]">{node || "—"}</span>
    </span>
  );
}
