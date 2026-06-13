import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useDashboardStore } from "@/store/dashboard.store";
import { cn } from "@/lib/utils";

function useRunRefresh() {
  const queryClient = useQueryClient();
  const { timeRange, refreshNow } = useDashboardStore();

  return useCallback(() => {
    if (timeRange.mode !== "absolute") {
      refreshNow();
      return;
    }
    void queryClient.invalidateQueries({ type: "active" });
  }, [queryClient, refreshNow, timeRange.mode]);
}

export function ManualRefreshButton() {
  const { autoRefresh } = useDashboardStore();
  const runRefresh = useRunRefresh();

  if (autoRefresh.enabled) return null;

  return (
    <button
      onClick={runRefresh}
      aria-label="Refresh now"
      title="Refresh now"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border-2)] bg-[var(--color-surface-2)] text-[var(--color-muted)] transition-all cursor-pointer hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
    >
      <RefreshCw className="h-3.5 w-3.5" />
    </button>
  );
}

export function LiveIndicator() {
  const { autoRefresh, setAutoRefresh } = useDashboardStore();
  const runRefresh = useRunRefresh();

  useEffect(() => {
    if (!autoRefresh.enabled) return;

    runRefresh();
    const timer = window.setInterval(runRefresh, autoRefresh.intervalMs);
    return () => window.clearInterval(timer);
  }, [autoRefresh.enabled, autoRefresh.intervalMs, runRefresh]);

  const toggle = () => setAutoRefresh({ ...autoRefresh, enabled: !autoRefresh.enabled });

  return (
    <button
      onClick={toggle}
      aria-label={autoRefresh.enabled ? "Auto-refresh on - click to disable" : "Auto-refresh off - click to enable"}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-medium transition-all cursor-pointer",
        autoRefresh.enabled
          ? "border-[var(--color-success)] text-[var(--color-success)] bg-[var(--color-success-soft)]"
          : "border-[var(--color-border-2)] text-[var(--color-muted)] bg-[var(--color-surface-2)] hover:border-[var(--color-success)] hover:text-[var(--color-success)]",
      )}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-75",
            autoRefresh.enabled ? "bg-[var(--color-success)] animate-ping" : "bg-[var(--color-subtle)]",
          )}
        />
        <span className={cn("relative inline-flex rounded-full h-2 w-2", autoRefresh.enabled ? "bg-[var(--color-success)]" : "bg-[var(--color-subtle)]")} />
      </span>
      {autoRefresh.enabled ? "Live" : "Paused"}
    </button>
  );
}
