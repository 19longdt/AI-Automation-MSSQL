import { useQuery } from "@tanstack/react-query";
import { useDashboardStore } from "@/store/dashboard.store";
import { useTimeRange } from "@/hooks/useTimeRange";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { buildFindingsQuery } from "@/lib/dashboard-query";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { Skeleton } from "@/components/ui/skeleton";
import type { FindingsQuery, FindingsResponse } from "@/types";

const CARDS = [
  { key: "CRITICAL", label: "Critical", color: "var(--color-critical)" },
  { key: "WARNING",  label: "Warning",  color: "var(--color-warning)"  },
  { key: "INFO",     label: "Info",     color: "var(--color-info)"     },
  { key: "TOTAL",    label: "Total",    color: "var(--color-primary)"  },
] as const;

export function KpiCards() {
  const { activeTopicId, selectedClusterId } = useDashboardStore();
  const { from, to } = useTimeRange();

  const params: FindingsQuery = buildFindingsQuery({ activeTopicId, selectedClusterId, filters: {}, from, to }, 0, 1);

  const { data: all,   isLoading: l0, isFetching: f0 } = useQuery({ queryKey: qk.findings({ ...params }), queryFn: () => apiGet<FindingsResponse>("/api/findings", params), staleTime: 30_000, placeholderData: (prev) => prev });
  const { data: crit,  isLoading: l1, isFetching: f1 } = useQuery({ queryKey: qk.findings({ ...params, severity: "CRITICAL" }), queryFn: () => apiGet<FindingsResponse>("/api/findings", { ...params, severity: "CRITICAL" }), staleTime: 30_000, placeholderData: (prev) => prev });
  const { data: warn,  isLoading: l2, isFetching: f2 } = useQuery({ queryKey: qk.findings({ ...params, severity: "WARNING"  }), queryFn: () => apiGet<FindingsResponse>("/api/findings", { ...params, severity: "WARNING"  }), staleTime: 30_000, placeholderData: (prev) => prev });
  const { data: info,  isLoading: l3, isFetching: f3 } = useQuery({ queryKey: qk.findings({ ...params, severity: "INFO"     }), queryFn: () => apiGet<FindingsResponse>("/api/findings", { ...params, severity: "INFO"     }), staleTime: 30_000, placeholderData: (prev) => prev });

  const counts: Record<string, number> = {
    CRITICAL: crit?.total ?? 0,
    WARNING:  warn?.total ?? 0,
    INFO:     info?.total ?? 0,
    TOTAL:    all?.total  ?? 0,
  };
  const loading = l0 || l1 || l2 || l3;
  const refreshing = (f0 || f1 || f2 || f3) && !loading;
  const maxCount = Math.max(1, ...Object.values(counts));

  return (
    <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-2">
      {CARDS.map(({ key, label, color }) => (
        <div
          key={key}
          className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 flex flex-col gap-1.5 transition-all duration-200 hover:border-[var(--color-border-2)]"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-[0.08em]">
              {label}
            </p>

            {loading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <p className="text-[22px] font-bold tabular leading-none" style={{ color }}>
                {counts[key].toLocaleString()}
              </p>
            )}
          </div>

          {/* Accent bar */}
          <div className="h-1 rounded-full bg-[var(--color-border)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: loading ? "0%" : `${Math.round((counts[key] / maxCount) * 100)}%`,
                background: color,
              }}
            />
          </div>
        </div>
      ))}
      <RefreshingOverlay visible={refreshing} />
    </div>
  );
}
