import { useState } from "react";
import { useInsights } from "@/hooks/useInsights";
import { PageShell } from "@/components/layout/PageShell";
import { InsightCard } from "@/components/insights/InsightCard";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { InsightsQuery } from "@/types";
import { Lightbulb } from "lucide-react";

const ISSUE_TYPES = [
  "slow_sessions","blocking_chain","deadlock","ag_lag","cdc_failure",
  "missing_index","non_optimal_index","memory_pressure","wait_anomaly",
];

export function InsightsPage() {
  const [filters, setFilters] = useState<InsightsQuery>({ limit: 50 });
  const { data: insights, isLoading, error, refetch } = useInsights(filters);

  function updateFilter(patch: Partial<InsightsQuery>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  return (
    <PageShell className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-[var(--color-primary)]" aria-hidden="true" />
          <h1 className="text-[16px] font-semibold text-[var(--color-text)]">AI Insights</h1>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Select
            value={filters.severity || "_all"}
            onValueChange={(v) => updateFilter({ severity: v === "_all" ? undefined : v })}
          >
            <SelectTrigger className="w-[130px]" aria-label="Filter by severity">
              <SelectValue placeholder="All severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All severities</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
              <SelectItem value="WARNING">Warning</SelectItem>
              <SelectItem value="INFO">Info</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.issue_type || "_all"}
            onValueChange={(v) => updateFilter({ issue_type: v === "_all" ? undefined : v })}
          >
            <SelectTrigger className="w-[180px]" aria-label="Filter by issue type">
              <SelectValue placeholder="All issue types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All issue types</SelectItem>
              {ISSUE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          message="Failed to load insights"
          description={error instanceof Error ? error.message : "Unknown error"}
          onRetry={() => void refetch()}
        />
      ) : !insights?.length ? (
        <EmptyState
          title="No insights yet"
          description="AI insights are generated when findings are analyzed. Run /analyze in Telegram to trigger analysis."
          icon={<Lightbulb className="w-10 h-10" />}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {insights.map((insight) => (
            <InsightCard key={insight._id} insight={insight} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
