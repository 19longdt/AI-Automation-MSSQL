import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Gauge, RotateCcw, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { BaseMetricChart } from "@/components/dashboard/BaseMetricChart";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { GlossaryTip } from "@/components/plan/GlossaryTip";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";
import { buildFindingsQuery } from "@/lib/dashboard-query";
import { formatMs, formatNumber, parseWallClockDate } from "@/lib/format";
import { useTopicMetricThreshold } from "@/hooks/useTopics";
import { cn } from "@/lib/utils";
import { getThresholdSeverity } from "@/lib/topic-thresholds";
import { useTimeRange } from "@/hooks/useTimeRange";
import { useDashboardStore } from "@/store/dashboard.store";
import type { FindingWithAnalysis, FindingsQuery, FindingsResponse, TopicThresholdConfig } from "@/types";

type ReplicaRedoMetricMap = Record<
  string,
  {
    replica: string;
    queueKb: number | null;
    lagMs: number | null;
    rateKbps: number | null;
    suspended: boolean;
  }
>;

interface RedoPoint {
  ts: string;
  bucketTs: number;
  sampleCount: number;
  replicas: ReplicaRedoMetricMap;
  latestFinding: FindingWithAnalysis | null;
  [key: string]: string | number | ReplicaRedoMetricMap | FindingWithAnalysis | null | undefined;
}

interface BucketAccumulator {
  sampleCount: number;
  latestFinding: FindingWithAnalysis | null;
  replicas: Map<
    string,
    {
      queueKb: number | null;
      lagMs: number | null;
      rateKbps: number | null;
      suspended: boolean;
      finding: FindingWithAnalysis;
    }
  >;
}

interface RedoSnapshotSummary {
  maxQueueKb: number;
  maxQueueReplica: string | null;
  maxLagMs: number;
  maxLagReplica: string | null;
  minRateKbps: number;
  minRateReplica: string | null;
  laggingReplicaCount: number;
}

const REDO_BUCKET_MINUTES = 2;
const REDO_BUCKET_MS = REDO_BUCKET_MINUTES * 60_000;
const QUEUE_COLOR = "#0f766e";
const LAG_COLOR = "#4338ca";
const RATE_COLOR = "#2563eb";
const SAMPLE_COLOR = "var(--color-primary)";
const REPLICA_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#ea580c", "#0891b2", "#be123c"];

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
  return { ...shifted, label: "cùng kỳ" };
}

function severityTone(value: number, threshold: TopicThresholdConfig): "good" | "warn" | "bad" {
  const severity = getThresholdSeverity(value, threshold);
  if (severity === "critical") return "bad";
  if (severity === "warning") return "warn";
  return "good";
}

function replicaKey(replica: string): string {
  return replica.replace(/[^a-zA-Z0-9]+/g, "_");
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

function filterFindingsByReplica(findings: FindingWithAnalysis[], replica: string | undefined): FindingWithAnalysis[] {
  if (!replica) return findings;
  return findings.filter((finding) => String((finding.metrics ?? {})?.replica_server_name ?? "") === replica);
}

function aggregateRedoSeries(findings: FindingWithAnalysis[], from: Date, to: Date): RedoPoint[] {
  const sorted = [...findings].sort((a, b) => {
    const aTs = parseWallClockDate(a.detected_at)?.getTime() ?? 0;
    const bTs = parseWallClockDate(b.detected_at)?.getTime() ?? 0;
    return aTs - bTs;
  });

  const buckets = new Map<string, BucketAccumulator>();

  sorted.forEach((finding) => {
    if (!finding.detected_at) return;
    const metrics = (finding.metrics ?? {}) as Record<string, unknown>;
    const queueKb = parseMetricNumber(metrics.redo_queue_size);
    const lagMs = normalizeRedoLagMs(parseMetricNumber(metrics.redo_lag_ms));
    const rateKbps = parseMetricNumber(metrics.redo_rate);
    const suspended = Number(metrics.is_suspended ?? 0) === 1;
    const replica = String(metrics.replica_server_name ?? finding.node ?? "unknown");
    const findingTs = parseWallClockDate(finding.detected_at)?.getTime() ?? 0;

    if (queueKb == null && lagMs == null && rateKbps == null && !suspended) return;

    const bucketTs = floorToBucketMs(findingTs, REDO_BUCKET_MS);
    const key = String(bucketTs);
    const current = buckets.get(key) ?? {
      sampleCount: 0,
      latestFinding: null,
      replicas: new Map<
        string,
        {
          queueKb: number | null;
          lagMs: number | null;
          rateKbps: number | null;
          suspended: boolean;
          finding: FindingWithAnalysis;
        }
      >(),
    };

    current.sampleCount += 1;
    current.latestFinding = finding;
    current.replicas.set(replica, {
      queueKb,
      lagMs,
      rateKbps,
      suspended,
      finding,
    });
    buckets.set(key, current);
  });

  const series: RedoPoint[] = [];
  const start = floorToBucketMs(from.getTime(), REDO_BUCKET_MS);
  const end = ceilToBucketMs(to.getTime(), REDO_BUCKET_MS);

  for (let cursor = start; cursor <= end; cursor += REDO_BUCKET_MS) {
    const bucket = buckets.get(String(cursor));
    const point: RedoPoint = {
      ts: formatBucketTimeLabel(cursor),
      bucketTs: cursor,
      sampleCount: bucket?.sampleCount ?? 0,
      replicas: {},
      latestFinding: bucket?.latestFinding ?? null,
    };

    bucket?.replicas.forEach((value, replica) => {
      const key = replicaKey(replica);
      point.replicas[replica] = {
        replica,
        queueKb: value.queueKb,
        lagMs: value.lagMs,
        rateKbps: value.rateKbps,
        suspended: value.suspended,
      };
      point[`queue__${key}`] = value.queueKb;
      point[`lag__${key}`] = value.lagMs;
      point[`rate__${key}`] = value.rateKbps;
    });

    series.push(point);
  }

  return series;
}

function aggregateRedoSeriesWithDisplayFrom(
  findings: FindingWithAnalysis[],
  from: Date,
  to: Date,
  displayFrom: Date,
): RedoPoint[] {
  const series = aggregateRedoSeries(findings, from, to);
  const displayStart = floorToBucketMs(displayFrom.getTime(), REDO_BUCKET_MS);
  return series.map((point, index) => ({
    ...point,
    ts: formatBucketTimeLabel(displayStart + index * REDO_BUCKET_MS),
  }));
}

function getReplicaNames(series: RedoPoint[]): string[] {
  const names = new Set<string>();
  series.forEach((point) => {
    Object.keys(point.replicas).forEach((replica) => names.add(replica));
  });
  return Array.from(names).sort();
}

function getLatestSnapshot(series: RedoPoint[]): RedoPoint | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (Object.keys(series[i].replicas).length > 0) return series[i];
  }
  return null;
}

function summarizeSnapshot(
  point: RedoPoint | null,
  replicas: string[],
  redoQueueThreshold: TopicThresholdConfig,
  redoLagThreshold: TopicThresholdConfig,
): RedoSnapshotSummary {
  let maxQueueKb = 0;
  let maxQueueReplica: string | null = null;
  let maxLagMs = 0;
  let maxLagReplica: string | null = null;
  let minRateKbps = Number.POSITIVE_INFINITY;
  let minRateReplica: string | null = null;
  let laggingReplicaCount = 0;

  replicas.forEach((replica) => {
    const metrics = point?.replicas[replica];
    if (!metrics) return;

    if ((metrics.queueKb ?? 0) >= maxQueueKb) {
      maxQueueKb = metrics.queueKb ?? 0;
      maxQueueReplica = replica;
    }

    if ((metrics.lagMs ?? 0) >= maxLagMs) {
      maxLagMs = metrics.lagMs ?? 0;
      maxLagReplica = replica;
    }

    if (metrics.rateKbps != null && metrics.rateKbps <= minRateKbps) {
      minRateKbps = metrics.rateKbps;
      minRateReplica = replica;
    }

    const queueWarn = redoQueueThreshold.warning != null && (metrics.queueKb ?? 0) >= redoQueueThreshold.warning;
    const lagWarn = redoLagThreshold.warning != null && (metrics.lagMs ?? 0) >= redoLagThreshold.warning;
    if (queueWarn || lagWarn || metrics.suspended) {
      laggingReplicaCount += 1;
    }
  });

  return {
    maxQueueKb,
    maxQueueReplica,
    maxLagMs,
    maxLagReplica,
    minRateKbps: Number.isFinite(minRateKbps) ? minRateKbps : 0,
    minRateReplica,
    laggingReplicaCount,
  };
}

function mergeCompareSeries(current: RedoPoint[], compare: RedoPoint[]): RedoPoint[] {
  return current.map((point, index) => {
    const comparePoint = compare[index];
    const merged: RedoPoint = { ...point };

    Object.keys(comparePoint?.replicas ?? {}).forEach((replica) => {
      const key = replicaKey(replica);
      merged[`queue_compare__${key}`] = comparePoint?.replicas[replica]?.queueKb ?? null;
      merged[`lag_compare__${key}`] = comparePoint?.replicas[replica]?.lagMs ?? null;
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
  unit: "KB" | "KB/s" | "mixed";
}) {
  if (!active || !payload?.length) return null;

  const entries = payload.filter((entry) => typeof entry.value === "number");

  if (unit === "mixed") {
    const grouped = new Map<
      string,
      {
        color: string;
        queue?: string;
        lag?: string;
      }
    >();

    entries.forEach((entry) => {
      const [replica = entry.name ?? "-", metricPart = ""] = String(entry.name ?? "").split(" • ");
      const current = grouped.get(replica) ?? {
        color: entry.color ?? "var(--color-text)",
      };

      if (metricPart.includes("Redo Lag")) {
        current.lag = formatMs(Number(entry.value ?? 0));
      } else {
        current.queue = `${formatNumber(Number(entry.value ?? 0))} KB`;
      }

      grouped.set(replica, current);
    });

    return (
      <div className="min-w-[220px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[0_12px_28px_var(--color-shadow-lg)]">
        <p className="mb-2 text-[11px] font-semibold text-[var(--color-muted)]">{label}</p>
        <div className="space-y-1">
          {Array.from(grouped.entries()).map(([replica, entry]) => (
            <div key={replica} className="flex items-center justify-between gap-4 text-[12px]">
              <span className="flex items-center gap-2" style={{ color: entry.color }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                {replica}
              </span>
              <span className="font-code tabular text-right" style={{ color: entry.color }}>
                {entry.queue ?? "-"}
                <span className="mx-1.5 opacity-45">/</span>
                {entry.lag ?? "-"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const sortedEntries = entries.sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));

  return (
    <div className="min-w-[180px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[0_12px_28px_var(--color-shadow-lg)]">
      <p className="mb-2 text-[11px] font-semibold text-[var(--color-muted)]">{label}</p>
      <div className="space-y-1">
        {sortedEntries.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-2" style={{ color: entry.color }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="font-code tabular" style={{ color: entry.color }}>
              {`${formatNumber(Number(entry.value ?? 0))} ${unit}`}
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
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.75 text-[10px] transition-colors",
        active
          ? "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-2)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] opacity-60",
      )}
    >
      <span className="inline-block h-0 w-4 border-t-2" style={{ borderColor: color }} />
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

function buildReplicaHint(replica: string | null, compareEnabled: boolean, current: number, previous: number, compareLabel: string): string {
  if (!compareEnabled) return replica ?? "-";
  return `${replica ?? "-"} • ${formatDeltaPercent(current, previous)} so với ${compareLabel}`;
}

export function AgRedoSecondaryPreview(): React.ReactElement {
  const { activeTopicId, selectedClusterId, filters, timeRange, comparePastEnabled } = useDashboardStore();
  const { from, to } = useTimeRange();
  const redoQueueThreshold = useTopicMetricThreshold("ag_redo_secondary", "redo_queue_size", {
    warning: 1000,
    critical: 5000,
  });
  const redoLagThreshold = useTopicMetricThreshold("ag_redo_secondary", "redo_lag_ms", {
    warning: 30_000,
    critical: 120_000,
  });
  const compareRange = useMemo(() => resolveCompareRange(timeRange, from, to), [timeRange, from, to]);

  const params: FindingsQuery = useMemo(
    () => buildFindingsQuery({ activeTopicId, selectedClusterId, filters, from, to }, 0, 1),
    [activeTopicId, selectedClusterId, filters, from, to],
  );
  const compareParams: FindingsQuery = useMemo(
    () => buildFindingsQuery({ activeTopicId, selectedClusterId, filters, from: compareRange.from, to: compareRange.to }, 0, 1),
    [activeTopicId, selectedClusterId, filters, compareRange.from, compareRange.to],
  );

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["ag-redo-preview-findings", params],
    queryFn: () => fetchAllRedoFindings(params),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
  const { data: compareData, isFetching: compareFetching } = useQuery({
    queryKey: ["ag-redo-preview-findings-compare", compareParams],
    queryFn: () => fetchAllRedoFindings(compareParams),
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

  const series = useMemo(() => aggregateRedoSeries(filteredItems, from, to), [filteredItems, from, to]);
  const compareSeries = useMemo(
    () => comparePastEnabled
      ? aggregateRedoSeriesWithDisplayFrom(filteredCompareItems, compareRange.from, compareRange.to, from)
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
  const currentSummary = useMemo(
    () => summarizeSnapshot(latestPoint, replicas, redoQueueThreshold, redoLagThreshold),
    [latestPoint, replicas, redoQueueThreshold, redoLagThreshold],
  );
  const compareSummary = useMemo(
    () => summarizeSnapshot(latestComparePoint, replicas, redoQueueThreshold, redoLagThreshold),
    [latestComparePoint, replicas, redoQueueThreshold, redoLagThreshold],
  );
  const sampleCount = data?.items.length ?? 0;
  const redoQueueTone = severityTone(currentSummary.maxQueueKb, redoQueueThreshold);
  const redoLagTone = severityTone(currentSummary.maxLagMs, redoLagThreshold);

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
        message="Không tải được biểu đồ AG redo"
        description={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!series.length || !latestPoint || !replicas.length) {
    return (
      <EmptyState
        title="Không có dữ liệu AG redo"
        description="Không tìm thấy findings `ag_redo_secondary` có metric redo trong khoảng thời gian đang chọn."
      />
    );
  }

  return (
    <div className="relative grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="redo_queue_size">Redo Queue cao nhất</GlossaryTip>}
          value={`${formatNumber(currentSummary.maxQueueKb)} KB`}
          hint={buildReplicaHint(
            currentSummary.maxQueueReplica,
            comparePastEnabled,
            currentSummary.maxQueueKb,
            compareSummary.maxQueueKb,
            compareRange.label,
          )}
          tone={redoQueueTone}
          accentColor={QUEUE_COLOR}
        />
        <KpiCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="secondary_lag_seconds">Redo Lag cao nhất</GlossaryTip>}
          value={formatMs(currentSummary.maxLagMs)}
          hint={buildReplicaHint(
            currentSummary.maxLagReplica,
            comparePastEnabled,
            currentSummary.maxLagMs,
            compareSummary.maxLagMs,
            compareRange.label,
          )}
          tone={redoLagTone}
          accentColor={LAG_COLOR}
        />
        <KpiCard
          icon={<Gauge className="h-3.5 w-3.5" />}
          label={<GlossaryTip glossaryKey="redo_rate">Redo Rate thấp nhất</GlossaryTip>}
          value={`${formatNumber(currentSummary.minRateKbps)} KB/s`}
          hint={buildReplicaHint(
            currentSummary.minRateReplica,
            comparePastEnabled,
            currentSummary.minRateKbps,
            compareSummary.minRateKbps,
            compareRange.label,
          )}
          tone="good"
          accentColor={RATE_COLOR}
        />
        <KpiCard
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Số mẫu"
          value={formatNumber(sampleCount)}
          hint={`${formatNumber(latestPoint.sampleCount)} dòng trong bucket mới nhất`}
          tone="good"
          accentColor={SAMPLE_COLOR}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <ChartFrame
          eyebrow="Theo replica"
          title={
            <>
              <GlossaryTip glossaryKey="redo_queue_size">Redo Queue</GlossaryTip>
              {" "}so với{" "}
              <GlossaryTip glossaryKey="secondary_lag_seconds">Redo Lag</GlossaryTip>
            </>
          }
        >
          <BaseMetricChart
            data={chartSeries}
            margin={{ top: 8, right: 10, left: 4, bottom: 0 }}
            tooltip={<MetricTooltip unit="mixed" />}
            yAxes={[
              {
                id: "queue",
                width: 56,
                tickFormatter: (value: number) =>
                  value >= 1000 ? `${Math.round(value / 1000)}k` : `${Math.round(value)}`,
              },
              {
                id: "lag",
                orientation: "right",
                width: 44,
                tickFormatter: (value: number) => formatMs(value),
              },
            ]}
            referenceLines={[
              ...(redoQueueThreshold.warning != null
                ? [{ yAxisId: "queue", y: redoQueueThreshold.warning, stroke: "var(--color-warning)" }]
                : []),
              ...(redoQueueThreshold.critical != null
                ? [{ yAxisId: "queue", y: redoQueueThreshold.critical, stroke: "var(--color-critical)" }]
                : []),
              ...(redoLagThreshold.critical != null
                ? [{ yAxisId: "lag", y: redoLagThreshold.critical, stroke: LAG_COLOR }]
                : []),
            ]}
            lines={replicas.flatMap((replica, index) => {
              const color = REPLICA_COLORS[index % REPLICA_COLORS.length];
              const key = replicaKey(replica);
              return [
                ...(comparePastEnabled
                  ? [{
                      yAxisId: "queue",
                      dataKey: `queue_compare__${key}`,
                      name: `${replica} • Redo Queue (${compareRange.label})`,
                      stroke: color,
                      strokeWidth: 1.4,
                      strokeOpacity: 0.28,
                      hide: !visibleReplicas.includes(replica),
                    }]
                  : []),
                {
                  yAxisId: "queue",
                  dataKey: `queue__${key}`,
                  name: `${replica} • Redo Queue`,
                  stroke: color,
                  hide: !visibleReplicas.includes(replica),
                },
                ...(comparePastEnabled
                  ? [{
                      yAxisId: "lag",
                      dataKey: `lag_compare__${key}`,
                      name: `${replica} • Redo Lag (${compareRange.label})`,
                      stroke: color,
                      strokeWidth: 1.4,
                      strokeOpacity: 0.28,
                      strokeDasharray: "6 6",
                      hide: !visibleReplicas.includes(replica),
                    }]
                  : []),
                {
                  yAxisId: "lag",
                  dataKey: `lag__${key}`,
                  name: `${replica} • Redo Lag`,
                  stroke: color,
                  strokeDasharray: "8 6",
                  hide: !visibleReplicas.includes(replica),
                },
              ];
            })}
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-[var(--color-border)] pt-2">
            {replicas.map((replica, index) => (
              <LegendItem
                key={replica}
                color={REPLICA_COLORS[index % REPLICA_COLORS.length]}
                label={replica}
                active={!hiddenReplicas.includes(replica)}
                onClick={() => toggleReplica(replica)}
              />
            ))}
            <LegendItem color="var(--color-text-2)" label="Redo Queue: nét liền" />
            <LegendItem color="var(--color-text-2)" label="Redo Lag: nét đứt" />
            {redoQueueThreshold.warning != null && (
              <LegendItem
                color="var(--color-warning)"
                label={`Ngưỡng queue ${formatNumber(redoQueueThreshold.warning)} KB`}
              />
            )}
            {redoLagThreshold.critical != null && (
              <LegendItem
                color={LAG_COLOR}
                label={`Ngưỡng lag ${formatMs(redoLagThreshold.critical)}`}
              />
            )}
          </div>
        </ChartFrame>

        <ChartFrame
          eyebrow="Theo replica"
          title={<GlossaryTip glossaryKey="redo_rate">Redo Rate</GlossaryTip>}
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
                ...(comparePastEnabled
                  ? [{
                      dataKey: `rate_compare__${key}`,
                      name: `${replica} (${compareRange.label})`,
                      stroke: color,
                      strokeWidth: 1.4,
                      strokeOpacity: 0.28,
                      hide: !visibleReplicas.includes(replica),
                    }]
                  : []),
                {
                  dataKey: `rate__${key}`,
                  name: replica,
                  stroke: color,
                  hide: !visibleReplicas.includes(replica),
                },
              ];
            })}
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-[var(--color-border)] pt-2">
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

      <RefreshingOverlay visible={(isFetching || compareFetching) && !!data} />
    </div>
  );
}
