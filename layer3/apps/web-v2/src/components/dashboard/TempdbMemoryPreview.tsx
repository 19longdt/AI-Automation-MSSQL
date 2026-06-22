import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, HardDrive, Layers3, TimerReset } from "lucide-react";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { BaseMetricChart } from "@/components/dashboard/BaseMetricChart";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useTimeRange } from "@/hooks/useTimeRange";
import { useTopicMetricThreshold } from "@/hooks/useTopics";
import { apiGet } from "@/lib/api-client";
import { buildFindingsQuery } from "@/lib/dashboard-query";
import { formatNumber, parseWallClockDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { FindingWithAnalysis, FindingsQuery, FindingsResponse, TopicThresholdConfig } from "@/types";

const TEMPDB_BUCKET_MS = 5 * 60_000;
const PLE_COLOR = "#2563eb";
const PLE_WARN_COLOR = "#f59e0b";
const PLE_CRIT_COLOR = "#dc2626";
const TEMPDB_USED_COLOR = "#0891b2";
const VERSION_STORE_COLOR = "#7c3aed";
const NUMA_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#ea580c", "#0891b2", "#be123c"];

interface TempdbPoint {
  ts: string;
  bucketTs: number;
  ple_sec: number | null;
  pending_grants: number | null;
  used_pct: number | null;
  version_store_mb: number | null;
  internal_mb: number | null;
  user_object_mb: number | null;
  latestFinding: FindingWithAnalysis | null;
  [key: string]: unknown;
}

interface TempdbSnapshot {
  pleSec: number | null;
  pendingGrants: number | null;
  usedPct: number | null;
  versionStoreMb: number | null;
}

function parseMetricNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function floorToBucketMs(ts: number, bucketMs: number): number {
  return ts - (ts % bucketMs);
}

function ceilToBucketMs(ts: number, bucketMs: number): number {
  const remainder = ts % bucketMs;
  return remainder === 0 ? ts : ts + (bucketMs - remainder);
}

function formatBucketTimeLabel(ts: number): string {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatSeconds(value: number | null): string {
  if (value == null) return "—";
  if (value >= 3600) return `${(value / 3600).toFixed(1)}h`;
  return `${Math.round(value).toLocaleString()}s`;
}

function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value)}%`;
}

function severityTone(mode: "good" | "warn" | "bad"): string {
  if (mode === "bad") return "text-[var(--color-critical)]";
  if (mode === "warn") return "text-[var(--color-warning)]";
  return "text-[var(--color-text)]";
}

function higherIsWorseTone(value: number | null, threshold: TopicThresholdConfig): "good" | "warn" | "bad" {
  if (value == null) return "good";
  if (threshold.critical != null && value >= threshold.critical) return "bad";
  if (threshold.warning != null && value >= threshold.warning) return "warn";
  return "good";
}

function lowerIsWorseTone(value: number | null, threshold: TopicThresholdConfig): "good" | "warn" | "bad" {
  if (value == null) return "good";
  if (threshold.critical != null && value <= threshold.critical) return "bad";
  if (threshold.warning != null && value <= threshold.warning) return "warn";
  return "good";
}

function kpiValueClass(tone: "good" | "warn" | "bad"): string {
  if (tone === "bad") return "text-[var(--color-critical)]";
  if (tone === "warn") return "text-[var(--color-warning)]";
  return "";
}

function replicaKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_");
}

function shiftRange(from: Date, to: Date, deltaMs: number): { from: Date; to: Date } {
  return {
    from: new Date(from.getTime() + deltaMs),
    to: new Date(to.getTime() + deltaMs),
  };
}

function resolveCompareRange(
  timeRange: ReturnType<typeof useDashboardStore.getState>["timeRange"],
  from: Date,
  to: Date,
): { from: Date; to: Date; label: string } {
  const durationMs = Math.max(1, to.getTime() - from.getTime());

  if (timeRange.mode === "preset") {
    if (timeRange.presetId === "today") {
      return { ...shiftRange(from, to, -24 * 60 * 60 * 1000), label: "hôm qua cùng thời điểm" };
    }
    if (timeRange.presetId === "this_week") {
      return { ...shiftRange(from, to, -7 * 24 * 60 * 60 * 1000), label: "tuần trước cùng thời điểm" };
    }
  }

  return { ...shiftRange(from, to, -durationMs), label: "cùng kỳ" };
}

async function fetchAllFindings(params: FindingsQuery): Promise<FindingsResponse> {
  const limit = 200;
  const items: FindingWithAnalysis[] = [];
  let total = 0;
  let page = 0;

  while (page < 100) {
    const response = await apiGet<FindingsResponse>("/api/findings", { ...params, limit, page });
    total = response.total;
    items.push(...response.items);
    if (items.length >= total || response.items.length < limit) break;
    page += 1;
  }

  return { total, items };
}

function aggregateTempdbSeries(findings: FindingWithAnalysis[], from: Date, to: Date): TempdbPoint[] {
  const sorted = [...findings].sort((a, b) => {
    const aTs = parseWallClockDate(a.detected_at)?.getTime() ?? 0;
    const bTs = parseWallClockDate(b.detected_at)?.getTime() ?? 0;
    return aTs - bTs;
  });
  const buckets = new Map<number, TempdbPoint>();

  sorted.forEach((finding) => {
    const findingTs = parseWallClockDate(finding.detected_at)?.getTime();
    if (!findingTs) return;

    const metrics = (finding.metrics ?? {}) as Record<string, unknown>;
    const bucketTs = floorToBucketMs(findingTs, TEMPDB_BUCKET_MS);
    const current = buckets.get(bucketTs) ?? {
      ts: formatBucketTimeLabel(bucketTs),
      bucketTs,
      ple_sec: null,
      pending_grants: null,
      used_pct: null,
      version_store_mb: null,
      internal_mb: null,
      user_object_mb: null,
      latestFinding: null,
    };

    if (parseMetricNumber(metrics.ple_sec) != null && !metrics.numa_node) {
      current.ple_sec = parseMetricNumber(metrics.ple_sec);
    }
    if (parseMetricNumber(metrics.pending_grants) != null) {
      current.pending_grants = parseMetricNumber(metrics.pending_grants);
    }
    if (parseMetricNumber(metrics.used_pct) != null) {
      current.used_pct = parseMetricNumber(metrics.used_pct);
    }
    if (parseMetricNumber(metrics.version_store_mb) != null) {
      current.version_store_mb = parseMetricNumber(metrics.version_store_mb);
    }
    if (parseMetricNumber(metrics.internal_mb) != null) {
      current.internal_mb = parseMetricNumber(metrics.internal_mb);
    }
    if (parseMetricNumber(metrics.user_object_mb) != null) {
      current.user_object_mb = parseMetricNumber(metrics.user_object_mb);
    }

    if (typeof metrics.numa_node === "string" && parseMetricNumber(metrics.ple_sec) != null) {
      current[`ple__${replicaKey(metrics.numa_node)}`] = parseMetricNumber(metrics.ple_sec);
    }

    current.latestFinding = finding;
    buckets.set(bucketTs, current);
  });

  const series: TempdbPoint[] = [];
  const start = floorToBucketMs(from.getTime(), TEMPDB_BUCKET_MS);
  const end = ceilToBucketMs(to.getTime(), TEMPDB_BUCKET_MS);
  for (let cursor = start; cursor <= end; cursor += TEMPDB_BUCKET_MS) {
    series.push(
      buckets.get(cursor) ?? {
        ts: formatBucketTimeLabel(cursor),
        bucketTs: cursor,
        ple_sec: null,
        pending_grants: null,
        used_pct: null,
        version_store_mb: null,
        internal_mb: null,
        user_object_mb: null,
        latestFinding: null,
      },
    );
  }

  return series;
}

function aggregateTempdbSeriesWithDisplayFrom(
  findings: FindingWithAnalysis[],
  from: Date,
  to: Date,
  displayFrom: Date,
): TempdbPoint[] {
  const series = aggregateTempdbSeries(findings, from, to);
  const displayStart = floorToBucketMs(displayFrom.getTime(), TEMPDB_BUCKET_MS);
  return series.map((point, index) => ({
    ...point,
    ts: formatBucketTimeLabel(displayStart + index * TEMPDB_BUCKET_MS),
  }));
}

function mergeCompareSeries(current: TempdbPoint[], compare: TempdbPoint[]): TempdbPoint[] {
  return current.map((point, index) => {
    const comparePoint = compare[index];
    return {
      ...point,
      ple_compare: (comparePoint?.ple_sec as number | null | undefined) ?? null,
      used_pct_compare: (comparePoint?.used_pct as number | null | undefined) ?? null,
      version_store_mb_compare: (comparePoint?.version_store_mb as number | null | undefined) ?? null,
    };
  });
}

function collectNumaNodes(series: TempdbPoint[]): string[] {
  const nodes = new Set<string>();
  series.forEach((point) => {
    Object.keys(point)
      .filter((key) => key.startsWith("ple__"))
      .forEach((key) => nodes.add(key.slice("ple__".length)));
  });
  return Array.from(nodes).sort();
}

function getLatestSnapshot(findings: FindingWithAnalysis[]): TempdbSnapshot {
  const latest = <T,>(predicate: (finding: FindingWithAnalysis) => T | null): T | null => {
    for (let i = findings.length - 1; i >= 0; i -= 1) {
      const value = predicate(findings[i]);
      if (value != null) return value;
    }
    return null;
  };

  return {
    pleSec: latest((finding) => {
      const metrics = (finding.metrics ?? {}) as Record<string, unknown>;
      if (metrics.numa_node) return null;
      return parseMetricNumber(metrics.ple_sec);
    }) ?? latest((finding) => parseMetricNumber((finding.metrics ?? {}).ple_sec)),
    pendingGrants: latest((finding) => parseMetricNumber((finding.metrics ?? {}).pending_grants)),
    usedPct: latest((finding) => parseMetricNumber((finding.metrics ?? {}).used_pct)),
    versionStoreMb: latest((finding) => parseMetricNumber((finding.metrics ?? {}).version_store_mb)),
  };
}

function MetricTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; color?: string; name?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter((entry) => typeof entry.value === "number");

  return (
    <div className="min-w-[220px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[0_12px_28px_var(--color-shadow-lg)]">
      <p className="mb-2 text-[11px] font-semibold text-[var(--color-muted)]">{label}</p>
      <div className="space-y-1">
        {entries.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-2" style={{ color: entry.color }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="font-code tabular" style={{ color: entry.color }}>
              {formatNumber(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone,
  accentColor,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: string;
  hint: string;
  tone: "good" | "warn" | "bad";
  accentColor: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
          <span style={{ color: accentColor }}>{icon}</span>
          <span>{label}</span>
        </div>
        <span className={cn("text-[11px] font-semibold", severityTone(tone))}>{hint}</span>
      </div>
      <div
        className={cn("font-code text-[26px] font-bold leading-none tabular", kpiValueClass(tone))}
        style={tone === "good" ? { color: accentColor } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function ChartFrame({
  title,
  eyebrow,
  children,
}: {
  title: React.ReactNode;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">{eyebrow}</p>
        <h3 className="text-[16px] font-semibold text-[var(--color-text)]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function LoadingState(): React.ReactElement {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[96px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-[380px] rounded-lg" />
        <Skeleton className="h-[380px] rounded-lg" />
      </div>
    </div>
  );
}

export function TempdbMemoryPreview(): React.ReactElement {
  const { selectedClusterId, filters, timeRange, comparePastEnabled } = useDashboardStore();
  const { from, to } = useTimeRange();
  const compareRange = useMemo(() => resolveCompareRange(timeRange, from, to), [timeRange, from, to]);

  const pleThreshold = useTopicMetricThreshold("tempdb_memory", "ple_sec", { warning: 1500, critical: 600 });
  const grantThreshold = useTopicMetricThreshold("tempdb_memory", "pending_grants", { warning: 1, critical: 5 });
  const usedPctThreshold = useTopicMetricThreshold("tempdb_memory", "used_pct", { warning: 70, critical: 85 });
  const versionStoreThreshold = useTopicMetricThreshold("tempdb_memory", "version_store_mb", { warning: 500, critical: 1000 });

  const params: FindingsQuery = useMemo(
    () => ({
      ...buildFindingsQuery({ activeTopicId: "tempdb_memory", selectedClusterId, filters, from, to }, 0, 1),
      topic_id: "tempdb_memory",
    }),
    [selectedClusterId, filters, from, to],
  );
  const compareParams: FindingsQuery = useMemo(
    () => ({
      ...buildFindingsQuery({ activeTopicId: "tempdb_memory", selectedClusterId, filters, from: compareRange.from, to: compareRange.to }, 0, 1),
      topic_id: "tempdb_memory",
    }),
    [selectedClusterId, filters, compareRange.from, compareRange.to],
  );

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["tempdb-preview-findings", params],
    queryFn: () => fetchAllFindings(params),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
  const { data: compareData, isFetching: compareFetching } = useQuery({
    queryKey: ["tempdb-preview-findings-compare", compareParams],
    queryFn: () => fetchAllFindings(compareParams),
    enabled: comparePastEnabled,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const sortedItems = useMemo(() => [...(data?.items ?? [])].sort((a, b) => {
    const aTs = parseWallClockDate(a.detected_at)?.getTime() ?? 0;
    const bTs = parseWallClockDate(b.detected_at)?.getTime() ?? 0;
    return aTs - bTs;
  }), [data?.items]);
  const sortedCompareItems = useMemo(() => [...(compareData?.items ?? [])].sort((a, b) => {
    const aTs = parseWallClockDate(a.detected_at)?.getTime() ?? 0;
    const bTs = parseWallClockDate(b.detected_at)?.getTime() ?? 0;
    return aTs - bTs;
  }), [compareData?.items]);

  const series = useMemo(() => aggregateTempdbSeries(sortedItems, from, to), [sortedItems, from, to]);
  const compareSeries = useMemo(
    () => comparePastEnabled ? aggregateTempdbSeriesWithDisplayFrom(sortedCompareItems, compareRange.from, compareRange.to, from) : [],
    [comparePastEnabled, sortedCompareItems, compareRange.from, compareRange.to, from],
  );
  const chartSeries = useMemo(
    () => comparePastEnabled ? mergeCompareSeries(series, compareSeries) : series,
    [comparePastEnabled, series, compareSeries],
  );
  const latest = useMemo(() => getLatestSnapshot(sortedItems), [sortedItems]);
  const numaKeys = useMemo(() => collectNumaNodes(series), [series]);

  if (isLoading && !data) return <LoadingState />;

  if (error) {
    return (
      <ErrorState
        message="Không tải được biểu đồ TempDB / PLE"
        description={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!series.some((point) => point.ple_sec != null || point.used_pct != null || point.version_store_mb != null || point.pending_grants != null)) {
    return (
      <EmptyState
        title="Không có dữ liệu TempDB / PLE"
        description="Không tìm thấy findings `tempdb_memory` có metric phù hợp trong khoảng thời gian đang chọn."
      />
    );
  }

  return (
    <div className="relative grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<TimerReset className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="page_life_expectancy">PLE</GlossaryTip>}
          value={formatSeconds(latest.pleSec)}
          hint={`Ngưỡng ${formatSeconds(pleThreshold.warning ?? null)} / ${formatSeconds(pleThreshold.critical ?? null)}`}
          tone={lowerIsWorseTone(latest.pleSec, pleThreshold)}
          accentColor={PLE_COLOR}
        />
        <KpiCard
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="resource_semaphore">Memory Grants</GlossaryTip>}
          value={formatNumber(latest.pendingGrants)}
          hint={`Compare: ${comparePastEnabled ? compareRange.label : "snapshot hiện tại"}`}
          tone={higherIsWorseTone(latest.pendingGrants, grantThreshold)}
          accentColor={PLE_WARN_COLOR}
        />
        <KpiCard
          icon={<Database className="h-3.5 w-3.5" />}
          label="TempDB Used"
          value={formatPercent(latest.usedPct)}
          hint={`Warn ${formatPercent(usedPctThreshold.warning ?? null)}`}
          tone={higherIsWorseTone(latest.usedPct, usedPctThreshold)}
          accentColor={TEMPDB_USED_COLOR}
        />
        <KpiCard
          icon={<Layers3 className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="version_store">Version Store</GlossaryTip>}
          value={latest.versionStoreMb == null ? "—" : `${formatNumber(Math.round(latest.versionStoreMb))} MB`}
          hint={`Warn ${formatNumber(versionStoreThreshold.warning ?? null)} MB`}
          tone={higherIsWorseTone(latest.versionStoreMb, versionStoreThreshold)}
          accentColor={VERSION_STORE_COLOR}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <ChartFrame eyebrow="Page Life Expectancy" title={<GlossaryTip glossaryKey="page_life_expectancy">PLE theo thời gian</GlossaryTip>}>
          <BaseMetricChart
            data={chartSeries}
            margin={{ top: 8, right: 10, left: 4, bottom: 0 }}
            tooltip={<MetricTooltip />}
            yAxes={[
              {
                width: 52,
                tickFormatter: (value: number) => (value >= 3600 ? `${Math.round(value / 3600)}h` : `${Math.round(value)}s`),
              },
            ]}
            referenceLines={[
              ...(pleThreshold.warning != null ? [{ y: pleThreshold.warning, stroke: PLE_WARN_COLOR }] : []),
              ...(pleThreshold.critical != null ? [{ y: pleThreshold.critical, stroke: PLE_CRIT_COLOR }] : []),
            ]}
            lines={[
              ...(comparePastEnabled ? [{
                dataKey: "ple_compare",
                name: `PLE (${compareRange.label})`,
                stroke: PLE_COLOR,
                strokeWidth: 1.4,
                strokeOpacity: 0.28,
              }] : []),
              {
                dataKey: "ple_sec",
                name: "PLE (giây)",
                stroke: PLE_COLOR,
              },
              ...numaKeys.map((numaKey, index) => ({
                dataKey: `ple__${numaKey}`,
                name: numaKey.replace(/_/g, " "),
                stroke: NUMA_COLORS[index % NUMA_COLORS.length],
                strokeWidth: 1.8,
              })),
            ]}
          />
        </ChartFrame>

        <ChartFrame eyebrow="TempDB Space" title={<GlossaryTip glossaryKey="version_store">Sử dụng TempDB</GlossaryTip>}>
          <BaseMetricChart
            data={chartSeries}
            margin={{ top: 8, right: 10, left: 4, bottom: 0 }}
            tooltip={<MetricTooltip />}
            yAxes={[
              {
                id: "pct",
                width: 44,
                tickFormatter: (value: number) => `${Math.round(value)}%`,
              },
              {
                id: "mb",
                orientation: "right",
                width: 52,
                tickFormatter: (value: number) => `${Math.round(value)}`,
              },
            ]}
            referenceLines={[
              ...(usedPctThreshold.warning != null ? [{ yAxisId: "pct", y: usedPctThreshold.warning, stroke: PLE_WARN_COLOR }] : []),
              ...(usedPctThreshold.critical != null ? [{ yAxisId: "pct", y: usedPctThreshold.critical, stroke: PLE_CRIT_COLOR }] : []),
              ...(versionStoreThreshold.warning != null ? [{ yAxisId: "mb", y: versionStoreThreshold.warning, stroke: VERSION_STORE_COLOR }] : []),
            ]}
            lines={[
              ...(comparePastEnabled ? [{
                yAxisId: "pct",
                dataKey: "used_pct_compare",
                name: `TempDB Used % (${compareRange.label})`,
                stroke: TEMPDB_USED_COLOR,
                strokeWidth: 1.4,
                strokeOpacity: 0.28,
              }] : []),
              {
                yAxisId: "pct",
                dataKey: "used_pct",
                name: "TempDB Used %",
                stroke: TEMPDB_USED_COLOR,
              },
              ...(comparePastEnabled ? [{
                yAxisId: "mb",
                dataKey: "version_store_mb_compare",
                name: `Version Store MB (${compareRange.label})`,
                stroke: VERSION_STORE_COLOR,
                strokeWidth: 1.4,
                strokeOpacity: 0.28,
              }] : []),
              {
                yAxisId: "mb",
                dataKey: "version_store_mb",
                name: "Version Store MB",
                stroke: VERSION_STORE_COLOR,
                strokeDasharray: "7 5",
              },
            ]}
          />
        </ChartFrame>
      </div>
      <RefreshingOverlay visible={(isFetching || compareFetching) && !!data} />
    </div>
  );
}
