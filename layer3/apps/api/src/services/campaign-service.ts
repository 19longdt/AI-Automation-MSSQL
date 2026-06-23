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
}

export interface CampaignUpdateBody {
  name?: string;
  description?: string;
  end_date?: string;
  scan_times?: string[];
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
  discovery_started_at?: Date | string | null;
  discovery_finished_at?: Date | string | null;
  last_scan_triggered_at?: Date | string | null;
  total_items?: number;
  done_count?: number;
  failed_count?: number;
  skipped_count?: number;
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
    discovery_started_at: toIsoString(doc.discovery_started_at),
    discovery_finished_at: toIsoString(doc.discovery_finished_at),
    last_scan_triggered_at: toIsoString(doc.last_scan_triggered_at),
    total_items: totalItems,
    done_count: doneCount,
    failed_count: failedCount,
    skipped_count: skippedCount,
    remaining_items: Math.max(0, totalItems - processed),
    progress_pct: totalItems > 0 ? Math.min(100, Math.round((processed / totalItems) * 100)) : 0,
    created_at: toIsoString(doc.created_at),
    updated_at: toIsoString(doc.updated_at),
  };
}

function getCampaignCollection(db: Db) {
  return db.collection<CampaignDocument>(collections.campaigns);
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
    discovery_started_at: null,
    discovery_finished_at: null,
    last_scan_triggered_at: null,
    total_items: 0,
    done_count: 0,
    failed_count: 0,
    skipped_count: 0,
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
  if (body.end_date !== undefined) {
    const nextEndDate = requireDate(body.end_date, "end_date");
    const startDate = getDate(existing.start_date);
    if (!startDate) throw new CampaignServiceError("Campaign start_date is invalid", 500);
    if (nextEndDate <= startDate) {
      throw new CampaignServiceError("end_date must be greater than start_date", 400);
    }
    setFields.end_date = nextEndDate;

    const now = new Date();
    const currentStatus = getString(existing.status)?.toLowerCase();
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
