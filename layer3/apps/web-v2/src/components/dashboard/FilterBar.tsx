import { useDashboardStore } from "@/store/dashboard.store";
import { useReplicaOptions } from "@/hooks/useReplicaOptions";
import { FilterX } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TimeRangePicker } from "@/components/dashboard/TimeRangePicker";
import type { FindingFilters } from "@/types";

interface Props {
  showBlockingFilter?: boolean;
}

export function FilterBar({ showBlockingFilter = false }: Props) {
  const {
    activeTopicId,
    filters,
    setFilters,
    comparePastEnabled,
    setComparePastEnabled,
  } = useDashboardStore();
  const showReplicaFilter = activeTopicId === "ag_health" || activeTopicId === "ag_redo_secondary";
  const showComparePast =
    activeTopicId === "ag_health"
    || activeTopicId === "ag_redo_secondary"
    || activeTopicId === "tempdb_memory"
    || activeTopicId === "ple_trend";
  const { data: replicaOptions } = useReplicaOptions(activeTopicId, showReplicaFilter);
  const hasFilters = !!(filters.severity || filters.alertStatus || filters.blockingStatus || filters.replica);

  function update(patch: Partial<FindingFilters>) {
    setFilters({ ...filters, ...patch });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filters.severity || "_all"}
        onValueChange={(v) => update({ severity: v === "_all" ? undefined : v as FindingFilters["severity"] })}
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
        value={filters.alertStatus || "_all"}
        onValueChange={(v) => update({ alertStatus: v === "_all" ? undefined : v as FindingFilters["alertStatus"] })}
      >
        <SelectTrigger className="w-[140px]" aria-label="Filter by alert status">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All statuses</SelectItem>
          <SelectItem value="sent">Sent</SelectItem>
          <SelectItem value="suppressed">Suppressed</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>

      {showBlockingFilter && (
        <Select
          value={filters.blockingStatus || "_all"}
          onValueChange={(v) => update({ blockingStatus: v === "_all" ? undefined : v as FindingFilters["blockingStatus"] })}
        >
          <SelectTrigger className="w-[140px]" aria-label="Filter by blocking status">
            <SelectValue placeholder="All sessions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All sessions</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
            <SelectItem value="not_blocked">Not blocked</SelectItem>
          </SelectContent>
        </Select>
      )}

      {showReplicaFilter && (
        <Select
          value={filters.replica || "_all"}
          onValueChange={(v) => update({ replica: v === "_all" ? undefined : v })}
        >
          <SelectTrigger className="w-[180px]" aria-label="Filter by replica">
            <SelectValue placeholder="All replicas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All replicas</SelectItem>
            {replicaOptions.map((replica) => (
              <SelectItem key={replica} value={replica}>
                {replica}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {hasFilters && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-lg"
          aria-label="Xóa bộ lọc"
          title="Xóa bộ lọc"
          onClick={() => setFilters({})}
        >
          <FilterX className="h-3.5 w-3.5" />
        </Button>
      )}

      <div className="ml-auto flex items-center gap-3">
        {showComparePast && (
          <button
            type="button"
            role="switch"
            aria-checked={comparePastEnabled}
            onClick={() => setComparePastEnabled(!comparePastEnabled)}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <span
              className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
              style={{
                backgroundColor: comparePastEnabled
                  ? "var(--color-primary)"
                  : "var(--color-surface-3)",
              }}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                style={{
                  transform: comparePastEnabled ? "translateX(18px)" : "translateX(2px)",
                }}
              />
            </span>
            <span>So sánh cùng kỳ</span>
          </button>
        )}
        <TimeRangePicker />
      </div>
    </div>
  );
}
