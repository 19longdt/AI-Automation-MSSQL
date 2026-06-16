import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  title = "No data",
  description,
  icon,
  action,
  className,
}: Props) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-6 text-center gap-3", className)}>
      <div className="text-[var(--color-subtle)] opacity-60">
        {icon ?? <SearchX className="w-10 h-10" />}
      </div>
      <p className="text-[15px] font-semibold text-[var(--color-text)]">{title}</p>
      {description && (
        <p className="text-[13px] text-[var(--color-muted)] max-w-sm leading-relaxed">{description}</p>
      )}
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}
