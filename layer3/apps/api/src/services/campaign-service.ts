import { randomUUID } from "node:crypto";
import { Db, Document } from "mongodb";
import { collections } from "../db/collections";

const DB_TO_API_STATUS = {
  pending: "PENDING",
  discovering: "DISCOVERING",
  discovery_failed: "DISCOVERY_FAILED",
  active: "ACTIVE",
  completed: "COMPLETED",
  expired: "EXPIRED",
  cancelled: "CANCELLED",
} as const;

const API_TO_DB_STATUS = {
  PENDING: "pending",
  DISCOVERING: "discovering",
  DISCOVERY_FAILED: "discovery_failed",
  ACTIVE: "active",
  COMPLETED: "completed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
} as const;

type ApiCampaignStatus = keyof typeof API_TO_DB_STATUS;
type DbCampaignStatus = typeof API_TO_DB_STATUS[ApiCampaignStatus];
type ExecutionType = "index" | "statistic" | "heap";

export interface CampaignScopeTable {
  schema_name: string;
  table_names: string[];
}

export interface CampaignScopeDatabase {
  database_name: string;
  schemas: CampaignScopeTable[];
}

export interface CampaignWindowOverride {
  start: string;
  end: string;
  time_budget_minutes: number;
}

export interface CampaignThresholds {
  index?: { reorganize_pct?: number | null; rebuild_pct?: number | null; min_page_count?: number | null; max_page_count?: number | null } | null;
  statistic?: { modification_threshold?: number | null; stats_min_sample_pct?: number | null } | null;
  heap?: { forwarded_threshold?: number | null } | null;
}

const THRESHOLD_DEFAULTS = {
  index: {
    reorganize_pct: 10,
    rebuild_pct: 30,
    min_page_count: 1000,
  },
  statistic: {
    modification_threshold: 20000,
    stats_min_sample_pct: 5,
  },
  heap: {
    forwarded_threshold: 1000,
  },
} as const;

function pickNumbersWithDefaults(
  obj: Record<string, unknown> | null | undefined,
  requiredKeys: string[],
  defaults: Record<string, number>,
  optionalKeys: string[] = [],
): Record<string, number> | null {
  if (!obj) return null;
  const out: Record<string, number> = {};
  for (const key of requiredKeys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[key] = v;
      continue;
    }
    out[key] = defaults[key];
  }
  for (const key of optionalKeys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeThresholds(thresholds: CampaignThresholds | null | undefined): CampaignThresholds | null {
  if (!thresholds) return null;
  const index = pickNumbersWithDefaults(
    thresholds.index,
    ["reorganize_pct", "rebuild_pct", "min_page_count"],
    THRESHOLD_DEFAULTS.index,
    ["max_page_count"],
  );
  const statistic = pickNumbersWithDefaults(
    thresholds.statistic,
    ["modification_threshold", "stats_min_sample_pct"],
    THRESHOLD_DEFAULTS.statistic,
  );
  const heap = pickNumbersWithDefaults(
    thresholds.heap,
    ["forwarded_threshold"],
    THRESHOLD_DEFAULTS.heap,
  );
  const out: CampaignThresholds = {};
  if (index) out.index = index;
  if (statistic) out.statistic = statistic;
  if (heap) out.heap = heap;
  return Object.keys(out).length > 0 ? out : null;
}

export interface CampaignListQuery {
  cluster_id?: string;
  status?: ApiCampaignStatus | "";
  limit?: number;
  page?: number;
}

export interface CampaignCreateBody {
  cluster_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  scan_times?: string[];
  scope?: CampaignScopeDatabase[] | null;
  thresholds?: CampaignThresholds | null;
  window_override?: CampaignWindowOverride | null;
  execution_types?: ExecutionType[];
}

export interface CampaignUpdateBody {
  name?: string;
  description?: string;
  end_date?: string;
  scan_times?: string[];
  scope?: CampaignScopeDatabase[] | null;
  thresholds?: CampaignThresholds | null;
  window_override?: CampaignWindowOverride | null;
  execution_types?: ExecutionType[];
}

interface CampaignDocument extends Document {
  campaign_id?: string;
  cluster_id?: string;
  name?: string;
  description?: string | null;
  status?: string;
  discovery_error?: string | null;
  start_date?: Date | string;
  end_date?: Date | string;
  scan_times?: string[];
  scope?: CampaignScopeDatabase[] | null;
  thresholds?: CampaignThresholds | null;
  window_override?: CampaignWindowOverride | null;
  execution_types?: ExecutionType[];
  discovery_started_at?: Date | string | null;
  discovery_finished_at?: Date | string | null;
  last_scan_triggered_at?: Date | string | null;
  total_items?: number;
  done_count?: number;
  failed_count?: number;
  skipped_count?: number;
  window_budget_used_minutes?: number;
  created_at?: Date | string;
  updated_at?: Date | string;
}

class CampaignServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "CampaignServiceError";
  }
}

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function requireDate(value: string, field: string): Date {
  const parsed = getDate(value);
  if (!parsed) throw new CampaignServiceError(`Invalid ${field}`, 400);
  return parsed;
}

function toIsoString(value: unknown): string | null {
  const parsed = getDate(value);
  return parsed ? parsed.toISOString() : null;
}

function mapStatusToApi(value: unknown): ApiCampaignStatus | null {
  const raw = getString(value)?.toLowerCase();
  if (!raw) return null;
  return DB_TO_API_STATUS[raw as keyof typeof DB_TO_API_STATUS] ?? null;
}

function mapStatusToDb(value: CampaignListQuery["status"]): DbCampaignStatus | null {
  if (!value) return null;
  return API_TO_DB_STATUS[value] ?? null;
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapCampaign(doc: CampaignDocument): Record<string, unknown> {
  const totalItems = getNumber(doc.total_items);
  const doneCount = getNumber(doc.done_count);
  const failedCount = getNumber(doc.failed_count);
  const skippedCount = getNumber(doc.skipped_count);
  const processed = doneCount + failedCount + skippedCount;
  return {
    campaign_id: getString(doc.campaign_id),
    cluster_id: getString(doc.cluster_id),
    name: getString(doc.name),
    description: typeof doc.description === "string" ? doc.description : null,
    status: mapStatusToApi(doc.status),
    discovery_error: typeof doc.discovery_error === "string" ? doc.discovery_error : null,
    start_date: toIsoString(doc.start_date),
    end_date: toIsoString(doc.end_date),
    scan_times: Array.isArray(doc.scan_times) && doc.scan_times.length > 0 ? doc.scan_times : ["20:00"],
    scope: Array.isArray(doc.scope) ? doc.scope : null,
    thresholds: doc.thresholds ?? null,
    window_override: doc.window_override ?? null,
    execution_types: Array.isArray(doc.execution_types) && doc.execution_types.length > 0 ? doc.execution_types : ["index", "statistic", "heap"],
    discovery_started_at: toIsoString(doc.discovery_started_at),
    discovery_finished_at: toIsoString(doc.discovery_finished_at),
    last_scan_triggered_at: toIsoString(doc.last_scan_triggered_at),
    total_items: totalItems,
    done_count: doneCount,
    failed_count: failedCount,
    skipped_count: skippedCount,
    remaining_items: Math.max(0, totalItems - processed),
    progress_pct: totalItems > 0 ? Math.min(100, Math.round((processed / totalItems) * 100)) : 0,
    window_budget_used_minutes: getNumber(doc.window_budget_used_minutes),
    created_at: toIsoString(doc.created_at),
    updated_at: toIsoString(doc.updated_at),
  };
}

function getCampaignCollection(db: Db) {
  return db.collection<CampaignDocument>(collections.campaigns);
}

function normalizeScope(scope: CampaignScopeDatabase[] | null | undefined): CampaignScopeDatabase[] | null {
  if (!scope || scope.length === 0) return null;
  const normalized = scope
    .map((dbScope) => ({
      database_name: dbScope.database_name.trim(),
      schemas: (dbScope.schemas ?? [])
        .map((schemaScope) => ({
          schema_name: schemaScope.schema_name.trim(),
          table_names: (schemaScope.table_names ?? []).map((name) => name.trim()).filter(Boolean),
        }))
        .filter((schemaScope) => schemaScope.schema_name),
    }))
    .filter((dbScope) => dbScope.database_name && dbScope.schemas.length > 0);
  return normalized.length > 0 ? normalized : null;
}

function normalizeExecutionTypes(executionTypes: ExecutionType[] | undefined): ExecutionType[] {
  if (!executionTypes || executionTypes.length === 0) return ["index", "statistic", "heap"];
  const allowed = new Set<ExecutionType>(["index", "statistic", "heap"]);
  const normalized = executionTypes.filter((item): item is ExecutionType => allowed.has(item));
  if (normalized.length === 0) {
    throw new CampaignServiceError("execution_types must contain at least one valid value", 400);
  }
  return Array.from(new Set(normalized));
}

async function validateScopeAgainstCatalogConfig(
  db: Db,
  clusterId: string,
  scope: CampaignScopeDatabase[] | null,
): Promise<void> {
  if (!scope || scope.length === 0) return;

  const config = await db.collection(collections.catalogConfig).findOne({ cluster_id: clusterId });
  if (!config) {
    throw new CampaignServiceError(`No catalog config found for cluster '${clusterId}'. Configure scope in Catalog tab first.`, 400);
  }

  // Build merged map: schema entries with the same schema_name are combined into one table list.
  // Catalog config UI allows multiple entries per schema (each with distinct "name"), so we must merge.
  const configDatabases = new Map<string, Map<string, string[]>>();
  for (const dbScope of ((config.databases as Array<Record<string, unknown>> | undefined) ?? [])) {
    const dbName = String(dbScope.database_name || "");
    if (!configDatabases.has(dbName)) configDatabases.set(dbName, new Map<string, string[]>());
    const schemaMap = configDatabases.get(dbName)!;
    for (const schemaScope of ((dbScope.schemas as Array<Record<string, unknown>> | undefined) ?? [])) {
      const schemaName = String(schemaScope.schema_name || "");
      const tables = Array.isArray(schemaScope.table_names)
        ? schemaScope.table_names.map((item) => String(item))
        : [];
      const existing = schemaMap.get(schemaName);
      if (existing) {
        existing.push(...tables);
      } else {
        schemaMap.set(schemaName, [...tables]);
      }
    }
  }

  for (const dbScope of scope) {
    const configSchemas = configDatabases.get(dbScope.database_name);
    if (!configSchemas) {
      throw new CampaignServiceError(`Database '${dbScope.database_name}' not in catalog scope for cluster '${clusterId}'.`, 400);
    }
    for (const schemaScope of dbScope.schemas) {
      const configTables = configSchemas.get(schemaScope.schema_name);
      if (configTables === undefined) {
        throw new CampaignServiceError(`Schema '${schemaScope.schema_name}' not in catalog scope.`, 400);
      }
      if (configTables.length > 0 && schemaScope.table_names.length > 0) {
        const missing = schemaScope.table_names.filter((tableName) => !configTables.includes(tableName));
        if (missing.length > 0) {
          throw new CampaignServiceError(`Tables not in catalog scope: ${missing.join(", ")}`, 400);
        }
      }
    }
  }
}

export function isCampaignServiceError(err: unknown): err is CampaignServiceError {
  return err instanceof CampaignServiceError;
}

export async function listCampaigns(
  db: Db,
  query: CampaignListQuery,
): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  const page = Math.max(Number(query.page || 0), 0);
  const filter: Record<string, unknown> = {};
  if (query.cluster_id) filter.cluster_id = query.cluster_id;
  const dbStatus = mapStatusToDb(query.status);
  if (dbStatus) filter.status = dbStatus;

  const coll = getCampaignCollection(db);
  const [total, items] = await Promise.all([
    coll.countDocuments(filter),
    coll.find(filter).sort({ created_at: -1, start_date: -1, _id: -1 }).skip(page * limit).limit(limit).toArray(),
  ]);

  return { total, items: items.map(mapCampaign) };
}

export async function createCampaign(db: Db, body: CampaignCreateBody): Promise<Record<string, unknown>> {
  const clusterId = body.cluster_id.trim();
  const name = body.name.trim();
  if (!clusterId) throw new CampaignServiceError("cluster_id is required", 400);
  if (!name) throw new CampaignServiceError("name is required", 400);
  const startDate = requireDate(body.start_date, "start_date");
  const endDate = requireDate(body.end_date, "end_date");
  if (endDate <= startDate) {
    throw new CampaignServiceError("end_date must be greater than start_date", 400);
  }

  const scope = normalizeScope(body.scope);
  const executionTypes = normalizeExecutionTypes(body.execution_types);
  await validateScopeAgainstCatalogConfig(db, clusterId, scope);

  const coll = getCampaignCollection(db);
  const existing = await coll.findOne({
    cluster_id: clusterId,
    status: { $in: ["active", "discovering"] },
  });
  if (existing) {
    throw new CampaignServiceError("Another active or discovering campaign already exists", 409);
  }

  const now = new Date();
  const doc: CampaignDocument = {
    campaign_id: randomUUID().replace(/-/g, "").slice(0, 8),
    cluster_id: clusterId,
    name,
    description: normalizeText(body.description),
    status: "pending",
    discovery_error: null,
    start_date: startDate,
    end_date: endDate,
    scan_times: Array.isArray(body.scan_times) && body.scan_times.length > 0 ? body.scan_times : ["20:00"],
    scope,
    thresholds: normalizeThresholds(body.thresholds),
    window_override: body.window_override ?? null,
    execution_types: executionTypes,
    discovery_started_at: null,
    discovery_finished_at: null,
    last_scan_triggered_at: null,
    total_items: 0,
    done_count: 0,
    failed_count: 0,
    skipped_count: 0,
    window_budget_used_minutes: 0,
    created_at: now,
    updated_at: now,
  };

  await coll.insertOne(doc);
  return mapCampaign(doc);
}

export async function updateCampaign(db: Db, id: string, body: CampaignUpdateBody): Promise<Record<string, unknown>> {
  const coll = getCampaignCollection(db);
  const existing = await coll.findOne({ campaign_id: id });
  if (!existing) throw new CampaignServiceError("Campaign not found", 404);

  const currentStatus = getString(existing.status)?.toLowerCase();
  if (!currentStatus) throw new CampaignServiceError("Campaign status is invalid", 500);
  const setFields: Record<string, unknown> = { updated_at: new Date() };

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new CampaignServiceError("name is required", 400);
    setFields.name = name;
  }
  if (body.description !== undefined) setFields.description = normalizeText(body.description);
  if (body.scan_times !== undefined) {
    const times = Array.isArray(body.scan_times) && body.scan_times.length > 0 ? body.scan_times : ["20:00"];
    setFields.scan_times = times;
  }
  if (body.scope !== undefined) {
    if (!["pending"].includes(currentStatus)) {
      throw new CampaignServiceError("scope can only be updated while campaign is pending", 400);
    }
    const scope = normalizeScope(body.scope);
    await validateScopeAgainstCatalogConfig(db, String(existing.cluster_id || ""), scope);
    setFields.scope = scope;
  }
  if (body.execution_types !== undefined) {
    if (!["pending"].includes(currentStatus)) {
      throw new CampaignServiceError("execution_types can only be updated while campaign is pending", 400);
    }
    setFields.execution_types = normalizeExecutionTypes(body.execution_types);
  }
  if (body.window_override !== undefined) {
    if (!["pending", "active"].includes(currentStatus)) {
      throw new CampaignServiceError("window_override can only be updated while campaign is pending or active", 400);
    }
    setFields.window_override = body.window_override ?? null;
  }
  if (body.thresholds !== undefined) {
    if (!["pending", "active"].includes(currentStatus)) {
      throw new CampaignServiceError("thresholds can only be updated while campaign is pending or active", 400);
    }
    // ACTIVE: có hiệu lực ở lần re-discovery kế tiếp.
    setFields.thresholds = normalizeThresholds(body.thresholds);
  }
  if (body.end_date !== undefined) {
    const nextEndDate = requireDate(body.end_date, "end_date");
    const startDate = getDate(existing.start_date);
    if (!startDate) throw new CampaignServiceError("Campaign start_date is invalid", 500);
    if (nextEndDate <= startDate) {
      throw new CampaignServiceError("end_date must be greater than start_date", 400);
    }
    setFields.end_date = nextEndDate;

    const now = new Date();
    if (currentStatus === "expired" && nextEndDate > now) {
      const conflict = await coll.findOne({
        cluster_id: existing.cluster_id,
        campaign_id: { $ne: id },
        status: { $in: ["active", "discovering"] },
      });
      if (conflict) {
        throw new CampaignServiceError("Another active or discovering campaign already exists", 409);
      }
      setFields.status = "active";
      setFields.discovery_error = null;
    } else if (currentStatus === "active" && nextEndDate <= now) {
      setFields.status = "expired";
    }
  }

  await coll.updateOne({ campaign_id: id }, { $set: setFields });
  const updated = await coll.findOne({ campaign_id: id });
  if (!updated) throw new CampaignServiceError("Campaign not found after update", 500);
  return mapCampaign(updated);
}

export async function cancelCampaign(db: Db, id: string): Promise<Record<string, unknown>> {
  const coll = getCampaignCollection(db);
  const existing = await coll.findOne({ campaign_id: id });
  if (!existing) throw new CampaignServiceError("Campaign not found", 404);

  const currentStatus = getString(existing.status)?.toLowerCase();
  if (!currentStatus || !["pending", "active", "discovery_failed"].includes(currentStatus)) {
    throw new CampaignServiceError("Only pending, active, or discovery_failed campaigns can be cancelled", 400);
  }

  await coll.updateOne(
    { campaign_id: id },
    { $set: { status: "cancelled", updated_at: new Date() } },
  );
  const updated = await coll.findOne({ campaign_id: id });
  if (!updated) throw new CampaignServiceError("Campaign not found after cancel", 500);
  return mapCampaign(updated);
}
