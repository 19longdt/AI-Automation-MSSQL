import { cn } from "@/lib/utils";

export function RefreshingOverlay({
  visible,
  className,
  tone = "default",
}: {
  visible: boolean;
  className?: string;
  tone?: "default" | "modal";
}) {
  if (!visible) return null;

  return (
    <>
      <div
        className={cn(
          tone === "modal"
            ? "pointer-events-none absolute inset-0 z-20 rounded-[inherit] bg-[color:color-mix(in_srgb,var(--color-surface)_38%,transparent)] backdrop-blur-[1px]"
            : "pointer-events-none absolute inset-0 z-20 rounded-[inherit] bg-[color:color-mix(in_srgb,var(--color-surface)_55%,transparent)] backdrop-blur-[2px]",
          className,
        )}
      />
      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-3">
        <div
          className={cn(
            "inline-flex items-center justify-center rounded-full border border-[var(--color-border)] shadow-sm",
            tone === "modal"
              ? "bg-[color:color-mix(in_srgb,var(--color-surface-2)_90%,transparent)] p-1.5 backdrop-blur-[2px]"
              : "bg-[color:color-mix(in_srgb,var(--color-surface-2)_94%,transparent)] p-2 backdrop-blur-sm",
          )}
        >
          <span className={cn(
            "inline-block rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin",
            tone === "modal" ? "h-3.5 w-3.5" : "h-4 w-4",
          )} />
        </div>
      </div>
    </>
  );
}

export function InlineRefreshingIndicator({
  visible,
  label = "Đang làm mới",
}: {
  visible: boolean;
  label?: string;
}) {
  if (!visible) return null;

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-2)] shadow-sm">
      <span className="inline-block h-3 w-3 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin" />
      <span>{label}</span>
    </div>
  );
}
