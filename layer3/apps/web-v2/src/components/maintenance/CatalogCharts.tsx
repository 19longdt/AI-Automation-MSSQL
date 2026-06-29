import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame, BaseMetricChart } from "@/components/dashboard/BaseMetricChart";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCatalogIndexHistory,
  useCatalogStatsHistory,
  useCatalogTableHistory,
} from "@/hooks/useMaintenance";
import { formatDetectedAt, formatNumber, parseWallClockDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CatalogIndexTrendSeries,
  CatalogStatsTrendSeries,
  CatalogTableHistoryPoint,
} from "@/types";

const REBUILD_THRESHOLD = 30;
const REORG_THRESHOLD = 5;
const CHART_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#0d9488",
] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

type ChartRow = Record<string, number | string | null>;

function formatShortDate(value: string | null | undefined): string {
  const parsed = parseWallClockDate(value);
  if (!parsed) return "Unknown";
  return `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`;
}

function getLineColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

function getIndexBaseLabel(series: CatalogIndexTrendSeries): string {
  return series.index_name?.trim() || `Index ${series.index_id}`;
}

function buildRowCountTrend(points: CatalogTableHistoryPoint[]): ChartRow[] {
  return points.map((point, index) => {
    const previous = index > 0 ? points[index - 1] : null;
    return {
      ts: formatShortDate(point.captured_at),
      captured_at: point.captured_at,
      row_count: point.row_count,
      row_count_delta: previous ? point.row_count - previous.row_count : null,
      previous_row_count: previous?.row_count ?? null,
    };
  });
}

type FragViewMode = "by-index" | "by-index-partition" | "by-partition";

interface LineGroup {
  groupKey: string;
  label: string;
  color: string;
  lineKeys: string[];
}

function buildIndexChartModel(
  series: CatalogIndexTrendSeries[],
  viewMode: FragViewMode,
): { data: ChartRow[]; lines: Array<{ key: string; name: string; color: string }>; groups?: LineGroup[] } {
  const rows = new Map<string, ChartRow>();
  const lineMeta: Array<{ key: string; name: string; color: string }> = [];
  const lineIndex = new Map<string, number>();

  function ensureRow(point: { run_id: string; captured_at: string | null }) {
    const rowKey = point.run_id || point.captured_at || "";
    if (!rows.has(rowKey)) {
      rows.set(rowKey, {
        ts: formatShortDate(point.captured_at),
        captured_at: point.captured_at,
        run_id: point.run_id,
      });
    }
    return rows.get(rowKey)!;
  }

  function registerLine(key: string, name: string) {
    if (!lineIndex.has(key)) {
      const idx = lineMeta.length;
      lineIndex.set(key, idx);
      lineMeta.push({ key, name, color: getLineColor(idx) });
    }
  }

  function takeMax(row: ChartRow, key: string, val: number | null | undefined) {
    if (val == null) return;
    const cur = row[key];
    row[key] = typeof cur === "number" ? Math.max(cur, val) : val;
  }

  if (viewMode === "by-partition") {
    for (const item of series) {
      for (const point of item.points) {
        const row = ensureRow(point);
        if (point.partitions.length > 0) {
          for (const partition of point.partitions) {
            const partKey = `partition-${partition.partition_number}`;
            registerLine(partKey, `P${partition.partition_number}`);
            takeMax(row, partKey, partition.fragmentation_pct);
          }
        } else {
          // Non-partitioned index: contribute its frag to P1
          const partKey = "partition-1";
          registerLine(partKey, "P1");
          takeMax(row, partKey, point.fragmentation_pct);
        }
      }
    }
  } else {
    for (const item of series) {
      const baseLabel = getIndexBaseLabel(item);
      const baseKey = `index-${item.index_id}`;
      const hasPartitionData = item.is_partitioned && item.points.some((p) => p.partitions.length > 0);
      const splitPartitions = viewMode === "by-index-partition" && hasPartitionData;
      if (!splitPartitions) {
        registerLine(baseKey, baseLabel);
      }
      for (const point of item.points) {
        const row = ensureRow(point);
        if (!splitPartitions) {
          row[baseKey] = point.fragmentation_pct;
        } else if (point.partitions.length) {
          for (const partition of point.partitions) {
            const partKey = `${baseKey}-p${partition.partition_number}`;
            registerLine(partKey, `${baseLabel} [P${partition.partition_number}]`);
            row[partKey] = partition.fragmentation_pct;
          }
        } else {
          // is_partitioned but no partition data in this snapshot — fall back to aggregated
          registerLine(baseKey, baseLabel);
          row[baseKey] = point.fragmentation_pct;
        }
      }
    }
  }

  let groups: LineGroup[] | undefined;
  if (viewMode === "by-index-partition") {
    const built = series.flatMap((item) => {
      const baseKey = `index-${item.index_id}`;
      const baseLabel = getIndexBaseLabel(item);
      const groupLineKeys = lineMeta
        .filter((l) => l.key === baseKey || l.key.startsWith(`${baseKey}-p`))
        .map((l) => l.key);
      if (groupLineKeys.length === 0) return [];
      return [
        {
          groupKey: baseKey,
          label: baseLabel,
          color: lineMeta.find((l) => groupLineKeys.includes(l.key))?.color ?? getLineColor(0),
          lineKeys: groupLineKeys,
        },
      ];
    });
    if (built.length > 0) groups = built;
  }

  return {
    data: Array.from(rows.values()).sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at))),
    lines: lineMeta,
    groups,
  };
}

function buildStatsChartModel(series: CatalogStatsTrendSeries[], hideAutoCreated: boolean) {
  const filtered = hideAutoCreated ? series.filter((item) => !item.auto_created) : series;
  const rows = new Map<string, ChartRow>();
  const lines: Array<{ key: string; name: string; color: string }> = [];

  for (const item of filtered) {
    const lineKey = `stat-${item.stats_id}`;
    lines.push({
      key: lineKey,
      name: item.stats_name,
      color: getLineColor(lines.length),
    });
    for (const point of item.points) {
      const rowKey = point.run_id || point.captured_at || "";
      if (!rows.has(rowKey)) {
        rows.set(rowKey, {
          ts: formatShortDate(point.captured_at),
          captured_at: point.captured_at,
          run_id: point.run_id,
        });
      }
      rows.get(rowKey)![lineKey] = point.modification_counter;
    }
  }

  return {
    data: Array.from(rows.values()).sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at))),
    lines,
  };
}

function formatValue(value: unknown, percent = false): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return percent ? `${value.toFixed(1)}%` : formatNumber(value);
}

function formatSignedNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function ChartTooltip({
  active,
  payload,
  label,
  percent = false,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: unknown; color?: string }>;
  label?: string;
  percent?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{label}</p>
      <div className="mt-2 space-y-1.5">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4">
            <span className="inline-flex min-w-0 items-center gap-2 text-[var(--color-muted)]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || "var(--color-primary)" }} />
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="font-medium text-[var(--color-text)]">{formatValue(entry.value, percent)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RowCountDeltaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { row_count?: number | null; previous_row_count?: number | null }; value?: unknown }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  const current = point?.row_count ?? null;
  const previous = point?.previous_row_count ?? null;
  const rawValue = payload[0]?.value;
  const delta = typeof rawValue === "number" ? rawValue : null;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{label}</p>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[var(--color-muted)]">Change</span>
          <span className="font-medium text-[var(--color-text)]">{formatSignedNumber(delta)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[var(--color-muted)]">Current Rows</span>
          <span className="font-medium text-[var(--color-text)]">{formatNumber(current)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[var(--color-muted)]">Previous Rows</span>
          <span className="font-medium text-[var(--color-text)]">{formatNumber(previous)}</span>
        </div>
      </div>
    </div>
  );
}

function LegendToggles({
  lines,
  hiddenKeys,
  onSetHidden,
}: {
  lines: Array<{ key: string; name: string; color: string }>;
  hiddenKeys: Set<string>;
  onSetHidden: (next: Set<string>) => void;
}) {
  const visibleCount = lines.filter((l) => !hiddenKeys.has(l.key)).length;
  const hasHidden = hiddenKeys.size > 0;

  function handleClick(key: string) {
    const active = !hiddenKeys.has(key);
    const isSolo = active && visibleCount === 1;
    if (isSolo) {
      onSetHidden(new Set());
    } else if (active) {
      const next = new Set(hiddenKeys);
      next.add(key);
      onSetHidden(next);
    } else {
      onSetHidden(new Set(lines.filter((l) => l.key !== key).map((l) => l.key)));
    }
  }

  return (
    <div className="mb-2.5">
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pb-0.5 pr-0.5">
        {lines.map((line) => {
          const active = !hiddenKeys.has(line.key);
          const isSolo = active && visibleCount === 1;
          return (
            <button
              key={line.key}
              type="button"
              title={
                isSolo
                  ? "Click to show all"
                  : active
                    ? "Click to hide · or click a hidden item to isolate"
                    : "Click to show only this"
              }
              onClick={() => handleClick(line.key)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                active
                  ? isSolo
                    ? "border-[var(--color-primary)]/60 bg-[color:color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "border-[var(--color-border)]/50 bg-transparent text-[var(--color-muted)] opacity-50",
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: line.color }} />
              <span className="max-w-[180px] truncate">{line.name}</span>
              {isSolo && (
                <span className="rounded bg-[color:color-mix(in_srgb,var(--color-primary)_18%,transparent)] px-1 text-[8px] font-bold uppercase tracking-wide text-[var(--color-primary)]">
                  solo
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hasHidden && (
        <button
          type="button"
          onClick={() => onSetHidden(new Set())}
          className="mt-1 cursor-pointer text-[10px] text-[var(--color-primary)] hover:underline"
        >
          Show all ({lines.length})
        </button>
      )}
    </div>
  );
}

function IndexGroupedLegend({
  lines,
  groups,
  hiddenKeys,
  onSetHidden,
}: {
  lines: Array<{ key: string; name: string; color: string }>;
  groups: LineGroup[];
  hiddenKeys: Set<string>;
  onSetHidden: (next: Set<string>) => void;
}) {
  const hasHidden = hiddenKeys.size > 0;

  function isGroupSolo(group: LineGroup) {
    const allGroupVisible = group.lineKeys.every((k) => !hiddenKeys.has(k));
    const allOthersHidden = lines.filter((l) => !group.lineKeys.includes(l.key)).every((l) => hiddenKeys.has(l.key));
    return allGroupVisible && allOthersHidden && lines.length > group.lineKeys.length;
  }

  function isGroupFullyHidden(group: LineGroup) {
    return group.lineKeys.every((k) => hiddenKeys.has(k));
  }

  function handleGroupClick(group: LineGroup) {
    if (isGroupSolo(group)) {
      onSetHidden(new Set());
    } else {
      onSetHidden(new Set(lines.filter((l) => !group.lineKeys.includes(l.key)).map((l) => l.key)));
    }
  }

  function handlePartitionToggle(key: string) {
    const next = new Set(hiddenKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSetHidden(next);
  }

  return (
    <div className="mb-2.5 max-h-52 overflow-y-auto space-y-2 pr-0.5">
      {groups.map((group) => {
        const solo = isGroupSolo(group);
        const fullyHidden = isGroupFullyHidden(group);
        const groupLines = lines.filter((l) => group.lineKeys.includes(l.key));

        return (
          <div key={group.groupKey}>
            <button
              type="button"
              onClick={() => handleGroupClick(group)}
              title={solo ? "Click to show all" : "Click to show only this index"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors",
                solo
                  ? "border border-[var(--color-primary)]/40 bg-[color:color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]"
                  : fullyHidden
                    ? "text-[var(--color-muted)] opacity-40"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
              <span className="max-w-[220px] truncate">{group.label}</span>
              {solo && (
                <span className="rounded bg-[color:color-mix(in_srgb,var(--color-primary)_18%,transparent)] px-1 text-[8px] font-bold uppercase tracking-wide text-[var(--color-primary)]">
                  solo
                </span>
              )}
            </button>
            <div className="mt-1 flex flex-wrap gap-1 pl-5">
              {groupLines.map((line) => {
                const active = !hiddenKeys.has(line.key);
                const partLabel = line.name.match(/\[(.+)\]$/)?.[1] ?? line.name;
                return (
                  <button
                    key={line.key}
                    type="button"
                    onClick={() => handlePartitionToggle(line.key)}
                    title={active ? "Click to hide" : "Click to show"}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium transition-colors",
                      active
                        ? "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                        : "border-[var(--color-border)]/50 bg-transparent text-[var(--color-muted)] opacity-40",
                    )}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: line.color }} />
                    {partLabel}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {hasHidden && (
        <button
          type="button"
          onClick={() => onSetHidden(new Set())}
          className="mt-0.5 cursor-pointer text-[10px] text-[var(--color-primary)] hover:underline"
        >
          Show all ({lines.length})
        </button>
      )}
    </div>
  );
}

function RowCountChart({ points }: { points: CatalogTableHistoryPoint[] }) {
  if (points.length === 0) {
    return (
      <ChartFrame eyebrow="Trend" title="Row Count">
        <EmptyState title="No row count data" description="Run a catalog capture to collect row count data." />
      </ChartFrame>
    );
  }

  if (points.length === 1) {
    const pt = points[0];
    return (
      <ChartFrame eyebrow="Snapshot" title="Row Count">
        <div className="flex h-full flex-col items-center justify-center gap-1 py-6">
          <span className="text-3xl font-semibold tabular-nums text-[var(--color-text)]">
            {formatNumber(pt.row_count)}
          </span>
          <span className="text-xs text-[var(--color-muted)]">
            as of {formatShortDate(pt.captured_at)}
          </span>
          <span className="mt-2 text-[11px] text-[var(--color-muted)]">
            Capture more snapshots to show a trend
          </span>
        </div>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame eyebrow="Trend" title="Row Count Change">
      <BaseMetricChart
        data={buildRowCountTrend(points)}
        lines={[{ dataKey: "row_count_delta", name: "Row Delta", stroke: "var(--color-primary)" }]}
        yAxes={[{ width: 72, tickFormatter: (value) => formatNumber(value) }]}
        referenceLines={[{ y: 0, stroke: "var(--color-border)" }]}
        tooltip={<RowCountDeltaTooltip />}
      />
    </ChartFrame>
  );
}

const FRAG_VIEW_MODES: Array<{ value: FragViewMode; label: string; title: string }> = [
  { value: "by-index", label: "By Index", title: "One line per index (max fragmentation across partitions)" },
  { value: "by-index-partition", label: "Index × Partition", title: "One line per index per partition" },
  { value: "by-partition", label: "By Partition", title: "One line per partition (max fragmentation across all indexes)" },
];

function FragViewModeSelector({
  value,
  onChange,
  hasPartitioned,
}: {
  value: FragViewMode;
  onChange: (v: FragViewMode) => void;
  hasPartitioned: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
      {FRAG_VIEW_MODES.map((mode) => {
        const active = value === mode.value;
        const disabled = !hasPartitioned && mode.value !== "by-index";
        return (
          <button
            key={mode.value}
            type="button"
            title={disabled ? "No partition data available" : mode.title}
            disabled={disabled}
            onClick={() => onChange(mode.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
              active
                ? "bg-[var(--color-primary)] text-white"
                : disabled
                  ? "cursor-not-allowed text-[var(--color-muted)] opacity-40"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

function IndexFragChart({
  series,
  isLoading,
}: {
  series: CatalogIndexTrendSeries[];
  isLoading: boolean;
}) {
  const [viewMode, setViewMode] = useState<FragViewMode>("by-index");
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const hasPartitioned = series.some((item) => item.is_partitioned && item.points.some((point) => point.partitions.length > 0));
  const model = useMemo(() => buildIndexChartModel(series, viewMode), [series, viewMode]);

  if (isLoading) {
    return <Skeleton className="h-[360px] rounded-xl" />;
  }

  if (!model.lines.length) {
    return (
      <ChartFrame eyebrow="Trend" title="Index Fragmentation">
        <EmptyState title="No index trend data" description="This table does not have index history in the selected range." />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      eyebrow="Trend"
      title="Index Fragmentation"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--color-critical)]" /> REBUILD {"\u003e="} 30%</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--color-warning)]" /> REORG {"\u003e="} 5%</span>
        </div>
        <FragViewModeSelector
          value={viewMode}
          onChange={(v) => { setViewMode(v); setHiddenKeys(new Set()); }}
          hasPartitioned={hasPartitioned}
        />
      </div>

      {model.groups ? (
        <IndexGroupedLegend
          lines={model.lines}
          groups={model.groups}
          hiddenKeys={hiddenKeys}
          onSetHidden={setHiddenKeys}
        />
      ) : (
        <LegendToggles
          lines={model.lines}
          hiddenKeys={hiddenKeys}
          onSetHidden={setHiddenKeys}
        />
      )}

      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={model.data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="ts" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} />
            <YAxis tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={54} tickFormatter={(value) => `${value}%`} />
            <Tooltip content={<ChartTooltip percent />} isAnimationActive={false} cursor={false} />
            <ReferenceLine y={REBUILD_THRESHOLD} stroke="var(--color-critical)" strokeDasharray="4 4" />
            <ReferenceLine y={REORG_THRESHOLD} stroke="var(--color-warning)" strokeDasharray="4 4" />
            {model.lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                name={line.name}
                stroke={line.color}
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                hide={hiddenKeys.has(line.key)}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

function StatsModChart({
  series,
  isLoading,
}: {
  series: CatalogStatsTrendSeries[];
  isLoading: boolean;
}) {
  const [hideAutoCreated, setHideAutoCreated] = useState(true);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const model = useMemo(() => buildStatsChartModel(series, hideAutoCreated), [series, hideAutoCreated]);

  if (isLoading) {
    return <Skeleton className="h-[360px] rounded-xl" />;
  }

  if (!model.lines.length) {
    return (
      <ChartFrame eyebrow="Trend" title="Statistics Modifications">
        <EmptyState title="No statistics trend data" description="No statistics matched the current filters for this table." />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      eyebrow="Trend"
      title="Statistics Modifications"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--color-muted)]">Modification counter per statistic across snapshots.</p>
        <Button
          type="button"
          variant={hideAutoCreated ? "primary" : "outline"}
          size="sm"
          className="h-8 rounded-full px-3 text-[10px]"
          onClick={() => setHideAutoCreated((prev) => !prev)}
        >
          {hideAutoCreated ? "Showing manual stats" : "Show all stats"}
        </Button>
      </div>

      <LegendToggles
        lines={model.lines}
        hiddenKeys={hiddenKeys}
        onSetHidden={setHiddenKeys}
      />

      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={model.data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="ts" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} />
            <YAxis tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={72} tickFormatter={(value) => formatNumber(value)} />
            <Tooltip content={<ChartTooltip />} isAnimationActive={false} cursor={false} />
            {model.lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                name={line.name}
                stroke={line.color}
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                hide={hiddenKeys.has(line.key)}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

export function CatalogChartsPanel({
  database,
  schema,
  table,
  days,
}: {
  database: string;
  schema: string;
  table: string;
  days: number;
}) {
  const { data: tableHistory, isLoading: historyLoading, error: historyError } = useCatalogTableHistory(database, schema, table, days);
  const { data: indexHistory, isLoading: indexLoading, error: indexError } = useCatalogIndexHistory(database, schema, table, days);
  const { data: statsHistory, isLoading: statsLoading, error: statsError } = useCatalogStatsHistory(database, schema, table, days);

  if (historyError || indexError || statsError) {
    return (
      <ErrorState
        message="Failed to load catalog trends"
        description={
          historyError instanceof Error ? historyError.message
          : indexError instanceof Error ? indexError.message
          : statsError instanceof Error ? statsError.message
          : "Unknown error"
        }
      />
    );
  }

  const latestSnapshot = tableHistory?.[tableHistory.length - 1]?.captured_at ?? null;

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      <div className="border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">Table Trends</p>
            <h3 className="text-[16px] font-semibold text-[var(--color-text)]">{schema}.{table}</h3>
          </div>
          <div className="text-[11px] text-[var(--color-muted)]">
            <span>{database}</span>
            <span className="mx-2">|</span>
            <span>Range {days} days</span>
            <span className="mx-2">|</span>
            <span>{latestSnapshot ? `Latest ${formatDetectedAt(latestSnapshot)}` : "No snapshots yet"}</span>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {historyLoading ? (
          <Skeleton className="h-[320px] rounded-xl" />
        ) : (
          <RowCountChart points={tableHistory ?? []} />
        )}

        <div className="grid gap-3 xl:grid-cols-2">
          <IndexFragChart series={indexHistory ?? []} isLoading={indexLoading} />
          <StatsModChart series={statsHistory ?? []} isLoading={statsLoading} />
        </div>
      </div>
    </section>
  );
}
