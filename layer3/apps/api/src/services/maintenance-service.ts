import { Db, Document, ObjectId } from "mongodb";

const COLLECTIONS = {
  queue: "maintenance_queue",
  batches: "maintenance_batches",
  history: "maintenance_history",
  window: "maintenance_window"
} as const;

const QUEUE_COUNT_KEYS = [
  "awaiting_approval",
  "approved",
  "running",
  "paused",
  "done",
  "failed"
] as const;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface MaintenanceQueueQuery {
  cluster_id?: string;
  status?: string;
  action_type?: string;
  limit?: number;
  page?: number;
}

export interface MaintenanceHistoryQuery {
  cluster_id?: string;
  outcome?: string;
  limit?: number;
  page?: number;
}

export interface MaintenanceSummaryQuery {
  cluster_id?: string;
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

interface QueueCountBucket {
  _id: string | null;
  count?: number;
}

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
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
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

function pickFirstDate(doc: Document, keys: string[]): Date | null {
  for (const key of keys) {
    const value = getDate(doc[key]);
    if (value) return value;
  }
  return null;
}

function getNestedDocument(value: unknown): Document | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Document : null;
}

function resolveWindowSlot(doc: MaintenanceWindowDocument): { start: string; end: string; time_budget_minutes: number } {
  const slotDoc = getNestedDocument(doc.slot);
  const start = parseSlotTime(slotDoc?.start ?? doc.start ?? doc.start_time) ?? "01:00";
  const end = parseSlotTime(slotDoc?.end ?? doc.end ?? doc.end_time) ?? "04:00";
  const timeBudget = pickFirstNumber(slotDoc ?? {}, ["time_budget_minutes"])
    ?? pickFirstNumber(doc, ["time_budget_minutes", "budget_minutes", "time_budget"])
    ?? Math.max(0, slotTimeToMinutes(end) - slotTimeToMinutes(start));
  return {
    start,
    end,
    time_budget_minutes: timeBudget
  };
}

function resolveWindowGates(doc: MaintenanceWindowDocument): Record<string, number | null> {
  const gatesDoc = getNestedDocument(doc.gates);
  const source = gatesDoc ?? doc;
  return {
    cpu_max_pct: pickFirstNumber(source, ["cpu_max_pct", "cpu_pct_max"]),
    max_active_requests: pickFirstNumber(source, ["max_active_requests", "active_requests_max"]),
    max_log_send_queue_kb: pickFirstNumber(source, ["max_log_send_queue_kb", "ag_send_queue_kb_max"]),
    max_redo_queue_kb: pickFirstNumber(source, ["max_redo_queue_kb", "ag_redo_queue_kb_max"])
  };
}

function computeWindowReason(open: boolean, killSwitch: boolean, remainingMinutes: number): string {
  if (killSwitch) return "kill_switch";
  if (!open) return "closed";
  if (remainingMinutes <= 0) return "budget_exhausted";
  return "open";
}

async function computeBudgetUsedMinutes(
  db: Db,
  startedAt: Date,
  clusterId?: string
): Promise<number> {
  const match: Record<string, unknown> = {
    started_at: { $gte: startedAt },
    outcome: { $in: ["DONE", "FAILED", "PAUSED"] }
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
                  onNull: 0
                }
              },
              60000
            ]
          }
        }
      }
    }
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
    0
  );
  let startVnMs = midnightVn + startMinutes * 60000;
  if (startVnMs > vnEpochMs) {
    startVnMs -= 24 * 60 * 60000;
  }
  return new Date(startVnMs - VN_OFFSET_MS);
}

async function getWindowState(db: Db, clusterId?: string): Promise<Record<string, unknown> | null> {
  const doc = await db.collection<MaintenanceWindowDocument>(COLLECTIONS.window).findOne(
    clusterId ? { cluster_id: clusterId } : {}
  );
  if (!doc && clusterId) return null;
  const slot = resolveWindowSlot(doc ?? {});
  const startMinutes = slotTimeToMinutes(slot.start);
  const endMinutes = slotTimeToMinutes(slot.end);
  const now = new Date();
  const currentVnMinutes = toVnMinutes(now);
  const inWindow = slotContains(startMinutes, endMinutes, currentVnMinutes);
  const killSwitch = pickFirstBoolean(doc ?? {}, ["kill_switch", "killSwitch"]) ?? false;
  const windowStartUtc = getWindowStartUtc(now, startMinutes);
  const budgetUsed = await computeBudgetUsedMinutes(db, windowStartUtc, clusterId);
  const remainingMinutes = Math.max(0, slot.time_budget_minutes - budgetUsed);
  const open = inWindow && !killSwitch && remainingMinutes > 0;

  return {
    open,
    remaining_minutes: Number(remainingMinutes.toFixed(1)),
    reason: computeWindowReason(open, killSwitch, remainingMinutes),
    slot,
    budget_used_minutes: Number(budgetUsed.toFixed(1)),
    kill_switch: killSwitch,
    gates: resolveWindowGates(doc ?? {})
  };
}

async function getQueueCounts(db: Db, clusterId?: string): Promise<Record<string, number>> {
  const counts = Object.fromEntries(QUEUE_COUNT_KEYS.map((key) => [key, 0])) as Record<string, number>;
  const pipeline: Document[] = [];
  if (clusterId) pipeline.push({ $match: { cluster_id: clusterId } });
  pipeline.push({
    $group: {
      _id: {
        $toLower: {
          $replaceAll: {
            input: {
              $replaceAll: {
                input: {
                  $convert: { input: "$status", to: "string", onError: "", onNull: "" }
                },
                find: "-",
                replacement: "_"
              }
            },
            find: " ",
            replacement: "_"
          }
        }
      },
      count: { $sum: 1 }
    }
  });
  const results = await db.collection<MaintenanceQueueDocument>(COLLECTIONS.queue).aggregate<QueueCountBucket>(pipeline).toArray();

  for (const row of results) {
    const key = normalizeStatusKey(row._id);
    if (key in counts) counts[key] = Number(row.count || 0);
  }
  return counts;
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
      est_total_minutes: pickFirstNumber(summaryDoc, ["est_total_minutes", "estimated_total_minutes"])
    }
  };
}

function mapLastScanJob(doc: MaintenanceBatchDocument | null): Record<string, unknown> | null {
  if (!doc) return null;
  const ranAt = getDateString(doc.scan_ran_at ?? doc.ran_at ?? doc.scanned_at ?? doc.created_at);
  const status = pickFirstString(doc, ["scan_status", "status"]);
  const recordsProcessed = pickFirstNumber(doc, ["records_processed", "item_count", "items_count"]);

  if (!ranAt && !status && recordsProcessed === null) return null;
  return {
    ran_at: ranAt,
    status,
    records_processed: recordsProcessed
  };
}

export async function getMaintenanceSummary(db: Db, query: MaintenanceSummaryQuery = {}): Promise<Record<string, unknown>> {
  const clusterId = getString(query.cluster_id) ?? undefined;
  const batchFilter = clusterId ? { cluster_id: clusterId } : {};
  const [window, queueCounts, lastBatchDoc] = await Promise.all([
    getWindowState(db, clusterId),
    getQueueCounts(db, clusterId),
    db.collection<MaintenanceBatchDocument>(COLLECTIONS.batches)
      .find(batchFilter)
      .sort({ decided_at: -1, updated_at: -1, created_at: -1, _id: -1 })
      .limit(1)
      .next()
  ]);

  return {
    window,
    queue_counts: queueCounts,
    last_batch: mapBatchSummary(lastBatchDoc),
    last_scan_job: mapLastScanJob(lastBatchDoc)
  };
}

function normalizePage(limit?: number, page?: number): { limit: number; page: number } {
  return {
    limit: Math.min(Math.max(Number(limit || 50), 1), 200),
    page: Math.max(Number(page || 0), 0)
  };
}

function buildQueueFilter(query: MaintenanceQueueQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.cluster_id) filter.cluster_id = query.cluster_id;
  if (query.status) filter.status = query.status;
  if (query.action_type) filter.action_type = query.action_type;
  return filter;
}

function buildHistoryFilter(query: MaintenanceHistoryQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.cluster_id) filter.cluster_id = query.cluster_id;
  if (query.outcome) filter.outcome = query.outcome;
  return filter;
}

function mapQueueItem(doc: MaintenanceQueueDocument): Record<string, unknown> {
  const itemId = pickFirstString(doc, ["item_id"]) ?? getObjectIdString(doc._id);
  const shortId = itemId ? itemId.slice(0, 8) : null;
  return {
    item_id: itemId,
    short_id: shortId,
    cluster_id: pickFirstString(doc, ["cluster_id"]),
    table_name: pickFirstString(doc, ["table_name", "table"]),
    schema_name: pickFirstString(doc, ["schema_name", "schema"]),
    index_name: pickFirstString(doc, ["index_name", "index"]),
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
    created_at: getDateString(doc.created_at)
  };
}

function mapHistoryItem(doc: MaintenanceHistoryDocument): Record<string, unknown> {
  const historyId = pickFirstString(doc, ["history_id"]) ?? getObjectIdString(doc._id);
  return {
    history_id: historyId,
    cluster_id: pickFirstString(doc, ["cluster_id"]),
    table_name: pickFirstString(doc, ["table_name", "table"]),
    schema_name: pickFirstString(doc, ["schema_name", "schema"]),
    index_name: pickFirstString(doc, ["index_name", "index"]),
    action_type: pickFirstString(doc, ["action_type"]),
    outcome: pickFirstString(doc, ["outcome"]),
    frag_before_pct: pickFirstNumber(doc, ["frag_before_pct", "fragmentation_before_pct"]),
    frag_after_pct: pickFirstNumber(doc, ["frag_after_pct", "fragmentation_after_pct"]),
    duration_ms: pickFirstNumber(doc, ["duration_ms"]),
    skip_reason: pickFirstString(doc, ["skip_reason"]),
    error: pickFirstString(doc, ["error", "last_error"]),
    started_at: getDateString(doc.started_at),
    finished_at: getDateString(doc.finished_at)
  };
}

export async function listMaintenanceQueue(
  db: Db,
  query: MaintenanceQueueQuery
): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const { limit, page } = normalizePage(query.limit, query.page);
  const filter = buildQueueFilter(query);
  const coll = db.collection<MaintenanceQueueDocument>(COLLECTIONS.queue);
  const [total, items] = await Promise.all([
    coll.countDocuments(filter),
    coll.find(filter).sort({ priority: -1, created_at: -1, _id: -1 }).skip(page * limit).limit(limit).toArray()
  ]);

  return { total, items: items.map(mapQueueItem) };
}

export async function listMaintenanceHistory(
  db: Db,
  query: MaintenanceHistoryQuery
): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const { limit, page } = normalizePage(query.limit, query.page);
  const filter = buildHistoryFilter(query);
  const coll = db.collection<MaintenanceHistoryDocument>(COLLECTIONS.history);
  const [total, items] = await Promise.all([
    coll.countDocuments(filter),
    coll.find(filter).sort({ finished_at: -1, started_at: -1, _id: -1 }).skip(page * limit).limit(limit).toArray()
  ]);

  return { total, items: items.map(mapHistoryItem) };
}
