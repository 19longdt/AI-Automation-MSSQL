import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlanSectionProps {
  title: string;
  dotColor: "red" | "yellow" | "blue" | "green";
  count?: number;
  defaultOpen?: boolean;
  groupColor?: string;
  children: ReactNode;
}

const DOT_CLASS: Record<PlanSectionProps["dotColor"], string> = {
  red: "bg-[var(--color-critical)]",
  yellow: "bg-[var(--color-warning)]",
  blue: "bg-[var(--color-info)]",
  green: "bg-[var(--color-success)]",
};

export function PlanSection({
  title,
  dotColor,
  count,
  defaultOpen = false,
  groupColor,
  children,
}: PlanSectionProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        open && "shadow-[inset_3px_0_0_0_var(--section-accent)]",
      )}
      style={groupColor ? ({ ["--section-accent" as string]: groupColor } as CSSProperties) : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-row-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] focus-visible:outline-offset-[-2px]"
      >
        <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", DOT_CLASS[dotColor])} />
        <span className="text-[13px] font-semibold text-[var(--color-text)]">{title}</span>
        {count != null && count > 0 && (
          <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium tabular text-[var(--color-muted)]">
            {count}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 text-[var(--color-muted)] transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <div className={cn(
        "grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}>
        <div className="overflow-hidden">
          <div className="p-3">{children}</div>
        </div>
      </div>
    </section>
  );
}
