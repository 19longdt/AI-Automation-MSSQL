import { useDashboardStore } from "@/store/dashboard.store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimeRangePicker } from "@/components/dashboard/TimeRangePicker";
import type { FindingFilters } from "@/types";

interface Props {
  showBlockingFilter?: boolean;
}

export function FilterBar({ showBlockingFilter = false }: Props) {
  const { filters, setFilters } = useDashboardStore();

  function update(patch: Partial<FindingFilters>) {
    setFilters({ ...filters, ...patch });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Severity */}
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

      {/* Alert status */}
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

      {/* Blocking filter — only for slow_sessions */}
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

      {/* Time range — right side */}
      <div className="ml-auto">
        <TimeRangePicker />
      </div>
    </div>
  );
}
