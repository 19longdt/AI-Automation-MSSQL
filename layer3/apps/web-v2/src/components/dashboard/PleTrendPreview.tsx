import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, LineChart, TimerReset } from "lucide-react";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { BaseMetricChart } from "@/components/dashboard/BaseMetricChart";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useTimeRange } from "@/hooks/useTimeRange";
import { apiGet } from "@/lib/api-client";
import { buildFindingsQuery } from "@/lib/dashboard-query";
import { formatNumber, parseWallClockDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { FindingWithAnalysis, FindingsQuery, FindingsResponse } from "@/types";

const PLE_TREND_BUCKET_MS = 5 * 60_000;
const PLE_COLOR = "#2563eb";
const BASELINE_COLOR = "#94a3b8";
const DEVIATION_COLOR = "#dc2626";
const ALERT_COLOR = "#f59e0b";

interface PleTrendPoint {
  ts: string;
  bucketTs: number;
  ple_sec: number | null;
  baseline_avg: number | null;
  deviation_pct: number | null;
  latestFinding: FindingWithAnalysis | null;
  [key: string]: unknown;
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

function formatDeviation(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(0)}%`;
}

function getDeviationPct(ple: number | null, baseline: number | null, fallback: number | null): number | null {
  if (fallback != null) return fallback;
  if (ple == null || baseline == null || baseline === 0) return null;
  return ((baseline - ple) / baseline) * 100;
}

function kpiTone(deviationPct: number | null): "good" | "warn" | "bad" {
  if (deviationPct == null) return "good";
  if (deviationPct > 50) return "bad";
  if (deviationPct > 25) return "warn";
  return "good";
}

function toneTextClass(tone: "good" | "warn" | "bad"): string {
  if (tone === "bad") return "text-[var(--color-critical)]";
  if (tone === "warn") return "text-[var(--color-warning)]";
  return "text-[var(--color-text)]";
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

function aggregatePleTrendSeries(findings: FindingWithAnalysis[], from: Date, to: Date): PleTrendPoint[] {
  const sorted = [...findings].sort((a, b) => {
    const aTs = parseWallClockDate(a.detected_at)?.getTime() ?? 0;
    const bTs = parseWallClockDate(b.detected_at)?.getTime() ?? 0;
    return aTs - bTs;
  });
  const buckets = new Map<number, PleTrendPoint>();

  sorted.forEach((finding) => {
    const findingTs = parseWallClockDate(finding.detected_at)?.getTime();
    if (!findingTs) return;
    const metrics = (finding.metrics ?? {}) as Record<string, unknown>;
    const bucketTs = floorToBucketMs(findingTs, PLE_TREND_BUCKET_MS);
    buckets.set(bucketTs, {
      ts: formatBucketTimeLabel(bucketTs),
      bucketTs,
      ple_sec: parseMetricNumber(metrics.ple_sec),
      baseline_avg: parseMetricNumber(metrics.baseline_avg),
      deviation_pct: getDeviationPct(
        parseMetricNumber(metrics.ple_sec),
        parseMetricNumber(metrics.baseline_avg),
        parseMetricNumber(metrics.deviation_pct),
      ),
      latestFinding: finding,
    });
  });

  const series: PleTrendPoint[] = [];
  const start = floorToBucketMs(from.getTime(), PLE_TREND_BUCKET_MS);
  const end = ceilToBucketMs(to.getTime(), PLE_TREND_BUCKET_MS);
  for (let cursor = start; cursor <= end; cursor += PLE_TREND_BUCKET_MS) {
    series.push(
      buckets.get(cursor) ?? {
        ts: formatBucketTimeLabel(cursor),
        bucketTs: cursor,
        ple_sec: null,
        baseline_avg: null,
        deviation_pct: null,
        latestFinding: null,
      },
    );
  }

  return series;
}

function aggregatePleTrendSeriesWithDisplayFrom(
  findings: FindingWithAnalysis[],
  from: Date,
  to: Date,
  displayFrom: Date,
): PleTrendPoint[] {
  const series = aggregatePleTrendSeries(findings, from, to);
  const displayStart = floorToBucketMs(displayFrom.getTime(), PLE_TREND_BUCKET_MS);
  return series.map((point, index) => ({
    ...point,
    ts: formatBucketTimeLabel(displayStart + index * PLE_TREND_BUCKET_MS),
  }));
}

function mergeCompareSeries(current: PleTrendPoint[], compare: PleTrendPoint[]): PleTrendPoint[] {
  return current.map((point, index) => ({
    ...point,
    ple_compare: (compare[index]?.ple_sec as number | null | undefined) ?? null,
    baseline_compare: (compare[index]?.baseline_avg as number | null | undefined) ?? null,
    deviation_compare: (compare[index]?.deviation_pct as number | null | undefined) ?? null,
  }));
}

function getLatestPoint(series: PleTrendPoint[]): PleTrendPoint | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].ple_sec != null || series[i].baseline_avg != null) return series[i];
  }
  return null;
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
              {entry.name?.includes("%") ? formatDeviation(Number(entry.value ?? 0)) : formatNumber(Number(entry.value ?? 0))}
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
        <span className={cn("text-[11px] font-semibold", toneTextClass(tone))}>{hint}</span>
      </div>
      <div
        className={cn("font-code text-[26px] font-bold leading-none tabular", toneTextClass(tone))}
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
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
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

export function PleTrendPreview(): React.ReactElement {
  const { selectedClusterId, filters, timeRange, comparePastEnabled } = useDashboardStore();
  const { from, to } = useTimeRange();
  const compareRange = useMemo(() => resolveCompareRange(timeRange, from, to), [timeRange, from, to]);

  const params: FindingsQuery = useMemo(
    () => ({
      ...buildFindingsQuery({ activeTopicId: "ple_trend", selectedClusterId, filters, from, to }, 0, 1),
      topic_id: "ple_trend",
    }),
    [selectedClusterId, filters, from, to],
  );
  const compareParams: FindingsQuery = useMemo(
    () => ({
      ...buildFindingsQuery({ activeTopicId: "ple_trend", selectedClusterId, filters, from: compareRange.from, to: compareRange.to }, 0, 1),
      topic_id: "ple_trend",
    }),
    [selectedClusterId, filters, compareRange.from, compareRange.to],
  );

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["ple-trend-preview-findings", params],
    queryFn: () => fetchAllFindings(params),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
  const { data: compareData, isFetching: compareFetching } = useQuery({
    queryKey: ["ple-trend-preview-findings-compare", compareParams],
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

  const series = useMemo(() => aggregatePleTrendSeries(sortedItems, from, to), [sortedItems, from, to]);
  const compareSeries = useMemo(
    () => comparePastEnabled ? aggregatePleTrendSeriesWithDisplayFrom(sortedCompareItems, compareRange.from, compareRange.to, from) : [],
    [comparePastEnabled, sortedCompareItems, compareRange.from, compareRange.to, from],
  );
  const chartSeries = useMemo(
    () => comparePastEnabled ? mergeCompareSeries(series, compareSeries) : series,
    [comparePastEnabled, series, compareSeries],
  );
  const latest = useMemo(() => getLatestPoint(series), [series]);
  const latestDeviation = latest?.deviation_pct ?? null;
  const tone = kpiTone(latestDeviation);

  if (isLoading && !data) return <LoadingState />;

  if (error) {
    return (
      <ErrorState
        message="Không tải được biểu đồ PLE baseline"
        description={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!series.some((point) => point.ple_sec != null || point.baseline_avg != null)) {
    return (
      <EmptyState
        title="Chưa có dữ liệu baseline cho PLE"
        description="Topic `ple_trend` cần dữ liệu lịch sử để build baseline. Thông thường cần ít nhất 1 tuần dữ liệu trước khi biểu đồ có ý nghĩa."
      />
    );
  }

  return (
    <div className="relative grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          icon={<TimerReset className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="page_life_expectancy">PLE hiện tại</GlossaryTip>}
          value={formatSeconds(latest?.ple_sec ?? null)}
          hint="Snapshot mới nhất"
          tone={tone}
          accentColor={PLE_COLOR}
        />
        <KpiCard
          icon={<LineChart className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="baseline_deviation">Baseline 4 tuần</GlossaryTip>}
          value={formatSeconds(latest?.baseline_avg ?? null)}
          hint="Cùng thứ và cùng giờ"
          tone="good"
          accentColor={BASELINE_COLOR}
        />
        <KpiCard
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="baseline_deviation">Độ lệch</GlossaryTip>}
          value={formatDeviation(latestDeviation)}
          hint="Ngưỡng alert 50%"
          tone={tone}
          accentColor={DEVIATION_COLOR}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <ChartFrame eyebrow="Baseline Comparison" title={<GlossaryTip glossaryKey="baseline_deviation">PLE thực tế so với baseline</GlossaryTip>}>
          <BaseMetricChart
            data={chartSeries}
            margin={{ top: 8, right: 10, left: 4, bottom: 0 }}
            tooltip={<MetricTooltip />}
            yAxes={[
              {
                width: 52,
                tickFormatter: (value: number) => (value >= 3600 ? `${(value / 3600).toFixed(1)}h` : `${Math.round(value)}s`),
              },
            ]}
            lines={[
              ...(comparePastEnabled ? [{
                dataKey: "ple_compare",
                name: `PLE thực tế (${compareRange.label})`,
                stroke: PLE_COLOR,
                strokeWidth: 1.4,
                strokeOpacity: 0.28,
              }] : []),
              {
                dataKey: "ple_sec",
                name: "PLE thực tế",
                stroke: PLE_COLOR,
              },
              ...(comparePastEnabled ? [{
                dataKey: "baseline_compare",
                name: `Baseline (${compareRange.label})`,
                stroke: BASELINE_COLOR,
                strokeWidth: 1.2,
                strokeOpacity: 0.28,
                strokeDasharray: "6 4",
              }] : []),
              {
                dataKey: "baseline_avg",
                name: "Baseline 4 tuần",
                stroke: BASELINE_COLOR,
                strokeWidth: 1.5,
                strokeDasharray: "6 4",
              },
            ]}
          />
        </ChartFrame>

        <ChartFrame eyebrow="Phát hiện bất thường" title={<GlossaryTip glossaryKey="baseline_deviation">Độ lệch so với baseline</GlossaryTip>}>
          <BaseMetricChart
            data={chartSeries}
            margin={{ top: 8, right: 10, left: 4, bottom: 0 }}
            tooltip={<MetricTooltip />}
            yAxes={[
              {
                width: 48,
                tickFormatter: (value: number) => `${Math.round(value)}%`,
              },
            ]}
            referenceLines={[{ y: 50, stroke: ALERT_COLOR }]}
            lines={[
              ...(comparePastEnabled ? [{
                dataKey: "deviation_compare",
                name: `Lệch so với baseline (%) ${compareRange.label}`,
                stroke: DEVIATION_COLOR,
                strokeWidth: 1.4,
                strokeOpacity: 0.28,
              }] : []),
              {
                dataKey: "deviation_pct",
                name: "Lệch so với baseline (%)",
                stroke: DEVIATION_COLOR,
              },
            ]}
          />
        </ChartFrame>
      </div>
      <RefreshingOverlay visible={(isFetching || compareFetching) && !!data} />
    </div>
  );
}
