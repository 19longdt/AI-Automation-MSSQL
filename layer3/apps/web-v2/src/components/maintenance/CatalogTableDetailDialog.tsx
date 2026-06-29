import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame, BaseMetricChart } from "@/components/dashboard/BaseMetricChart";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCatalogSnapshots,
  useCatalogTable,
  useCatalogTableEvents,
  useCatalogTableHistory,
} from "@/hooks/useMaintenance";
import { formatDetectedAt, formatMs, formatNumber, parseWallClockDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/store/dashboard.store";
import type { CatalogIndexEntry, CatalogMaintenanceEvent, CatalogTableHistoryPoint } from "@/types";

const REBUILD_THRESHOLD = 30;
const REORG_THRESHOLD = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function formatShortDate(value: string | null | undefined): string {
  const parsed = parseWallClockDate(value);
  if (!parsed) return "Unknown";
  return `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`;
}

function fragBarColor(value: number | null | undefined): string {
  if (value == null) return "var(--color-surface-3)";
  if (value >= REBUILD_THRESHOLD) return "var(--color-critical)";
  if (value >= REORG_THRESHOLD) return "var(--color-warning)";
  return "var(--color-success)";
}

function fragStatus(value: number | null | undefined): string {
  if (value == null) return "Unknown";
  if (value >= REBUILD_THRESHOLD) return "REBUILD";
  if (value >= REORG_THRESHOLD) return "REORG";
  return "OK";
}

function outcomeTone(outcome: string | null) {
  switch ((outcome || "").toUpperCase()) {
    case "DONE":
      return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
    case "FAILED":
    case "ABORTED":
      return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
    case "PAUSED":
    case "SKIPPED":
      return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
    default:
      return "bg-[var(--color-surface-2)] text-[var(--color-muted)]";
  }
}

function buildTrendData(points: CatalogTableHistoryPoint[]) {
  return points.map((point, index) => {
    const previous = index > 0 ? points[index - 1] : null;
    return {
      ts: formatShortDate(point.captured_at),
      captured_at: point.captured_at,
      row_count: point.row_count,
      row_count_delta: previous ? point.row_count - previous.row_count : null,
      previous_row_count: previous?.row_count ?? null,
      max_fragmentation_pct: point.max_fragmentation_pct,
      stale_stats_count: point.stale_stats_count,
    };
  });
}

function formatSignedNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function OverviewTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number | null; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="mt-1 flex items-center justify-between gap-4 text-[var(--color-muted)]">
          <span>{entry.name}</span>
          <span className="font-medium text-[var(--color-text)]">
            {entry.value == null ? "-" : entry.name.includes("Rows") ? formatNumber(entry.value) : `${Number(entry.value).toFixed(1)}${entry.name.includes("Frag") ? "%" : ""}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function RowCountDeltaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { row_count?: number | null; previous_row_count?: number | null }; value?: number | null; name: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  const current = point?.row_count ?? null;
  const previous = point?.previous_row_count ?? null;
  const delta = payload[0]?.value ?? null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-4 text-[var(--color-muted)]">
        <span>Change</span>
        <span className="font-medium text-[var(--color-text)]">{formatSignedNumber(delta)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-4 text-[var(--color-muted)]">
        <span>Current Rows</span>
        <span className="font-medium text-[var(--color-text)]">{formatNumber(current)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-4 text-[var(--color-muted)]">
        <span>Previous Rows</span>
        <span className="font-medium text-[var(--color-text)]">{formatNumber(previous)}</span>
      </div>
    </div>
  );
}

function IndexTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number | null }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{label ?? "Index"}</p>
      <p className="mt-1 text-[var(--color-muted)]">
        Fragmentation: <span className="font-medium text-[var(--color-text)]">{value == null ? "-" : `${Number(value).toFixed(1)}%`}</span>
      </p>
    </div>
  );
}

export function CatalogTableDetailDialog({
  database,
  schema,
  table,
  initialTab = "overview",
  onClose,
}: {
  database: string;
  schema: string;
  table: string;
  initialTab?: "overview" | "indexes" | "statistics" | "history";
  onClose: () => void;
}) {
  const { selectedClusterId } = useDashboardStore();
  const [tab, setTab] = useState(initialTab);
  const [selectedRunId, setSelectedRunId] = useState("");
  const { data: snapshots, isLoading: snapshotsLoading } = useCatalogSnapshots(database);
  const { data: detail, isLoading: detailLoading, error: detailError } = useCatalogTable(
    database,
    schema,
    table,
    selectedRunId || undefined,
  );
  const { data: historyPoints, isLoading: historyLoading, error: historyError } = useCatalogTableHistory(database, schema, table);
  const { data: events, isLoading: eventsLoading, error: eventsError } = useCatalogTableEvents(schema, table);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, database, schema, table]);

  useEffect(() => {
    const nextRunId = snapshots?.[0]?.run_id ?? "";
    if (!snapshots?.length) {
      if (selectedRunId) setSelectedRunId("");
      return;
    }
    if (!selectedRunId || !snapshots.some((snapshot) => snapshot.run_id === selectedRunId)) {
      setSelectedRunId(nextRunId);
    }
  }, [selectedRunId, snapshots]);

  const trendData = useMemo(() => buildTrendData(historyPoints ?? []), [historyPoints]);
  const indexRows = useMemo(() => {
    const indexes = detail?.indexes ?? [];
    return [...indexes].sort((a, b) => (b.fragmentation_pct ?? -1) - (a.fragmentation_pct ?? -1));
  }, [detail]);
  const indexChartData = useMemo(
    () =>
      indexRows.map((item, index) => ({
        name: item.index_name || `Index ${index + 1}`,
        fragmentation_pct: item.fragmentation_pct,
        tone: fragBarColor(item.fragmentation_pct),
      })),
    [indexRows],
  );

  const canSelectSnapshot = tab === "indexes" || tab === "statistics";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(94vw,1180px)] max-h-[90vh] bg-[var(--color-surface)]" hideClose>
        <DialogHeader className="items-start gap-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[18px]">
              {schema}.{table}
            </DialogTitle>
            <p className="mt-1 text-[12px] text-[var(--color-muted)]">
              {database} · {selectedClusterId ?? "No cluster"} {detail?.captured_at ? `· Snapshot ${formatDetectedAt(detail.captured_at)}` : ""}
            </p>
          </div>

          <div className="w-full max-w-[280px] shrink-0">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
              Snapshot
            </p>
            {snapshotsLoading ? (
              <Skeleton className="h-9 w-full rounded-xl" />
            ) : (
              <Select
                value={selectedRunId || undefined}
                onValueChange={setSelectedRunId}
                disabled={!canSelectSnapshot || !snapshots?.length}
              >
                <SelectTrigger className="h-9 w-full rounded-xl border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-left">
                  <SelectValue placeholder={canSelectSnapshot ? "Choose snapshot" : "Overview uses all snapshots"} />
                </SelectTrigger>
                <SelectContent>
                  {(snapshots ?? []).map((snapshot) => (
                    <SelectItem key={snapshot.run_id} value={snapshot.run_id}>
                      {formatShortDate(snapshot.captured_at)} · {formatNumber(snapshot.table_count)} tables
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-col gap-4 p-0">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as "overview" | "indexes" | "statistics" | "history")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="px-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="indexes">Indexes</TabsTrigger>
              <TabsTrigger value="statistics">Statistics</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
              {historyLoading ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <Skeleton className="h-[320px] rounded-xl" />
                  <Skeleton className="h-[320px] rounded-xl" />
                </div>
              ) : historyError ? (
                <ErrorState
                  message="Failed to load table trend"
                  description={historyError instanceof Error ? historyError.message : "Unknown error"}
                />
              ) : trendData.length < 2 ? (
                <EmptyState title="Not enough snapshots" description="Cần ít nhất 2 snapshot để hiển thị trend." />
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  <ChartFrame eyebrow="Trend" title="Fragmentation Over Time">
                    <BaseMetricChart
                      data={trendData}
                      lines={[{ dataKey: "max_fragmentation_pct", name: "Max Frag", stroke: "var(--color-primary)" }]}
                      yAxes={[{ width: 52, tickFormatter: (value) => `${value}%` }]}
                      referenceLines={[
                        { y: REBUILD_THRESHOLD, stroke: "var(--color-critical)" },
                        { y: REORG_THRESHOLD, stroke: "var(--color-warning)" },
                      ]}
                      tooltip={<OverviewTooltip />}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-muted)]">
                      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--color-critical)]" /> REBUILD ≥ 30%</span>
                      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--color-warning)]" /> REORG ≥ 5%</span>
                    </div>
                  </ChartFrame>

                  <ChartFrame eyebrow="Trend" title="Row Count Change Over Time">
                    <BaseMetricChart
                      data={trendData}
                      lines={[{ dataKey: "row_count_delta", name: "Row Delta", stroke: "var(--color-primary)" }]}
                      yAxes={[{ width: 72, tickFormatter: (value) => formatNumber(value) }]}
                      referenceLines={[{ y: 0, stroke: "var(--color-border)" }]}
                      tooltip={<RowCountDeltaTooltip />}
                    />
                  </ChartFrame>
                </div>
              )}
            </TabsContent>

            <TabsContent value="indexes" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
              {detailLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-[320px] rounded-xl" />
                  <Skeleton className="h-[220px] rounded-xl" />
                </div>
              ) : detailError ? (
                <ErrorState
                  message="Failed to load index detail"
                  description={detailError instanceof Error ? detailError.message : "Unknown error"}
                />
              ) : !detail?.indexes.length ? (
                <EmptyState title="No index data" description="This snapshot does not contain index information for the selected table." />
              ) : (
                <div className="space-y-4">
                  <ChartFrame eyebrow="Snapshot" title="Fragmentation By Index">
                    <div className="h-[340px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={indexChartData} layout="vertical" margin={{ top: 8, right: 24, left: 16, bottom: 8 }}>
                          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 4" horizontal={false} />
                          <XAxis type="number" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} />
                          <YAxis
                            dataKey="name"
                            type="category"
                            width={180}
                            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip content={<IndexTooltip />} cursor={false} />
                          <ReferenceLine x={REBUILD_THRESHOLD} stroke="var(--color-critical)" strokeDasharray="4 4" />
                          <ReferenceLine x={REORG_THRESHOLD} stroke="var(--color-warning)" strokeDasharray="4 4" />
                          <Bar dataKey="fragmentation_pct" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                            {indexChartData.map((entry) => (
                              <Cell key={entry.name} fill={entry.tone} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </ChartFrame>

                  <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[var(--color-surface-2)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Index</th>
                          <th className="px-3 py-2 text-left font-semibold">Type</th>
                          <th className="px-3 py-2 text-left font-semibold">Unique</th>
                          <th className="px-3 py-2 text-right font-semibold">Pages</th>
                          <th className="px-3 py-2 text-right font-semibold">Frag</th>
                          <th className="px-3 py-2 text-left font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {indexRows.map((item, index) => (
                          <tr key={`${item.index_id}-${index}`} className="border-t border-[var(--color-border)]">
                            <td className="px-3 py-2 font-medium text-[var(--color-text)]">{item.index_name ?? `Index ${index + 1}`}</td>
                            <td className="px-3 py-2 text-[var(--color-muted)]">{item.index_type}</td>
                            <td className="px-3 py-2 text-[var(--color-muted)]">{item.is_unique ? "Yes" : "No"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatNumber(item.page_count)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{item.fragmentation_pct != null ? `${item.fragmentation_pct.toFixed(1)}%` : "-"}</td>
                            <td className="px-3 py-2">
                              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", {
                                "bg-[var(--color-critical-soft)] text-[var(--color-critical)]": item.fragmentation_pct != null && item.fragmentation_pct >= REBUILD_THRESHOLD,
                                "bg-[var(--color-warning-soft)] text-[var(--color-warning)]": item.fragmentation_pct != null && item.fragmentation_pct >= REORG_THRESHOLD && item.fragmentation_pct < REBUILD_THRESHOLD,
                                "bg-[var(--color-success-soft)] text-[var(--color-success)]": item.fragmentation_pct != null && item.fragmentation_pct < REORG_THRESHOLD,
                                "bg-[var(--color-surface-2)] text-[var(--color-muted)]": item.fragmentation_pct == null,
                              })}>
                                {fragStatus(item.fragmentation_pct)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="statistics" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
              {detailLoading ? (
                <Skeleton className="h-[320px] rounded-xl" />
              ) : detailError ? (
                <ErrorState
                  message="Failed to load statistics"
                  description={detailError instanceof Error ? detailError.message : "Unknown error"}
                />
              ) : !detail?.statistics.length ? (
                <EmptyState title="No statistics data" description="This snapshot does not contain statistics information for the selected table." />
              ) : (
                <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[var(--color-surface-2)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Statistic</th>
                        <th className="px-3 py-2 text-left font-semibold">Last Updated</th>
                        <th className="px-3 py-2 text-right font-semibold">Rows</th>
                        <th className="px-3 py-2 text-right font-semibold">Sampled</th>
                        <th className="px-3 py-2 text-right font-semibold">Sample Rate</th>
                        <th className="px-3 py-2 text-right font-semibold">Modifications</th>
                        <th className="px-3 py-2 text-left font-semibold">Auto</th>
                        <th className="px-3 py-2 text-left font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.statistics.map((item) => {
                        const sampleRate = item.rows > 0 ? (item.rows_sampled / item.rows) * 100 : null;
                        const status =
                          item.modification_counter >= 20_000 ? { label: "High Mods", tone: "bg-[var(--color-critical-soft)] text-[var(--color-critical)]" }
                          : sampleRate != null && sampleRate < 5 ? { label: "Low Sample", tone: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]" }
                          : item.modification_counter > 0 ? { label: "Modified", tone: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" }
                          : { label: "OK", tone: "bg-[var(--color-success-soft)] text-[var(--color-success)]" };
                        return (
                          <tr key={item.stats_id} className="border-t border-[var(--color-border)]">
                            <td className="px-3 py-2 font-medium text-[var(--color-text)]">{item.stats_name}</td>
                            <td className="px-3 py-2 text-[var(--color-muted)]">{formatDetectedAt(item.last_updated)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatNumber(item.rows)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatNumber(item.rows_sampled)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{sampleRate != null ? `${sampleRate.toFixed(1)}%` : "-"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatNumber(item.modification_counter)}</td>
                            <td className="px-3 py-2 text-[var(--color-muted)]">{item.auto_created ? "Yes" : "No"}</td>
                            <td className="px-3 py-2">
                              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", status.tone)}>
                                {status.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
              {eventsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 rounded-xl" />
                  <Skeleton className="h-20 rounded-xl" />
                  <Skeleton className="h-20 rounded-xl" />
                </div>
              ) : eventsError ? (
                <ErrorState
                  message="Failed to load maintenance events"
                  description={eventsError instanceof Error ? eventsError.message : "Unknown error"}
                />
              ) : !events?.length ? (
                <EmptyState title="No maintenance history" description="This table has no maintenance events yet." />
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <article key={event.history_id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-primary)]">
                              {event.action_type}
                            </span>
                            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]", outcomeTone(event.outcome))}>
                              {event.outcome}
                            </span>
                          </div>
                          <p className="text-[13px] text-[var(--color-text)]">
                            {event.action_type === "UPDATE_STATISTICS"
                              ? event.stats_name ?? "Statistics"
                              : event.action_type === "HEAP_REBUILD"
                              ? "Heap"
                              : (event.index_name ?? "-")}
                            {event.action_type !== "UPDATE_STATISTICS" && event.action_type !== "HEAP_REBUILD" && (
                              <> · {event.frag_before_pct != null || event.frag_after_pct != null
                                ? `${event.frag_before_pct?.toFixed(1) ?? "-"}% → ${event.frag_after_pct?.toFixed(1) ?? "-"}%`
                                : "No fragmentation data"}</>
                            )}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-[12px] text-[var(--color-muted)]">
                          <p>{formatDetectedAt(event.started_at)}</p>
                          <p>{formatMs(event.duration_ms)}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
