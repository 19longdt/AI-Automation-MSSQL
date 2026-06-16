import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDrive, PauseCircle, Zap } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { Skeleton } from "@/components/ui/skeleton";
import { BaseMetricChart } from "@/components/dashboard/BaseMetricChart";
import { apiGet } from "@/lib/api-client";
import { buildFindingsQuery } from "@/lib/dashboard-query";
import { formatNumber, parseWallClockDate } from "@/lib/format";
import { useTopicMetricThreshold } from "@/hooks/useTopics";
import { useTimeRange } from "@/hooks/useTimeRange";
import { getThresholdSeverity } from "@/lib/topic-thresholds";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { FindingWithAnalysis, FindingsQuery, FindingsResponse, TopicThresholdConfig } from "@/types";

type ReplicaMetricMap = Record<string, { replica: string; queueKb: number | null; rateKbps: number | null }>;

interface HealthPoint {
  ts: string;
  bucketTs: number;
  sampleCount: number;
  suspendedCount: number;
  replicas: ReplicaMetricMap;
  latestFinding: FindingWithAnalysis | null;
  [key: string]: string | number | ReplicaMetricMap | FindingWithAnalysis | null | undefined;
}

interface BucketAccumulator {
  sampleCount: number;
  suspendedCount: number;
  latestFinding: FindingWithAnalysis | null;
  replicas: Map<string, { queueKb: number | null; rateKbps: number | null; finding: FindingWithAnalysis }>;
}

interface SnapshotSummary {
  maxQueueKb: number;
  maxQueueReplica: string | null;
  minRateKbps: number;
  minRateReplica: string | null;
  suspendedCount: number;
}

const HEALTH_BUCKET_MINUTES = 2;
const HEALTH_BUCKET_MS = HEALTH_BUCKET_MINUTES * 60_000;
const QUEUE_THRESHOLD_COLOR = "#f59e0b";
const QUEUE_CRITICAL_COLOR = "#dc2626";
const REPLICA_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#ea580c", "#0891b2", "#be123c"];

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
  return { ...shifted, label: "cùng kỳ" };
}

function severityTone(value: number, threshold: TopicThresholdConfig): "good" | "warn" | "bad" {
  const severity = getThresholdSeverity(value, threshold);
  if (severity === "critical") return "bad";
  if (severity === "warning") return "warn";
  return "good";
}

function kpiTone(mode: "good" | "warn" | "bad"): string {
  if (mode === "bad") return "text-[var(--color-critical)]";
  if (mode === "warn") return "text-[var(--color-warning)]";
  return "text-[var(--color-text)]";
}

function replicaKey(replica: string): string {
  return replica.replace(/[^a-zA-Z0-9]+/g, "_");
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

function aggregateHealthSeries(findings: FindingWithAnalysis[], from: Date, to: Date): HealthPoint[] {
  const sorted = [...findings].sort((a, b) => {
    const aTs = parseWallClockDate(a.detected_at)?.getTime() ?? 0;
    const bTs = parseWallClockDate(b.detected_at)?.getTime() ?? 0;
    return aTs - bTs;
  });

  const buckets = new Map<string, BucketAccumulator>();

  sorted.forEach((finding) => {
    if (!finding.detected_at) return;
    const metrics = (finding.metrics ?? {}) as Record<string, unknown>;
    const queueKb = parseMetricNumber(metrics.log_send_queue_size);
    const rateKbps = parseMetricNumber(metrics.log_send_rate);
    const replica = String(metrics.replica_server_name ?? finding.node ?? "unknown");
    const suspended = Number(metrics.is_suspended ?? 0) === 1 ? 1 : 0;
    const findingTs = parseWallClockDate(finding.detected_at)?.getTime() ?? 0;

    if (queueKb == null && rateKbps == null && suspended === 0) return;

    const bucketTs = floorToBucketMs(findingTs, HEALTH_BUCKET_MS);
    const key = String(bucketTs);
    const current = buckets.get(key) ?? {
      sampleCount: 0,
      suspendedCount: 0,
      latestFinding: null,
      replicas: new Map<string, { queueKb: number | null; rateKbps: number | null; finding: FindingWithAnalysis }>(),
    };

    current.sampleCount += 1;
    current.suspendedCount += suspended;
    current.latestFinding = finding;
    current.replicas.set(replica, { queueKb, rateKbps, finding });
    buckets.set(key, current);
  });

  const series: HealthPoint[] = [];
  const start = floorToBucketMs(from.getTime(), HEALTH_BUCKET_MS);
  const end = ceilToBucketMs(to.getTime(), HEALTH_BUCKET_MS);

  for (let cursor = start; cursor <= end; cursor += HEALTH_BUCKET_MS) {
    const bucket = buckets.get(String(cursor));
    const point: HealthPoint = {
      ts: formatBucketTimeLabel(cursor),
      bucketTs: cursor,
      sampleCount: bucket?.sampleCount ?? 0,
      suspendedCount: bucket?.suspendedCount ?? 0,
      replicas: {},
      latestFinding: bucket?.latestFinding ?? null,
    };

    bucket?.replicas.forEach((value, replica) => {
      const key = replicaKey(replica);
      point.replicas[replica] = { replica, queueKb: value.queueKb, rateKbps: value.rateKbps };
      point[`queue__${key}`] = value.queueKb;
      point[`rate__${key}`] = value.rateKbps;
    });

    series.push(point);
  }

  return series;
}

function aggregateHealthSeriesWithDisplayFrom(
  findings: FindingWithAnalysis[],
  from: Date,
  to: Date,
  displayFrom: Date,
): HealthPoint[] {
  const series = aggregateHealthSeries(findings, from, to);
  const displayStart = floorToBucketMs(displayFrom.getTime(), HEALTH_BUCKET_MS);
  return series.map((point, index) => ({
    ...point,
    ts: formatBucketTimeLabel(displayStart + index * HEALTH_BUCKET_MS),
  }));
}

function getReplicaNames(series: HealthPoint[]): string[] {
  const names = new Set<string>();
  series.forEach((point) => {
    Object.keys(point.replicas).forEach((replica) => names.add(replica));
  });
  return Array.from(names).sort();
}

function getLatestSnapshot(series: HealthPoint[]): HealthPoint | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (Object.keys(series[i].replicas).length > 0) return series[i];
  }
  return null;
}

function filterFindingsByReplica(findings: FindingWithAnalysis[], replica: string | undefined): FindingWithAnalysis[] {
  if (!replica) return findings;
  return findings.filter((finding) => String((finding.metrics ?? {})?.replica_server_name ?? "") === replica);
}

function summarizeSnapshot(point: HealthPoint | null, replicas: string[]): SnapshotSummary {
  let maxQueueKb = 0;
  let maxQueueReplica: string | null = null;
  let minRateKbps = Number.POSITIVE_INFINITY;
  let minRateReplica: string | null = null;

  replicas.forEach((replica) => {
    const metrics = point?.replicas[replica];
    if (!metrics) return;

    if ((metrics.queueKb ?? 0) >= maxQueueKb) {
      maxQueueKb = metrics.queueKb ?? 0;
      maxQueueReplica = replica;
    }

    if (metrics.rateKbps != null && metrics.rateKbps <= minRateKbps) {
      minRateKbps = metrics.rateKbps;
      minRateReplica = replica;
    }
  });

  return {
    maxQueueKb,
    maxQueueReplica,
    minRateKbps: Number.isFinite(minRateKbps) ? minRateKbps : 0,
    minRateReplica,
    suspendedCount: point?.suspendedCount ?? 0,
  };
}

function mergeCompareSeries(current: HealthPoint[], compare: HealthPoint[]): HealthPoint[] {
  return current.map((point, index) => {
    const comparePoint = compare[index];
    const merged: HealthPoint = { ...point };

    Object.keys(comparePoint?.replicas ?? {}).forEach((replica) => {
      const key = replicaKey(replica);
      merged[`queue_compare__${key}`] = comparePoint?.replicas[replica]?.queueKb ?? null;
      merged[`rate_compare__${key}`] = comparePoint?.replicas[replica]?.rateKbps ?? null;
    });

    return merged;
  });
}

function MetricTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; color?: string; name?: string }>;
  label?: string;
  unit: "KB" | "KB/s";
}) {
  if (!active || !payload?.length) return null;

  const entries = payload
    .filter((entry) => typeof entry.value === "number")
    .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));

  return (
    <div className="min-w-[180px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[0_12px_28px_var(--color-shadow-lg)]">
      <p className="mb-2 text-[11px] font-semibold text-[var(--color-muted)]">{label}</p>
      <div className="space-y-1">
        {entries.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-2" style={{ color: entry.color }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="font-code tabular" style={{ color: entry.color }}>
              {formatNumber(Number(entry.value ?? 0))} {unit}
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
  active = true,
  onClick,
}: {
  color: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-2)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] opacity-60",
      )}
    >
      <span className="inline-block h-0 w-5 border-t-2" style={{ borderColor: color }} />
      {label}
    </button>
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
  actions,
  children,
}: {
  title: React.ReactNode;
  eyebrow: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
            {eyebrow}
          </p>
          <h3 className="text-[16px] font-semibold text-[var(--color-text)]">{title}</h3>
        </div>
        {actions}
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
      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-[380px] rounded-lg" />
        <Skeleton className="h-[380px] rounded-lg" />
      </div>
    </div>
  );
}

export function AgHealthPreview(): React.ReactElement {
  const { activeTopicId, filters, timeRange, comparePastEnabled } = useDashboardStore();
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
    enabled: comparePastEnabled,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const [hiddenReplicas, setHiddenReplicas] = useState<string[]>([]);

  const filteredItems = useMemo(
    () => filterFindingsByReplica(data?.items ?? [], filters.replica),
    [data?.items, filters.replica],
  );
  const filteredCompareItems = useMemo(
    () => filterFindingsByReplica(compareData?.items ?? [], filters.replica),
    [compareData?.items, filters.replica],
  );

  const series = useMemo(() => aggregateHealthSeries(filteredItems, from, to), [filteredItems, from, to]);
  const compareSeries = useMemo(
    () => comparePastEnabled
      ? aggregateHealthSeriesWithDisplayFrom(filteredCompareItems, compareRange.from, compareRange.to, from)
      : [],
    [filteredCompareItems, compareRange.from, compareRange.to, from, comparePastEnabled],
  );
  const chartSeries = useMemo(
    () => comparePastEnabled ? mergeCompareSeries(series, compareSeries) : series,
    [series, compareSeries, comparePastEnabled],
  );

  const replicas = useMemo(() => getReplicaNames(series), [series]);
  const visibleReplicas = useMemo(
    () => replicas.filter((replica) => !hiddenReplicas.includes(replica)),
    [replicas, hiddenReplicas],
  );

  useEffect(() => {
    setHiddenReplicas((prev) => prev.filter((replica) => replicas.includes(replica)));
  }, [replicas]);

  const latestPoint = useMemo(() => getLatestSnapshot(series), [series]);
  const latestComparePoint = useMemo(() => getLatestSnapshot(compareSeries), [compareSeries]);
  const currentSummary = useMemo(() => summarizeSnapshot(latestPoint, replicas), [latestPoint, replicas]);
  const compareSummary = useMemo(() => summarizeSnapshot(latestComparePoint, replicas), [latestComparePoint, replicas]);
  const queueTone = severityTone(currentSummary.maxQueueKb, logSendQueueThreshold);
  const suspendedTone = severityTone(currentSummary.suspendedCount, suspendedThreshold);

  const toggleReplica = (replica: string): void => {
    setHiddenReplicas((prev) =>
      prev.includes(replica) ? prev.filter((item) => item !== replica) : [...prev, replica],
    );
  };

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

  if (!series.length || !latestPoint || !replicas.length) {
    return (
      <EmptyState
        title="Không có dữ liệu AG health"
        description="Không tìm thấy findings `ag_health` có metric log send trong khoảng thời gian đang chọn."
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="log_send_queue_size">Log Send Queue cao nhất</GlossaryTip>}
          value={`${formatNumber(currentSummary.maxQueueKb)} KB`}
          hint={`${currentSummary.maxQueueReplica ?? "-"} • ${formatDeltaPercent(currentSummary.maxQueueKb, compareSummary.maxQueueKb)} so với ${compareRange.label}`}
          tone={queueTone}
          accentColor={REPLICA_COLORS[0]}
        />
        <KpiCard
          icon={<Zap className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="log_send_rate">Log Send Rate thấp nhất</GlossaryTip>}
          value={`${formatNumber(currentSummary.minRateKbps)} KB/s`}
          hint={`${currentSummary.minRateReplica ?? "-"} • ${formatDeltaPercent(currentSummary.minRateKbps, compareSummary.minRateKbps)} so với ${compareRange.label}`}
          tone="good"
          accentColor={REPLICA_COLORS[1]}
        />
        <KpiCard
          icon={<PauseCircle className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="is_suspended">Replica Suspended</GlossaryTip>}
          value={formatNumber(currentSummary.suspendedCount)}
          hint={`${formatDeltaPercent(currentSummary.suspendedCount, compareSummary.suspendedCount)} so với ${compareRange.label}`}
          tone={suspendedTone}
          accentColor={QUEUE_CRITICAL_COLOR}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <ChartFrame
          eyebrow="Theo replica"
          title={<GlossaryTip glossaryKey="log_send_queue_size">Log Send Queue</GlossaryTip>}
        >
          <BaseMetricChart
            data={chartSeries}
            margin={{ top: 8, right: 10, left: 4, bottom: 0 }}
            tooltip={<MetricTooltip unit="KB" />}
            yAxes={[
              {
                width: 56,
                tickFormatter: (value: number) =>
                  value >= 1000 ? `${Math.round(value / 1000)}k` : `${Math.round(value)}`,
              },
            ]}
            referenceLines={[
              ...(logSendQueueThreshold.warning != null
                ? [{ y: logSendQueueThreshold.warning, stroke: QUEUE_THRESHOLD_COLOR }]
                : []),
              ...(logSendQueueThreshold.critical != null
                ? [{ y: logSendQueueThreshold.critical, stroke: QUEUE_CRITICAL_COLOR }]
                : []),
            ]}
            lines={replicas.flatMap((replica, index) => {
              const color = REPLICA_COLORS[index % REPLICA_COLORS.length];
              const key = replicaKey(replica);
              return [
                ...(comparePastEnabled ? [{
                  dataKey: `queue_compare__${key}`,
                  name: `${replica} (${compareRange.label})`,
                  stroke: color,
                  strokeWidth: 1.4,
                  strokeOpacity: 0.28,
                  hide: !visibleReplicas.includes(replica),
                }] : []),
                {
                  dataKey: `queue__${key}`,
                  name: replica,
                  stroke: color,
                  hide: !visibleReplicas.includes(replica),
                },
              ];
            })}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-2">
            {replicas.map((replica, index) => (
              <LegendItem
                key={replica}
                color={REPLICA_COLORS[index % REPLICA_COLORS.length]}
                label={replica}
                active={!hiddenReplicas.includes(replica)}
                onClick={() => toggleReplica(replica)}
              />
            ))}
            {logSendQueueThreshold.warning != null && (
              <LegendItem color={QUEUE_THRESHOLD_COLOR} label={`Ngưỡng queue ${formatNumber(logSendQueueThreshold.warning)} KB`} />
            )}
            {logSendQueueThreshold.critical != null && (
              <LegendItem color={QUEUE_CRITICAL_COLOR} label={`Mức nghiêm trọng ${formatNumber(logSendQueueThreshold.critical)} KB`} />
            )}
          </div>
        </ChartFrame>

        <ChartFrame
          eyebrow="Theo replica"
          title={<GlossaryTip glossaryKey="log_send_rate">Log Send Rate</GlossaryTip>}
        >
          <BaseMetricChart
            data={chartSeries}
            margin={{ top: 8, right: 10, left: 2, bottom: 0 }}
            tooltip={<MetricTooltip unit="KB/s" />}
            yAxes={[
              {
                width: 60,
                tickFormatter: (value: number) => `${Math.round(value)}`,
              },
            ]}
            lines={replicas.flatMap((replica, index) => {
              const color = REPLICA_COLORS[index % REPLICA_COLORS.length];
              const key = replicaKey(replica);
              return [
                ...(comparePastEnabled ? [{
                  dataKey: `rate_compare__${key}`,
                  name: `${replica} (${compareRange.label})`,
                  stroke: color,
                  strokeWidth: 1.4,
                  strokeOpacity: 0.28,
                  hide: !visibleReplicas.includes(replica),
                }] : []),
                {
                  dataKey: `rate__${key}`,
                  name: replica,
                  stroke: color,
                  hide: !visibleReplicas.includes(replica),
                },
              ];
            })}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-2">
            {replicas.map((replica, index) => (
              <LegendItem
                key={replica}
                color={REPLICA_COLORS[index % REPLICA_COLORS.length]}
                label={replica}
                active={!hiddenReplicas.includes(replica)}
                onClick={() => toggleReplica(replica)}
              />
            ))}
          </div>
        </ChartFrame>
      </div>
    </div>
  );
}
