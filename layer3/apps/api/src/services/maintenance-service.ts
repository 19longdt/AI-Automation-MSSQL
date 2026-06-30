import { Db, Document, ObjectId } from "mongodb";

const COLLECTIONS = {
  queue: "maintenance_queue",
  batches: "maintenance_batches",
  history: "maintenance_history",
  window: "maintenance_window",
  campaigns: "maintenance_campaigns",
  catalog: "maintenance_catalog",
  catalogConfig: "maintenance_catalog_config",
} as const;

const QUEUE_COUNT_KEYS = [
  "awaiting_approval",
  "approved",
  "running",
  "paused",
  "done",
  "failed",
] as const;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface MaintenanceQueueQuery {
  cluster_id?: string;
  campaign_id?: string;
  status?: string;
  action_type?: string;
  limit?: number;
  page?: number;
}

export interface MaintenanceHistoryQuery {
  cluster_id?: string;
  campaign_id?: string;
  outcome?: string;
  limit?: number;
  page?: number;
}

export interface MaintenanceSummaryQuery {
  cluster_id?: string;
}

export interface MaintenanceCampaignSummaryParams {
  campaignId: string;
}

export interface MaintenanceWindowConfigQuery {
  cluster_id?: string;
}

export interface MaintenanceWindowSlotConfig {
  start: string;
  end: string;
  time_budget_minutes: number;
}

export interface MaintenanceWindowConfigBody {
  cluster_id: string;
  enabled: boolean;
  kill_switch: boolean;
  default: MaintenanceWindowSlotConfig;
  day_overrides: Record<string, MaintenanceWindowSlotConfig | null>;
  gates: {
    cpu_max_pct: number | null;
    active_requests_max: number | null;
    log_send_queue_max_kb: number | null;
    redo_queue_max_kb: number | null;
  };
}

interface MaintenanceWindowDocument extends Document {
  _id?: ObjectId | string;
}

interface MaintenanceQueueDocument extends Document {
  _id?: ObjectId | string;
}

interface MaintenanceHistoryDocument extends Document {
  _id?: ObjectId | string;
}

interface MaintenanceBatchDocument extends Document {
  _id?: ObjectId | string;
}

interface MaintenanceCampaignDocument extends Document {
  _id?: ObjectId | string;
}

interface QueueCountBucket {
  _id: string | null;
  count?: number;
}

const QUEUE_STATUS_SORT_ORDER: Record<string, number> = {
  running: 0,
  paused: 1,
  approved: 2,
  awaiting_approval: 3,
  done: 4,
  failed: 5,
  skipped: 6,
  rejected: 7,
  expired: 8,
  superseded: 9,
};

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

function getDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function getDateString(value: unknown): string | null {
  const parsed = getDate(value);
  return parsed ? parsed.toISOString() : null;
}

function getObjectIdString(value: unknown): string | null {
  if (value instanceof ObjectId) return value.toHexString();
  return getString(value);
}

function normalizeStatusKey(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function toVnMinutes(date: Date): number {
  return Math.floor((date.getTime() + VN_OFFSET_MS) / 60000) % 1440;
}

function parseSlotTime(value: unknown): string | null {
  const raw = getString(value);
  if (!raw) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function slotTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function slotContains(startMin: number, endMin: number, currentMin: number): boolean {
  if (startMin === endMin) return true;
  if (startMin < endMin) return currentMin >= startMin && currentMin < endMin;
  return currentMin >= startMin || currentMin < endMin;
}

function pickFirstString(doc: Document, keys: string[]): string | null {
  for (const key of keys) {
    const value = getString(doc[key]);
    if (value) return value;
  }
  return null;
}

function pickFirstNumber(doc: Document, keys: string[]): number | null {
  for (const key of keys) {
    const value = getNumber(doc[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickFirstBoolean(doc: Document, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = getBoolean(doc[key]);
    if (value !== null) return value;
  }
  return null;
}

function getNestedDocument(value: unknown): Document | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Document) : null;
}

function resolveWindowSlot(doc: MaintenanceWindowDocument): { start: string; end: string; time_budget_minutes: number } {
  const slotDoc = getNestedDocument(doc.default) ?? getNestedDocument(doc.slot);
  const start = parseSlotTime(slotDoc?.start ?? doc.start ?? doc.start_time) ?? "02:30";
  const end = parseSlotTime(slotDoc?.end ?? doc.end ?? doc.end_time) ?? "05:00";
  const timeBudget = pickFirstNumber(slotDoc ?? {}, ["time_budget_minutes"])
    ?? pickFirstNumber(doc, ["time_budget_minutes", "budget_minutes", "time_budget"])
    ?? Math.max(0, slotTimeToMinutes(end) - slotTimeToMinutes(start));
  return {
    start,
    end,
    time_budget_minutes: timeBudget,
  };
}

function resolveWindowGates(doc: MaintenanceWindowDocument): Record<string, number | null> {
  const gatesDoc = getNestedDocument(doc.gates);
  const source = gatesDoc ?? doc;
  return {
    cpu_max_pct: pickFirstNumber(source, ["cpu_max_pct", "cpu_pct_max"]),
    active_requests_max: pickFirstNumber(source, ["active_requests_max", "max_active_requests"]),
    log_send_queue_max_kb: pickFirstNumber(source, ["log_send_queue_max_kb", "max_log_send_queue_kb", "ag_send_queue_kb_max"]),
    redo_queue_max_kb: pickFirstNumber(source, ["redo_queue_max_kb", "max_redo_queue_kb", "ag_redo_queue_kb_max"]),
  };
}

function mapWindowSlotConfig(value: unknown): MaintenanceWindowSlotConfig | null {
  const doc = getNestedDocument(value);
  if (!doc) return null;
  const start = parseSlotTime(doc.start);
  const end = parseSlotTime(doc.end);
  const timeBudget = getNumber(doc.time_budget_minutes);
  if (!start || !end || timeBudget == null) return null;
  return {
    start,
    end,
    time_budget_minutes: Math.round(timeBudget),
  };
}

function computeWindowReason(open: boolean, killSwitch: boolean, remainingMinutes: number): string {
  if (killSwitch) return "kill_switch";
  if (!open) return "closed";
  if (remainingMinutes <= 0) return "budget_exhausted";
  return "open";
}

async function computeBudgetUsedMinutes(db: Db, startedAt: Date, clusterId?: string): Promise<number> {
  const match: Record<string, unknown> = {
    started_at: { $gte: startedAt },
    outcome: { $in: ["done", "failed", "paused"] },
  };
  if (clusterId) match.cluster_id = clusterId;
  const result = await db.collection<MaintenanceHistoryDocument>(COLLECTIONS.history).aggregate<{ total?: number }>([
    { $match: match },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $divide: [
              {
                $convert: {
                  input: "$duration_ms",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
              60000,
            ],
          },
        },
      },
    },
  ]).toArray();
  return Number(result[0]?.total || 0);
}

function getWindowStartUtc(now: Date, startMinutes: number): Date {
  const vnEpochMs = now.getTime() + VN_OFFSET_MS;
  const currentVn = new Date(vnEpochMs);
  const midnightVn = Date.UTC(
    currentVn.getUTCFullYear(),
    currentVn.getUTCMonth(),
    currentVn.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  let startVnMs = midnightVn + startMinutes * 60000;
  if (startVnMs > vnEpochMs) {
    startVnMs -= 24 * 60 * 60000;
  }
  return new Date(startVnMs - VN_OFFSET_MS);
}

async function getWindowState(db: Db, clusterId?: string): Promise<Record<string, unknown> | null> {
  const doc = await db.collection<MaintenanceWindowDocument>(COLLECTIONS.window).findOne(
    clusterId ? { cluster_id: clusterId } : {},
  );
  if (!doc && clusterId) return null;
  const slot = resolveWindowSlot(doc ?? {});
  const startMinutes = slotTimeToMinutes(slot.start);
  const endMinutes = slotTimeToMinutes(slot.end);
  const now = new Date();
  const currentVnMinutes = toVnMinutes(now);
  const inWindow = slotContains(startMinutes, endMinutes, currentVnMinutes);
  const enabled = pickFirstBoolean(doc ?? {}, ["enabled"]) ?? true;
  const killSwitch = pickFirstBoolean(doc ?? {}, ["kill_switch", "killSwitch"]) ?? false;
  const windowStartUtc = getWindowStartUtc(now, startMinutes);
  const budgetUsed = await computeBudgetUsedMinutes(db, windowStartUtc, clusterId);
  const remainingMinutes = Math.max(0, slot.time_budget_minutes - budgetUsed);
  const open = enabled && inWindow && !killSwitch && remainingMinutes > 0;
  return {
    open,
    remaining_minutes: Number(remainingMinutes.toFixed(1)),
    reason: computeWindowReason(open, killSwitch, remainingMinutes),
    slot,
    budget_used_minutes: Number(budgetUsed.toFixed(1)),
    enabled,
    kill_switch: killSwitch,
    gates: resolveWindowGates(doc ?? {}),
  };
}

async function getQueueCounts(db: Db, clusterId?: string): Promise<Record<string, number>> {
  return getQueueCountsByFilter(db, clusterId ? { cluster_id: clusterId } : {});
}

async function getQueueCountsByFilter(db: Db, filter: Record<string, unknown>): Promise<Record<string, number>> {
  const counts = Object.fromEntries(QUEUE_COUNT_KEYS.map((key) => [key, 0])) as Record<string, number>;
  const pipeline: Document[] = [];
  if (Object.keys(filter).length > 0) pipeline.push({ $match: filter });
  pipeline.push({
    $group: {
      _id: {
        $toLower: {
          $replaceAll: {
            input: {
              $replaceAll: {
                input: { $convert: { input: "$status", to: "string", onError: "", onNull: "" } },
                find: "-",
                replacement: "_",
              },
            },
            find: " ",
            replacement: "_",
          },
        },
      },
      count: { $sum: 1 },
    },
  });
  const results = await db.collection<MaintenanceQueueDocument>(COLLECTIONS.queue).aggregate<QueueCountBucket>(pipeline).toArray();
  for (const row of results) {
    const key = normalizeStatusKey(row._id);
    if (key in counts) counts[key] = Number(row.count || 0);
  }
  return counts;
}

async function getCatalogStatus(db: Db, clusterId?: string): Promise<Record<string, unknown> | null> {
  if (!clusterId) return null;
  const [configDoc, aggregate] = await Promise.all([
    db.collection(COLLECTIONS.catalogConfig).findOne({ cluster_id: clusterId }),
    db.collection(COLLECTIONS.catalog).aggregate([
      { $match: { cluster_id: clusterId } },
      {
        $group: {
          _id: "$cluster_id",
          last_run_at: { $max: "$captured_at" },
          table_count: { $sum: 1 },
        },
      },
    ]).toArray(),
  ]);
  const lastRunAt = aggregate[0]?.last_run_at instanceof Date ? aggregate[0].last_run_at : null;
  const ageHours = lastRunAt ? (Date.now() - lastRunAt.getTime()) / 3600000 : null;
  return {
    has_config: Boolean(configDoc),
    last_run_at: getDateString(lastRunAt),
    table_count: Number(aggregate[0]?.table_count || 0),
    age_hours: ageHours != null ? Number(ageHours.toFixed(1)) : null,
    is_stale: ageHours != null ? ageHours > 25 : false,
  };
}

function mapBatchSummary(doc: MaintenanceBatchDocument | null): Record<string, unknown> | null {
  if (!doc) return null;
  const batchId = pickFirstString(doc, ["batch_id"]) ?? getObjectIdString(doc._id);
  const summaryDoc = getNestedDocument(doc.summary) ?? {};
  return {
    batch_id: batchId,
    status: pickFirstString(doc, ["status"]),
    decision: pickFirstString(doc, ["decision"]),
    item_count: pickFirstNumber(doc, ["item_count", "records_processed", "items_count"]),
    decided_at: getDateString(doc.decided_at ?? doc.updated_at ?? doc.created_at),
    summary: {
      reorganize: pickFirstNumber(summaryDoc, ["reorganize"]),
      rebuild: pickFirstNumber(summaryDoc, ["rebuild"]),
      update_statistics: pickFirstNumber(summaryDoc, ["update_statistics"]),
      est_total_minutes: pickFirstNumber(summaryDoc, ["est_total_minutes", "estimated_total_minutes"]),
    },
  };
}

function mapLastScanJob(doc: MaintenanceBatchDocument | null): Record<string, unknown> | null {
  if (!doc) return null;
  const ranAt = getDateString(doc.scan_ran_at ?? doc.ran_at ?? doc.scanned_at ?? doc.created_at);
  const status = pickFirstString(doc, ["scan_status", "status"]);
  const recordsProcessed = pickFirstNumber(doc, ["records_processed", "item_count", "items_count"]);
  if (!ranAt && !status && recordsProcessed === null) return null;
  return { ran_at: ranAt, status, records_processed: recordsProcessed };
}

async function getLatestCampaignBatchDoc(
  db: Db,
  clusterId: string | undefined,
  campaignId: string,
): Promise<MaintenanceBatchDocument | null> {
  const queueFilter: Record<string, unknown> = { campaign_id: campaignId };
  if (clusterId) queueFilter.cluster_id = clusterId;

  const latestQueueDoc = await db.collection<MaintenanceQueueDocument>(COLLECTIONS.queue)
    .find(queueFilter)
    .sort({ created_at: -1, _id: -1 })
    .limit(1)
    .next();

  const batchId = pickFirstString(latestQueueDoc ?? {}, ["batch_id"]);
  if (!batchId) return null;

  const batchFilter: Record<string, unknown> = { batch_id: batchId };
  if (clusterId) batchFilter.cluster_id = clusterId;

  return db.collection<MaintenanceBatchDocument>(COLLECTIONS.batches).findOne(batchFilter);
}

function getNestedStringsMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalized = getString(raw);
    if (normalized) out[key] = normalized;
  }
  return out;
}

async function getCampaignCatalogStatus(
  db: Db,
  campaign: MaintenanceCampaignDocument,
): Promise<Record<string, unknown>> {
  const clusterId = pickFirstString(campaign, ["cluster_id"]);
  const discoveredRunIds = getNestedStringsMap(campaign.discovered_run_ids);
  const scope = Array.isArray(campaign.scope) ? campaign.scope : [];
  const schemasCount = scope.reduce((count, dbScope) => {
    const schemas = Array.isArray((dbScope as Document).schemas) ? ((dbScope as Document).schemas as unknown[]) : [];
    return count + schemas.length;
  }, 0);

  if (!clusterId || Object.keys(discoveredRunIds).length === 0) {
    return {
      has_snapshot: false,
      last_run_at: null,
      table_count: 0,
      database_count: Object.keys(discoveredRunIds).length,
      schema_count: schemasCount,
    };
  }

  const matchBranches = Object.entries(discoveredRunIds).map(([databaseName, runId]) => ({
    cluster_id: clusterId,
    database_name: databaseName,
    run_id: runId,
  }));
  const aggregate = await db.collection(COLLECTIONS.catalog).aggregate([
    { $match: { $or: matchBranches } },
    {
      $group: {
        _id: null,
        last_run_at: { $max: "$captured_at" },
        table_count: { $sum: 1 },
      },
    },
  ]).toArray();
  const lastRunAt = aggregate[0]?.last_run_at instanceof Date ? aggregate[0].last_run_at : null;
  return {
    has_snapshot: Boolean(lastRunAt),
    last_run_at: getDateString(lastRunAt),
    table_count: Number(aggregate[0]?.table_count || 0),
    database_count: Object.keys(discoveredRunIds).length,
    schema_count: schemasCount,
  };
}

function mapCampaignSummary(
  campaign: MaintenanceCampaignDocument,
  lastBatch: MaintenanceBatchDocument | null,
  queueCounts: Record<string, number>,
  catalog: Record<string, unknown>,
): Record<string, unknown> {
  const totalItems = pickFirstNumber(campaign, ["total_items"]) ?? 0;
  const doneCount = pickFirstNumber(campaign, ["done_count"]) ?? 0;
  const failedCount = pickFirstNumber(campaign, ["failed_count"]) ?? 0;
  const skippedCount = pickFirstNumber(campaign, ["skipped_count"]) ?? 0;
  const processed = doneCount + failedCount + skippedCount;
  const remainingItems = Math.max(0, totalItems - processed);

  return {
    campaign_id: pickFirstString(campaign, ["campaign_id"]),
    cluster_id: pickFirstString(campaign, ["cluster_id"]),
    name: pickFirstString(campaign, ["name"]),
    status: pickFirstString(campaign, ["status"]),
    discovery_error: pickFirstString(campaign, ["discovery_error"]),
    discovery_finished_at: getDateString(campaign.discovery_finished_at),
    last_scan_triggered_at: getDateString(campaign.last_scan_triggered_at),
    catalog,
    approval: {
      batch_id: pickFirstString(lastBatch ?? {}, ["batch_id"]),
      status: pickFirstString(lastBatch ?? {}, ["status"]),
      decision: pickFirstString(lastBatch ?? {}, ["decision"]),
      item_count: pickFirstNumber(lastBatch ?? {}, ["item_count"]) ?? totalItems,
      decided_at: getDateString(lastBatch?.decided_at ?? lastBatch?.updated_at ?? lastBatch?.created_at),
      awaiting_count: queueCounts.awaiting_approval ?? 0,
    },
    queue: {
      awaiting_approval: queueCounts.awaiting_approval ?? 0,
      approved: queueCounts.approved ?? 0,
      running: queueCounts.running ?? 0,
      paused: queueCounts.paused ?? 0,
    },
    results: {
      total_items: totalItems,
      done: doneCount,
      failed: failedCount,
      skipped: skippedCount,
      remaining: remainingItems,
      progress_pct: totalItems > 0 ? Math.min(100, Math.round((processed / totalItems) * 100)) : 0,
    },
  };
}

export async function getMaintenanceSummary(db: Db, query: MaintenanceSummaryQuery = {}): Promise<Record<string, unknown>> {
  const clusterId = getString(query.cluster_id) ?? undefined;
  const batchFilter = clusterId ? { cluster_id: clusterId } : {};
  const [window, queueCounts, lastBatchDoc, catalog] = await Promise.all([
    getWindowState(db, clusterId),
    getQueueCounts(db, clusterId),
    db.collection<MaintenanceBatchDocument>(COLLECTIONS.batches)
      .find(batchFilter)
      .sort({ decided_at: -1, updated_at: -1, created_at: -1, _id: -1 })
      .limit(1)
      .next(),
    getCatalogStatus(db, clusterId),
  ]);
  return {
    window,
    queue_counts: queueCounts,
    last_batch: mapBatchSummary(lastBatchDoc),
    last_scan_job: mapLastScanJob(lastBatchDoc),
    catalog,
  };
}

export async function getCampaignSummary(
  db: Db,
  params: MaintenanceCampaignSummaryParams,
): Promise<Record<string, unknown> | null> {
  const campaignId = getString(params.campaignId);
  if (!campaignId) return null;

  const campaign = await db.collection<MaintenanceCampaignDocument>(COLLECTIONS.campaigns).findOne({ campaign_id: campaignId });
  if (!campaign) return null;

  const clusterId = pickFirstString(campaign, ["cluster_id"]) ?? undefined;
  const queueFilter: Record<string, unknown> = { campaign_id: campaignId };
  if (clusterId) queueFilter.cluster_id = clusterId;
  const [lastBatchDoc, queueCounts, catalog] = await Promise.all([
    getLatestCampaignBatchDoc(db, clusterId, campaignId),
    getQueueCountsByFilter(db, queueFilter),
    getCampaignCatalogStatus(db, campaign),
  ]);

  return mapCampaignSummary(campaign, lastBatchDoc, queueCounts, catalog);
}

export async function getWindowConfig(
  db: Db,
  clusterId: string,
): Promise<Record<string, unknown> | null> {
  const normalizedClusterId = getString(clusterId);
  if (!normalizedClusterId) return null;
  const doc = await db.collection<MaintenanceWindowDocument>(COLLECTIONS.window).findOne({
    cluster_id: normalizedClusterId,
  });
  if (!doc) return null;

  const dayOverridesDoc = getNestedDocument(doc.day_overrides) ?? {};
  const dayOverrides: Record<string, MaintenanceWindowSlotConfig | null> = {};
  for (let day = 0; day <= 6; day += 1) {
    const key = String(day);
    dayOverrides[key] = mapWindowSlotConfig(dayOverridesDoc[key]);
  }

  const defaultSlot = mapWindowSlotConfig(doc.default) ?? resolveWindowSlot(doc);
  const healthMonitorDoc = getNestedDocument(doc.health_monitor);

  return {
    cluster_id: pickFirstString(doc, ["cluster_id"]) ?? normalizedClusterId,
    enabled: pickFirstBoolean(doc, ["enabled"]) ?? true,
    kill_switch: pickFirstBoolean(doc, ["kill_switch", "killSwitch"]) ?? false,
    default: defaultSlot,
    day_overrides: dayOverrides,
    gates: resolveWindowGates(doc),
    health_monitor: {
      enabled: pickFirstBoolean(healthMonitorDoc ?? {}, ["enabled"]) ?? true,
      interval_sec: pickFirstNumber(healthMonitorDoc ?? {}, ["interval_sec"]) ?? 30,
      cpu_max_pct: pickFirstNumber(healthMonitorDoc ?? {}, ["cpu_max_pct"]) ?? 80,
      active_requests_max: pickFirstNumber(healthMonitorDoc ?? {}, ["active_requests_max"]) ?? 60,
      log_send_queue_max_kb: pickFirstNumber(healthMonitorDoc ?? {}, ["log_send_queue_max_kb"]),
      redo_queue_max_kb: pickFirstNumber(healthMonitorDoc ?? {}, ["redo_queue_max_kb"]),
      auto_resume: pickFirstBoolean(healthMonitorDoc ?? {}, ["auto_resume"]) ?? true,
    },
  };
}

export async function upsertWindowConfig(db: Db, body: MaintenanceWindowConfigBody): Promise<void> {
  const clusterId = getString(body.cluster_id);
  if (!clusterId) {
    throw new Error("cluster_id is required");
  }

  const existing = await db.collection<MaintenanceWindowDocument>(COLLECTIONS.window).findOne({
    cluster_id: clusterId,
  });
  const existingHealthMonitor = getNestedDocument(existing?.health_monitor);
  const dayOverrides = Object.fromEntries(
    Object.entries(body.day_overrides ?? {})
      .filter(([key]) => /^[0-6]$/.test(key))
      .map(([key, value]) => [key, value]),
  );

  await db.collection<MaintenanceWindowDocument>(COLLECTIONS.window).replaceOne(
    { cluster_id: clusterId },
    {
      window_id: pickFirstString(existing ?? {}, ["window_id"]) ?? clusterId,
      cluster_id: clusterId,
      enabled: Boolean(body.enabled),
      default: body.default,
      day_overrides: dayOverrides,
      kill_switch: Boolean(body.kill_switch),
      gates: body.gates,
      health_monitor: {
        enabled: pickFirstBoolean(existingHealthMonitor ?? {}, ["enabled"]) ?? true,
        interval_sec: pickFirstNumber(existingHealthMonitor ?? {}, ["interval_sec"]) ?? 30,
        cpu_max_pct: pickFirstNumber(existingHealthMonitor ?? {}, ["cpu_max_pct"]) ?? 80,
        active_requests_max: pickFirstNumber(existingHealthMonitor ?? {}, ["active_requests_max"]) ?? 60,
        log_send_queue_max_kb: pickFirstNumber(existingHealthMonitor ?? {}, ["log_send_queue_max_kb"]),
        redo_queue_max_kb: pickFirstNumber(existingHealthMonitor ?? {}, ["redo_queue_max_kb"]),
        auto_resume: pickFirstBoolean(existingHealthMonitor ?? {}, ["auto_resume"]) ?? true,
      },
      updated_at: new Date(),
    },
    { upsert: true },
  );
}

export async function setWindowEnabled(db: Db, clusterId: string, value: boolean): Promise<void> {
  const normalizedClusterId = (clusterId ?? "").trim();
  if (!normalizedClusterId) throw new Error("cluster_id is required");
  const result = await db.collection<MaintenanceWindowDocument>(COLLECTIONS.window).updateOne(
    { cluster_id: normalizedClusterId },
    { $set: { enabled: value, updated_at: new Date() } },
  );
  if (result.matchedCount === 0) throw new Error("maintenance_window not found for this cluster");
}

export async function setKillSwitch(db: Db, clusterId: string, value: boolean): Promise<void> {
  const normalizedClusterId = (clusterId ?? "").trim();
  if (!normalizedClusterId) throw new Error("cluster_id is required");
  const result = await db.collection<MaintenanceWindowDocument>(COLLECTIONS.window).updateOne(
    { cluster_id: normalizedClusterId },
    { $set: { kill_switch: value, updated_at: new Date() } },
  );
  if (result.matchedCount === 0) throw new Error("maintenance_window not found for this cluster");
}

function normalizePage(limit?: number, page?: number): { limit: number; page: number } {
  return {
    limit: Math.min(Math.max(Number(limit || 50), 1), 200),
    page: Math.max(Number(page || 0), 0),
  };
}

function buildQueueFilter(query: MaintenanceQueueQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.cluster_id) filter.cluster_id = query.cluster_id;
  if (query.campaign_id) filter.campaign_id = query.campaign_id;
  if (query.status) filter.status = query.status.toLowerCase();
  if (query.action_type) filter.action_type = query.action_type;
  return filter;
}

function buildHistoryFilter(query: MaintenanceHistoryQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.cluster_id) filter.cluster_id = query.cluster_id;
  if (query.campaign_id) filter.campaign_id = query.campaign_id;
  if (query.outcome) filter.outcome = query.outcome;
  return filter;
}

export function mapQueueItem(doc: MaintenanceQueueDocument): Record<string, unknown> {
  const itemId = pickFirstString(doc, ["item_id"]) ?? getObjectIdString(doc._id);
  const shortId = itemId ? itemId.slice(0, 8) : null;
  return {
    item_id: itemId,
    short_id: shortId,
    cluster_id: pickFirstString(doc, ["cluster_id"]),
    campaign_id: pickFirstString(doc, ["campaign_id"]),
    table_name: pickFirstString(doc, ["table_name", "table"]),
    schema_name: pickFirstString(doc, ["schema_name", "schema"]),
    index_name: pickFirstString(doc, ["index_name", "index"]),
    stats_name: pickFirstString(doc, ["stats_name"]),
    action_type: pickFirstString(doc, ["action_type"]),
    kind: pickFirstString(doc, ["kind"]),
    fragmentation_pct: pickFirstNumber(doc, ["fragmentation_pct", "frag_pct"]),
    page_count: pickFirstNumber(doc, ["page_count", "pages"]),
    estimated_minutes: pickFirstNumber(doc, ["estimated_minutes", "est_minutes"]),
    priority: pickFirstNumber(doc, ["priority"]),
    status: pickFirstString(doc, ["status"]),
    attempts: pickFirstNumber(doc, ["attempts"]) ?? 0,
    last_error: pickFirstString(doc, ["last_error", "error"]),
    resume_token: Boolean(doc.resume_token),
    created_at: getDateString(doc.created_at),
    updated_at: getDateString(doc.updated_at),
    terminal_at: getDateString(doc.terminal_at),
  };
}

function mapHistoryItem(doc: MaintenanceHistoryDocument): Record<string, unknown> {
  const historyId = pickFirstString(doc, ["history_id"]) ?? getObjectIdString(doc._id);
  return {
    history_id: historyId,
    cluster_id: pickFirstString(doc, ["cluster_id"]),
    campaign_id: pickFirstString(doc, ["campaign_id"]),
    table_name: pickFirstString(doc, ["table_name", "table"]),
    schema_name: pickFirstString(doc, ["schema_name", "schema"]),
    index_name: pickFirstString(doc, ["index_name", "index"]),
    stats_name: pickFirstString(doc, ["stats_name"]),
    action_type: pickFirstString(doc, ["action_type"]),
    outcome: pickFirstString(doc, ["outcome"]),
    previous_status: pickFirstString(doc, ["previous_status"]),
    final_status: pickFirstString(doc, ["final_status"]),
    attempt_no: pickFirstNumber(doc, ["attempt_no"]) ?? 0,
    frag_before_pct: pickFirstNumber(doc, ["frag_before_pct", "fragmentation_before_pct"]),
    frag_after_pct: pickFirstNumber(doc, ["frag_after_pct", "fragmentation_after_pct"]),
    duration_ms: pickFirstNumber(doc, ["duration_ms"]),
    skip_reason: pickFirstString(doc, ["skip_reason"]),
    error: pickFirstString(doc, ["error", "last_error"]),
    statement: getString(doc.statement),
    started_at: getDateString(doc.started_at),
    finished_at: getDateString(doc.finished_at),
  };
}

export async function listMaintenanceQueue(
  db: Db,
  query: MaintenanceQueueQuery,
): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const { limit, page } = normalizePage(query.limit, query.page);
  const filter = buildQueueFilter(query);
  const coll = db.collection<MaintenanceQueueDocument>(COLLECTIONS.queue);
  const statusRankBranches = Object.entries(QUEUE_STATUS_SORT_ORDER).map(([status, rank]) => ({
    case: { $eq: [{ $toLower: { $convert: { input: "$status", to: "string", onError: "", onNull: "" } } }, status] },
    then: rank,
  }));
  const [total, items] = await Promise.all([
    coll.countDocuments(filter),
    coll.aggregate<MaintenanceQueueDocument>([
      { $match: filter },
      {
        $addFields: {
          _status_rank: {
            $switch: {
              branches: statusRankBranches,
              default: 99,
            },
          },
        },
      },
      { $sort: { _status_rank: 1, priority: -1, created_at: 1, _id: 1 } },
      { $skip: page * limit },
      { $limit: limit },
      { $project: { _status_rank: 0 } },
    ]).toArray(),
  ]);
  return { total, items: items.map(mapQueueItem) };
}

export async function listMaintenanceHistory(
  db: Db,
  query: MaintenanceHistoryQuery,
): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const { limit, page } = normalizePage(query.limit, query.page);
  const filter = buildHistoryFilter(query);
  const coll = db.collection<MaintenanceHistoryDocument>(COLLECTIONS.history);
  const [total, items] = await Promise.all([
    coll.countDocuments(filter),
    coll.find(filter).sort({ finished_at: -1, started_at: -1, _id: -1 }).skip(page * limit).limit(limit).toArray(),
  ]);
  return { total, items: items.map(mapHistoryItem) };
}

export async function callRunnerTickCheck(
  runnerUrl: string,
  clusterId: string,
): Promise<Record<string, unknown>> {
  const url = `${runnerUrl}/tick-check?cluster_id=${encodeURIComponent(clusterId)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(35_000) });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(body.error ?? `Runner returned ${res.status}`));
  }
  return body;
}
