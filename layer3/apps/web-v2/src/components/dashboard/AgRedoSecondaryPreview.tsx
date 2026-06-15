import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Gauge, RotateCcw, Sparkles } from "lucide-react";
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
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";
import { buildFindingsQuery } from "@/lib/dashboard-query";
import { formatDetectedAt, formatMs, formatNumber, parseWallClockDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTimeRange } from "@/hooks/useTimeRange";
import { useDashboardStore } from "@/store/dashboard.store";
import type { FindingWithAnalysis, FindingsQuery, FindingsResponse } from "@/types";

interface RedoPoint {
  ts: string;
  redoQueueKb: number | null;
  redoLagMs: number | null;
  redoRateKbps: number | null;
  redoQueueKbCompare?: number | null;
  redoLagMsCompare?: number | null;
  redoRateKbpsCompare?: number | null;
  sampleCount: number;
  latestFinding: FindingWithAnalysis | null;
}

interface BucketAccumulator {
  sampleCount: number;
  selectedFinding: FindingWithAnalysis;
  selectedQueueKb: number;
  selectedLagMs: number;
  selectedRateKbps: number;
}

const REDO_BUCKET_MINUTES = 2;
const REDO_BUCKET_MS = REDO_BUCKET_MINUTES * 60_000;
const REDO_QUEUE_WARNING_KB = 1000;
const REDO_QUEUE_CRITICAL_KB = 5000;
const REDO_LAG_WARNING_MS = 30_000;
const REDO_LAG_CRITICAL_MS = 120_000;
const QUEUE_COLOR = "#0f766e";
const LAG_COLOR = "#4338ca";
const RATE_COLOR = "#2563eb";
const SAMPLE_COLOR = "var(--color-primary)";

function parseMetricNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRedoLagMs(value: number | null): number | null {
  if (value == null) return null;
  return Math.max(0, value);
}

function floorToBucketMs(ts: number, bucketMs: number): number {
  return ts - (ts % bucketMs);
}

function ceilToBucketMs(ts: number, bucketMs: number): number {
  const remainder = ts % bucketMs;
  return remainder === 0 ? ts : ts + (bucketMs - remainder);
}

function formatBucketTimeLabel(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function kpiTone(mode: "good" | "warn" | "bad"): string {
  if (mode === "bad") return "text-[var(--color-critical)]";
  if (mode === "warn") return "text-[var(--color-warning)]";
  return "text-[var(--color-text)]";
}

function formatDeltaPercent(current: number, previous: number): string {
  if (!previous) return "new";
  const pct = ((current - previous) / previous) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
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
      const shifted = shiftRange(from, to, -24 * 60 * 60 * 1000);
      return { ...shifted, label: "hôm qua cùng thời điểm" };
    }
    if (timeRange.presetId === "this_week") {
      const shifted = shiftRange(from, to, -7 * 24 * 60 * 60 * 1000);
      return { ...shifted, label: "tuần trước cùng thời điểm" };
    }
  }

  const shifted = shiftRange(from, to, -durationMs);
  return { ...shifted, label: "cùng kỳ trước" };
}

function compareRedoSeverity(
  queueKb: number,
  lagMs: number,
  rateKbps: number,
  current: BucketAccumulator | undefined,
): boolean {
  if (!current) return true;

  const nextQueueBand =
    queueKb >= REDO_QUEUE_CRITICAL_KB ? 2 :
    queueKb >= REDO_QUEUE_WARNING_KB ? 1 : 0;
  const currentQueueBand =
    current.selectedQueueKb >= REDO_QUEUE_CRITICAL_KB ? 2 :
    current.selectedQueueKb >= REDO_QUEUE_WARNING_KB ? 1 : 0;

  const nextLagBand =
    lagMs >= REDO_LAG_CRITICAL_MS ? 2 :
    lagMs >= REDO_LAG_WARNING_MS ? 1 : 0;
  const currentLagBand =
    current.selectedLagMs >= REDO_LAG_CRITICAL_MS ? 2 :
    current.selectedLagMs >= REDO_LAG_WARNING_MS ? 1 : 0;

  if (nextLagBand !== currentLagBand) return nextLagBand > currentLagBand;
  if (nextQueueBand !== currentQueueBand) return nextQueueBand > currentQueueBand;
  if (lagMs !== current.selectedLagMs) return lagMs > current.selectedLagMs;
  if (queueKb !== current.selectedQueueKb) return queueKb > current.selectedQueueKb;
  return rateKbps < current.selectedRateKbps;
}

async function fetchAllRedoFindings(params: FindingsQuery): Promise<FindingsResponse> {
  const limit = 200;
  const items: FindingWithAnalysis[] = [];
  let total = 0;
  let page = 0;

  while (page < 100) {
    const response = await apiGet<FindingsResponse>("/api/findings", {
      ...params,
      limit,
      page,
    });
    total = response.total;
    items.push(...response.items);

    if (items.length >= total || response.items.length < limit) {
      break;
    }

    page += 1;
  }

  return { total, items };
}

function aggregateRedoSeries(
  findings: FindingWithAnalysis[],
  from: Date,
  to: Date,
  displayFrom: Date = from,
): RedoPoint[] {
  const sorted = [...findings].sort((a, b) => {
    const aTs = parseWallClockDate(a.detected_at)?.getTime() ?? 0;
    const bTs = parseWallClockDate(b.detected_at)?.getTime() ?? 0;
    return aTs - bTs;
  });

  const buckets = new Map<string, BucketAccumulator>();

  sorted.forEach((finding) => {
    if (!finding.detected_at) return;
    const metrics = (finding.metrics ?? {}) as Record<string, unknown>;
    const redoQueueKb = parseMetricNumber(metrics.redo_queue_size);
    const redoLagMs = normalizeRedoLagMs(parseMetricNumber(metrics.redo_lag_ms));
    const redoRateKbps = parseMetricNumber(metrics.redo_rate);
    const findingTs = parseWallClockDate(finding.detected_at)?.getTime() ?? 0;

    if (redoQueueKb == null && redoLagMs == null && redoRateKbps == null) return;

    const bucketTs = floorToBucketMs(findingTs, REDO_BUCKET_MS);
    const key = String(bucketTs);
    const current = buckets.get(key);
    const queueValue = redoQueueKb ?? 0;
    const lagValue = redoLagMs ?? 0;
    const rateValue = redoRateKbps ?? 0;
    const shouldReplace = compareRedoSeverity(queueValue, lagValue, rateValue, current);

    buckets.set(key, {
      sampleCount: (current?.sampleCount ?? 0) + 1,
      selectedFinding: shouldReplace ? finding : current!.selectedFinding,
      selectedQueueKb: shouldReplace ? queueValue : current!.selectedQueueKb,
      selectedLagMs: shouldReplace ? lagValue : current!.selectedLagMs,
      selectedRateKbps: shouldReplace ? rateValue : current!.selectedRateKbps,
    });
  });

  const series: RedoPoint[] = [];
  const start = floorToBucketMs(from.getTime(), REDO_BUCKET_MS);
  const end = ceilToBucketMs(to.getTime(), REDO_BUCKET_MS);
  const displayStart = floorToBucketMs(displayFrom.getTime(), REDO_BUCKET_MS);

  let slot = 0;
  for (let cursor = start; cursor <= end; cursor += REDO_BUCKET_MS, slot += 1) {
    const bucket = buckets.get(String(cursor));
    const displayCursor = displayStart + slot * REDO_BUCKET_MS;

    series.push({
      ts: formatBucketTimeLabel(displayCursor),
      redoQueueKb: bucket ? bucket.selectedQueueKb : null,
      redoLagMs: bucket ? bucket.selectedLagMs : null,
      redoRateKbps: bucket ? bucket.selectedRateKbps : null,
      sampleCount: bucket ? bucket.sampleCount : 0,
      latestFinding: bucket ? bucket.selectedFinding : null,
    });
  }

  return series;
}

function getLatestComparableValue(series: RedoPoint[], key: "redoQueueKb" | "redoLagMs" | "redoRateKbps"): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i][key];
    if (typeof value === "number") return value;
  }
  return null;
}

function getLatestPopulatedPoint(series: RedoPoint[]): RedoPoint | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (
      typeof series[i].redoQueueKb === "number" ||
      typeof series[i].redoLagMs === "number" ||
      typeof series[i].redoRateKbps === "number"
    ) {
      return series[i];
    }
  }
  return null;
}

function mergeCompareSeries(current: RedoPoint[], compare: RedoPoint[]): RedoPoint[] {
  return current.map((point, index) => {
    const comparePoint = compare[index];
    return {
      ...point,
      redoQueueKbCompare: comparePoint?.redoQueueKb ?? null,
      redoLagMsCompare: comparePoint?.redoLagMs ?? null,
      redoRateKbpsCompare: comparePoint?.redoRateKbps ?? null,
    };
  });
}

function MetricTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string; name?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const isLagSeries = (dataKey?: string): boolean =>
    dataKey === "redoLagMs" || dataKey === "redoLagMsCompare";

  const isRateSeries = (dataKey?: string): boolean =>
    dataKey === "redoRateKbps" || dataKey === "redoRateKbpsCompare";

  const getMetricLabel = (dataKey?: string, fallback?: string): string => {
    if (dataKey === "redoQueueKb" || dataKey === "redoQueueKbCompare") return "Redo Queue";
    if (dataKey === "redoLagMs" || dataKey === "redoLagMsCompare") return "Redo Lag";
    if (dataKey === "redoRateKbps" || dataKey === "redoRateKbpsCompare") return "Redo Rate";
    return fallback ?? "";
  };

  const getMetricKey = (dataKey?: string): "queue" | "lag" | "rate" | "other" => {
    if (dataKey === "redoQueueKb" || dataKey === "redoQueueKbCompare") return "queue";
    if (dataKey === "redoLagMs" || dataKey === "redoLagMsCompare") return "lag";
    if (dataKey === "redoRateKbps" || dataKey === "redoRateKbpsCompare") return "rate";
    return "other";
  };

  const formatMetricValue = (dataKey: string | undefined, value: number): string =>
    isLagSeries(dataKey)
      ? formatMs(value)
      : `${formatNumber(value)} ${isRateSeries(dataKey) ? "KB/s" : "KB"}`;

  const grouped = new Map<
    string,
    {
      label: string;
      color: string;
      current?: string;
      compare?: string;
    }
  >();

  payload.forEach((entry) => {
    const value = Number(entry.value ?? 0);
    const metricKey = getMetricKey(entry.dataKey);
    if (metricKey === "other") return;
    const existing = grouped.get(metricKey) ?? {
      label: getMetricLabel(entry.dataKey, entry.name),
      color: entry.color ?? "var(--color-text)",
    };
    const formatted = formatMetricValue(entry.dataKey, value);
    if (entry.dataKey?.endsWith("Compare")) {
      existing.compare = formatted;
    } else {
      existing.current = formatted;
    }
    grouped.set(metricKey, existing);
  });

  return (
    <div className="min-w-[180px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[0_12px_28px_var(--color-shadow-lg)]">
      <p className="mb-2 text-[11px] font-semibold text-[var(--color-muted)]">
        {label}
      </p>
      <div className="space-y-1">
        {Array.from(grouped.entries()).map(([key, entry]) => {
          return (
            <div key={key} className="text-[12px]">
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2" style={{ color: entry.color }}>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  {entry.label}
                </span>
                <span className="font-code tabular text-right" style={{ color: entry.color }}>
                  {entry.compare && (
                    <span className="mr-2 opacity-45">{entry.compare}</span>
                  )}
                  {entry.current && (
                    <span>{entry.current}</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  dashed = false,
  muted = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  muted?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[11px]", muted ? "text-[var(--color-muted)]" : "text-[var(--color-text-2)]")}>
      <span
        className={cn("inline-block h-0 w-5 border-t-2", dashed && "border-dashed")}
        style={{ borderColor: color, opacity: muted ? 0.45 : 1 }}
      />
      {label}
    </span>
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
  const valueClass =
    tone === "bad"
      ? "text-[var(--color-critical)]"
      : tone === "warn"
        ? "text-[var(--color-warning)]"
        : "";

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
          <span style={{ color: accentColor }}>{icon}</span>
          <span>{label}</span>
        </div>
        <span className={cn("text-[11px] font-semibold", kpiTone(tone))}>{hint}</span>
      </div>
      <div
        className={cn("font-code text-[26px] font-bold leading-none tabular", valueClass)}
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
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
            {eyebrow}
          </p>
          <h3 className="text-[16px] font-semibold text-[var(--color-text)]">{title}</h3>
        </div>
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

export function AgRedoSecondaryPreview(): React.ReactElement {
  const { activeTopicId, filters, timeRange } = useDashboardStore();
  const { from, to } = useTimeRange();
  const compareRange = useMemo(() => resolveCompareRange(timeRange, from, to), [timeRange, from, to]);

  const params: FindingsQuery = useMemo(
    () => buildFindingsQuery({ activeTopicId, filters, from, to }, 0, 1),
    [activeTopicId, filters, from, to],
  );
  const compareParams: FindingsQuery = useMemo(
    () => buildFindingsQuery({ activeTopicId, filters, from: compareRange.from, to: compareRange.to }, 0, 1),
    [activeTopicId, filters, compareRange.from, compareRange.to],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ag-redo-preview-findings", params],
    queryFn: () => fetchAllRedoFindings(params),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
  const { data: compareData } = useQuery({
    queryKey: ["ag-redo-preview-findings-compare", compareParams],
    queryFn: () => fetchAllRedoFindings(compareParams),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const series = useMemo(() => aggregateRedoSeries(data?.items ?? [], from, to), [data?.items, from, to]);
  const compareSeries = useMemo(
    () => aggregateRedoSeries(compareData?.items ?? [], compareRange.from, compareRange.to, from),
    [compareData?.items, compareRange.from, compareRange.to, from],
  );
  const chartSeries = useMemo(() => mergeCompareSeries(series, compareSeries), [series, compareSeries]);

  const current = getLatestPopulatedPoint(chartSeries);
  const compareQueue = getLatestComparableValue(compareSeries, "redoQueueKb");
  const compareLag = getLatestComparableValue(compareSeries, "redoLagMs");
  const compareRate = getLatestComparableValue(compareSeries, "redoRateKbps");
  const sampleCount = data?.items.length ?? 0;

  if (isLoading && !data) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <ErrorState
        message="Không tải được biểu đồ AG redo"
        description={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!series.length || !current) {
    return (
      <EmptyState
        title="Không có dữ liệu AG redo"
        description="Không tìm thấy findings `ag_redo_secondary` có metric redo trong khoảng thời gian đang chọn."
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="redo_queue_size">Redo Queue</GlossaryTip>}
          value={`${formatNumber(current.redoQueueKb ?? 0)} KB`}
          hint={`${formatDeltaPercent(current.redoQueueKb ?? 0, compareQueue ?? 0)} so với ${compareRange.label}`}
          tone={(current.redoQueueKb ?? 0) >= REDO_QUEUE_CRITICAL_KB ? "bad" : (current.redoQueueKb ?? 0) >= REDO_QUEUE_WARNING_KB ? "warn" : "good"}
          accentColor={QUEUE_COLOR}
        />
        <KpiCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="secondary_lag_seconds">Redo Lag</GlossaryTip>}
          value={formatMs(current.redoLagMs ?? 0)}
          hint={`${formatDeltaPercent(current.redoLagMs ?? 0, compareLag ?? 0)} so với ${compareRange.label}`}
          tone={(current.redoLagMs ?? 0) >= REDO_LAG_CRITICAL_MS ? "bad" : (current.redoLagMs ?? 0) >= REDO_LAG_WARNING_MS ? "warn" : "good"}
          accentColor={LAG_COLOR}
        />
        <KpiCard
          icon={<Gauge className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="redo_rate">Redo Rate</GlossaryTip>}
          value={`${formatNumber(current.redoRateKbps ?? 0)} KB/s`}
          hint={`${formatDeltaPercent(current.redoRateKbps ?? 0, compareRate ?? 0)} so với ${compareRange.label}`}
          tone={(current.redoRateKbps ?? 0) < 1000 ? "bad" : (current.redoRateKbps ?? 0) < 1400 ? "warn" : "good"}
          accentColor={RATE_COLOR}
        />
        <KpiCard
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Số mẫu"
          value={formatNumber(sampleCount)}
          hint={`${formatNumber(current.sampleCount)} dòng trong bucket mới nhất`}
          tone="good"
          accentColor={SAMPLE_COLOR}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <ChartFrame
          eyebrow="Tín hiệu chính"
          title={
            <>
              <GlossaryTip glossaryKey="redo_queue_size">Redo Queue</GlossaryTip>
              {" "}so với{" "}
              <GlossaryTip glossaryKey="secondary_lag_seconds">Redo Lag</GlossaryTip>
            </>
          }
        >
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartSeries} margin={{ top: 8, right: 10, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 4" vertical={false} />
                <XAxis
                  dataKey="ts"
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="queue"
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
                />
                <YAxis
                  yAxisId="lag"
                  orientation="right"
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(value: number) => formatMs(value)}
                />
                <Tooltip content={<MetricTooltip />} />
                <ReferenceLine yAxisId="queue" y={REDO_QUEUE_WARNING_KB} stroke="var(--color-warning)" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="lag" y={REDO_LAG_CRITICAL_MS} stroke="var(--color-critical)" strokeDasharray="4 4" />
                <Line
                  yAxisId="queue"
                  type="monotone"
                  dataKey="redoQueueKbCompare"
                  name={`Redo Queue (${compareRange.label})`}
                  stroke={QUEUE_COLOR}
                  strokeWidth={1.5}
                  strokeOpacity={0.3}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="queue"
                  type="monotone"
                  dataKey="redoQueueKb"
                  name="Redo Queue"
                  stroke={QUEUE_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="lag"
                  type="monotone"
                  dataKey="redoLagMsCompare"
                  name={`Redo Lag (${compareRange.label})`}
                  stroke={LAG_COLOR}
                  strokeWidth={1.5}
                  strokeOpacity={0.28}
                  strokeDasharray="6 6"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="lag"
                  type="monotone"
                  dataKey="redoLagMs"
                  name="Redo Lag"
                  stroke={LAG_COLOR}
                  strokeWidth={2.5}
                  strokeDasharray="8 6"
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-2">
            <LegendItem color={QUEUE_COLOR} label="Redo Queue" />
            <LegendItem color={LAG_COLOR} label="Redo Lag" dashed />
            <LegendItem color={QUEUE_COLOR} label={`${compareRange.label}`} muted />
            <LegendItem color="var(--color-warning)" label="Ngưỡng queue" />
            <LegendItem color="var(--color-critical)" label="Ngưỡng lag" dashed />
          </div>
        </ChartFrame>

        <ChartFrame
          eyebrow="Khả năng bắt kịp"
          title={<GlossaryTip glossaryKey="redo_rate">Redo Rate</GlossaryTip>}
        >
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartSeries} margin={{ top: 8, right: 10, left: 2, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 4" vertical={false} />
                <XAxis
                  dataKey="ts"
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                  tickFormatter={(value: number) => `${Math.round(value)}`}
                />
                <Tooltip content={<MetricTooltip />} />
                <ReferenceLine y={1000} stroke="var(--color-critical)" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="redoRateKbpsCompare"
                  name={`Redo Rate (${compareRange.label})`}
                  stroke={RATE_COLOR}
                  strokeWidth={1.5}
                  strokeOpacity={0.28}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="redoRateKbps"
                  name="Redo Rate"
                  stroke={RATE_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-2">
            <LegendItem color={RATE_COLOR} label="Redo Rate" />
            <LegendItem color={RATE_COLOR} label={`${compareRange.label}`} muted />
            <LegendItem color="var(--color-critical)" label="Mốc rate thấp" />
          </div>
        </ChartFrame>
      </div>

    </div>
  );
}
