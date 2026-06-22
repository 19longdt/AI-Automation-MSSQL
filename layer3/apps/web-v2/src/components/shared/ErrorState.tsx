import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  message?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message = "Something went wrong", description, onRetry, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-6 text-center gap-3", className)}>
      <AlertTriangle className="w-10 h-10 text-[var(--color-critical)] opacity-70" />
      <p className="text-[15px] font-semibold text-[var(--color-text)]">{message}</p>
      {description && (
        <p className="text-[12px] font-code text-[var(--color-muted)] max-w-md bg-[var(--color-surface-2)] rounded-md px-3 py-2 text-left">{description}</p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          Retry
        </Button>
      )}
    </div>
  );
}
