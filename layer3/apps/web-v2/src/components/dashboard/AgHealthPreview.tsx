import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDrive, PauseCircle, Zap } from "lucide-react";
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
import { formatNumber, parseWallClockDate } from "@/lib/format";
import { useTopicMetricThreshold } from "@/hooks/useTopics";
import { useTimeRange } from "@/hooks/useTimeRange";
import { getThresholdSeverity } from "@/lib/topic-thresholds";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { FindingWithAnalysis, FindingsQuery, FindingsResponse, TopicThresholdConfig } from "@/types";

interface HealthPoint {
  ts: string;
  logSendQueueKb: number | null;
  logSendRateKbps: number | null;
  logSendQueueKbCompare?: number | null;
  logSendRateKbpsCompare?: number | null;
  sampleCount: number;
  suspendedCount: number;
  latestFinding: FindingWithAnalysis | null;
}

interface BucketAccumulator {
  sampleCount: number;
  suspendedCount: number;
  selectedFinding: FindingWithAnalysis;
  selectedQueueKb: number;
  selectedRateKbps: number;
}

const HEALTH_BUCKET_MINUTES = 2;
const HEALTH_BUCKET_MS = HEALTH_BUCKET_MINUTES * 60_000;
const QUEUE_COLOR = "#0f766e";
const RATE_COLOR = "#2563eb";
const SUSPENDED_COLOR = "#dc2626";

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

function severityTone(value: number, threshold: TopicThresholdConfig): "good" | "warn" | "bad" {
  const severity = getThresholdSeverity(value, threshold);
  if (severity === "critical") return "bad";
  if (severity === "warning") return "warn";
  return "good";
}

function compareHealthSeverity(
  queueKb: number,
  rateKbps: number,
  current: BucketAccumulator | undefined,
  logSendQueueThreshold: TopicThresholdConfig,
): boolean {
  if (!current) return true;

  const nextQueueBand =
    logSendQueueThreshold.critical != null && queueKb >= logSendQueueThreshold.critical ? 2 :
    logSendQueueThreshold.warning != null && queueKb >= logSendQueueThreshold.warning ? 1 : 0;
  const currentQueueBand =
    logSendQueueThreshold.critical != null && current.selectedQueueKb >= logSendQueueThreshold.critical ? 2 :
    logSendQueueThreshold.warning != null && current.selectedQueueKb >= logSendQueueThreshold.warning ? 1 : 0;

  if (nextQueueBand !== currentQueueBand) return nextQueueBand > currentQueueBand;
  if (queueKb !== current.selectedQueueKb) return queueKb > current.selectedQueueKb;
  return rateKbps < current.selectedRateKbps;
}

async function fetchAllHealthFindings(params: FindingsQuery): Promise<FindingsResponse> {
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

function aggregateHealthSeries(
  findings: FindingWithAnalysis[],
  from: Date,
  to: Date,
  logSendQueueThreshold: TopicThresholdConfig,
  displayFrom: Date = from,
): HealthPoint[] {
  const sorted = [...findings].sort((a, b) => {
    const aTs = parseWallClockDate(a.detected_at)?.getTime() ?? 0;
    const bTs = parseWallClockDate(b.detected_at)?.getTime() ?? 0;
    return aTs - bTs;
  });

  const buckets = new Map<string, BucketAccumulator>();

  sorted.forEach((finding) => {
    if (!finding.detected_at) return;
    const metrics = (finding.metrics ?? {}) as Record<string, unknown>;
    const logSendQueueKb = parseMetricNumber(metrics.log_send_queue_size);
    const logSendRateKbps = parseMetricNumber(metrics.log_send_rate);
    const isSuspended = Number(metrics.is_suspended ?? 0) === 1 ? 1 : 0;
    const findingTs = parseWallClockDate(finding.detected_at)?.getTime() ?? 0;

    if (logSendQueueKb == null && logSendRateKbps == null && isSuspended === 0) return;

    const bucketTs = floorToBucketMs(findingTs, HEALTH_BUCKET_MS);
    const key = String(bucketTs);
    const current = buckets.get(key);
    const queueValue = logSendQueueKb ?? 0;
    const rateValue = logSendRateKbps ?? 0;
    const shouldReplace = compareHealthSeverity(
      queueValue,
      rateValue,
      current,
      logSendQueueThreshold,
    );

    buckets.set(key, {
      sampleCount: (current?.sampleCount ?? 0) + 1,
      suspendedCount: (current?.suspendedCount ?? 0) + isSuspended,
      selectedFinding: shouldReplace ? finding : current!.selectedFinding,
      selectedQueueKb: shouldReplace ? queueValue : current!.selectedQueueKb,
      selectedRateKbps: shouldReplace ? rateValue : current!.selectedRateKbps,
    });
  });

  const series: HealthPoint[] = [];
  const start = floorToBucketMs(from.getTime(), HEALTH_BUCKET_MS);
  const end = ceilToBucketMs(to.getTime(), HEALTH_BUCKET_MS);
  const displayStart = floorToBucketMs(displayFrom.getTime(), HEALTH_BUCKET_MS);

  let slot = 0;
  for (let cursor = start; cursor <= end; cursor += HEALTH_BUCKET_MS, slot += 1) {
    const bucket = buckets.get(String(cursor));
    const displayCursor = displayStart + slot * HEALTH_BUCKET_MS;

    series.push({
      ts: formatBucketTimeLabel(displayCursor),
      logSendQueueKb: bucket ? bucket.selectedQueueKb : null,
      logSendRateKbps: bucket ? bucket.selectedRateKbps : null,
      sampleCount: bucket ? bucket.sampleCount : 0,
      suspendedCount: bucket ? bucket.suspendedCount : 0,
      latestFinding: bucket ? bucket.selectedFinding : null,
    });
  }

  return series;
}

function getLatestComparableValue(
  series: HealthPoint[],
  key: "logSendQueueKb" | "logSendRateKbps",
): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i][key];
    if (typeof value === "number") return value;
  }
  return null;
}

function getLatestPopulatedPoint(series: HealthPoint[]): HealthPoint | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (
      typeof series[i].logSendQueueKb === "number" ||
      typeof series[i].logSendRateKbps === "number"
    ) {
      return series[i];
    }
  }
  return null;
}

function mergeCompareSeries(current: HealthPoint[], compare: HealthPoint[]): HealthPoint[] {
  return current.map((point, index) => {
    const comparePoint = compare[index];
    return {
      ...point,
      logSendQueueKbCompare: comparePoint?.logSendQueueKb ?? null,
      logSendRateKbpsCompare: comparePoint?.logSendRateKbps ?? null,
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

  const getMetricLabel = (dataKey?: string, fallback?: string): string => {
    if (dataKey === "logSendQueueKb" || dataKey === "logSendQueueKbCompare") return "Log Send Queue";
    if (dataKey === "logSendRateKbps" || dataKey === "logSendRateKbpsCompare") return "Log Send Rate";
    return fallback ?? "";
  };

  const getMetricKey = (dataKey?: string): "queue" | "rate" | "other" => {
    if (dataKey === "logSendQueueKb" || dataKey === "logSendQueueKbCompare") return "queue";
    if (dataKey === "logSendRateKbps" || dataKey === "logSendRateKbpsCompare") return "rate";
    return "other";
  };

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
    const formatted =
      metricKey === "queue"
        ? `${formatNumber(value)} KB`
        : `${formatNumber(value)} KB/s`;
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
        {Array.from(grouped.entries()).map(([key, entry]) => (
          <div key={key} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-2" style={{ color: entry.color }}>
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.label}
            </span>
            <span className="font-code tabular text-right" style={{ color: entry.color }}>
              {entry.compare && <span className="mr-2 opacity-45">{entry.compare}</span>}
              {entry.current && <span>{entry.current}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  muted = false,
}: {
  color: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[11px]", muted ? "text-[var(--color-muted)]" : "text-[var(--color-text-2)]")}>
      <span
        className="inline-block h-0 w-5 border-t-2"
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
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
          {eyebrow}
        </p>
        <h3 className="text-[16px] font-semibold text-[var(--color-text)]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function LoadingState(): React.ReactElement {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[96px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[380px] rounded-lg" />
    </div>
  );
}

export function AgHealthPreview(): React.ReactElement {
  const { activeTopicId, filters, timeRange } = useDashboardStore();
  const { from, to } = useTimeRange();
  const logSendQueueThreshold = useTopicMetricThreshold("ag_health", "log_send_queue_size", {
    warning: 500,
    critical: 1000,
  });
  const suspendedThreshold = useTopicMetricThreshold("ag_health", "is_suspended", {
    warning: 1,
    critical: 1,
  });
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
    queryKey: ["ag-health-preview-findings", params],
    queryFn: () => fetchAllHealthFindings(params),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
  const { data: compareData } = useQuery({
    queryKey: ["ag-health-preview-findings-compare", compareParams],
    queryFn: () => fetchAllHealthFindings(compareParams),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const series = useMemo(
    () => aggregateHealthSeries(data?.items ?? [], from, to, logSendQueueThreshold),
    [data?.items, from, to, logSendQueueThreshold],
  );
  const compareSeries = useMemo(
    () => aggregateHealthSeries(compareData?.items ?? [], compareRange.from, compareRange.to, logSendQueueThreshold, from),
    [compareData?.items, compareRange.from, compareRange.to, logSendQueueThreshold, from],
  );
  const chartSeries = useMemo(() => mergeCompareSeries(series, compareSeries), [series, compareSeries]);

  const current = getLatestPopulatedPoint(chartSeries);
  const compareQueue = getLatestComparableValue(compareSeries, "logSendQueueKb");
  const compareRate = getLatestComparableValue(compareSeries, "logSendRateKbps");
  const compareSuspended = getLatestPopulatedPoint(compareSeries)?.suspendedCount ?? 0;
  const queueTone = severityTone(current?.logSendQueueKb ?? 0, logSendQueueThreshold);
  const suspendedTone = severityTone(current?.suspendedCount ?? 0, suspendedThreshold);

  if (isLoading && !data) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <ErrorState
        message="Không tải được biểu đồ AG health"
        description={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!series.length || !current) {
    return (
      <EmptyState
        title="Không có dữ liệu AG health"
        description="Không tìm thấy findings `ag_health` có metric log send trong khoảng thời gian đang chọn."
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="log_send_queue_size">Log Send Queue</GlossaryTip>}
          value={`${formatNumber(current.logSendQueueKb ?? 0)} KB`}
          hint={`${formatDeltaPercent(current.logSendQueueKb ?? 0, compareQueue ?? 0)} so với ${compareRange.label}`}
          tone={queueTone}
          accentColor={QUEUE_COLOR}
        />
        <KpiCard
          icon={<Zap className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="log_send_rate">Log Send Rate</GlossaryTip>}
          value={`${formatNumber(current.logSendRateKbps ?? 0)} KB/s`}
          hint={`${formatDeltaPercent(current.logSendRateKbps ?? 0, compareRate ?? 0)} so với ${compareRange.label}`}
          tone="good"
          accentColor={RATE_COLOR}
        />
        <KpiCard
          icon={<PauseCircle className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="is_suspended">Suspended</GlossaryTip>}
          value={formatNumber(current.suspendedCount)}
          hint={`${formatDeltaPercent(current.suspendedCount, compareSuspended)} so với ${compareRange.label}`}
          tone={suspendedTone}
          accentColor={SUSPENDED_COLOR}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <ChartFrame
          eyebrow="Tín hiệu chính"
          title={<GlossaryTip glossaryKey="log_send_queue_size">Log Send Queue</GlossaryTip>}
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
                <Tooltip content={<MetricTooltip />} />
                {logSendQueueThreshold.warning != null && (
                  <ReferenceLine yAxisId="queue" y={logSendQueueThreshold.warning} stroke="var(--color-warning)" strokeDasharray="4 4" />
                )}
                {logSendQueueThreshold.critical != null && (
                  <ReferenceLine yAxisId="queue" y={logSendQueueThreshold.critical} stroke="var(--color-critical)" strokeDasharray="4 4" />
                )}
                <Line
                  yAxisId="queue"
                  type="monotone"
                  dataKey="logSendQueueKbCompare"
                  stroke={QUEUE_COLOR}
                  strokeWidth={1.5}
                  strokeOpacity={0.3}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="queue"
                  type="monotone"
                  dataKey="logSendQueueKb"
                  stroke={QUEUE_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-2">
            <LegendItem color={QUEUE_COLOR} label="Log Send Queue" />
            <LegendItem color={QUEUE_COLOR} label={compareRange.label} muted />
            {logSendQueueThreshold.warning != null && (
              <LegendItem color="var(--color-warning)" label={`Ngưỡng queue ${formatNumber(logSendQueueThreshold.warning)} KB`} />
            )}
            {logSendQueueThreshold.critical != null && (
              <LegendItem color="var(--color-critical)" label={`Mức nghiêm trọng ${formatNumber(logSendQueueThreshold.critical)} KB`} />
            )}
          </div>
        </ChartFrame>

        <ChartFrame
          eyebrow="Thông lượng"
          title={<GlossaryTip glossaryKey="log_send_rate">Log Send Rate</GlossaryTip>}
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
                <Line
                  type="monotone"
                  dataKey="logSendRateKbpsCompare"
                  stroke={RATE_COLOR}
                  strokeWidth={1.5}
                  strokeOpacity={0.28}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="logSendRateKbps"
                  stroke={RATE_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-2">
            <LegendItem color={RATE_COLOR} label="Log Send Rate" />
            <LegendItem color={RATE_COLOR} label={compareRange.label} muted />
          </div>
        </ChartFrame>
      </div>
    </div>
  );
}
