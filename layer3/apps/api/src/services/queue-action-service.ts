import { Db, Document } from "mongodb";
import { mapQueueItem } from "./maintenance-service";

const COLLECTIONS = {
  queue: "maintenance_queue",
} as const;

export type QueueItemAction = "approve" | "reject" | "skip" | "reset";
export type QueueBulkAction = "approve" | "reject" | "skip";

export interface BulkQueueActionBody {
  action: QueueBulkAction;
  cluster_id: string;
  item_ids?: string[];
  campaign_id?: string;
  batch_id?: string;
}

interface MaintenanceQueueDocument extends Document {}

export class QueueActionServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "QueueActionServiceError";
  }
}

export function isQueueActionServiceError(error: unknown): error is QueueActionServiceError {
  return error instanceof QueueActionServiceError;
}

function normalizeString(value: string | null | undefined, fieldName: string): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    throw new QueueActionServiceError(`${fieldName} is required`, 400);
  }
  return normalized;
}

function normalizeStringArray(values: string[] | undefined): string[] | undefined {
  if (!values?.length) return undefined;
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function assertTransition(action: QueueItemAction, status: string): void {
  const allowed = {
    approve: ["awaiting_approval"],
    reject: ["awaiting_approval"],
    skip: ["awaiting_approval", "approved"],
    reset: ["failed", "rejected"],
  } satisfies Record<QueueItemAction, string[]>;

  if (!allowed[action].includes(status)) {
    throw new QueueActionServiceError(
      `Invalid transition: cannot ${action} item from ${status || "unknown"} state`,
      400,
    );
  }
}

function buildSingleUpdate(action: QueueItemAction, now: Date): Record<string, unknown> {
  switch (action) {
    case "approve":
      return { $set: { status: "approved", decided_at: now, decided_by: "web" } };
    case "reject":
      return { $set: { status: "rejected", decided_at: now, decided_by: "web", terminal_at: now } };
    case "skip":
      return { $set: { status: "skipped", terminal_at: now } };
    case "reset":
      return { $set: { status: "approved", attempts: 0, last_error: null } };
  }
}

export async function updateQueueItemAction(
  db: Db,
  itemId: string,
  action: QueueItemAction,
): Promise<Record<string, unknown>> {
  const normalizedItemId = normalizeString(itemId, "itemId");
  const coll = db.collection<MaintenanceQueueDocument>(COLLECTIONS.queue);
  const existing = await coll.findOne({ item_id: normalizedItemId });

  if (!existing) {
    throw new QueueActionServiceError("Queue item not found", 404);
  }

  assertTransition(action, normalizeStatus(existing.status));

  await coll.updateOne({ item_id: normalizedItemId }, buildSingleUpdate(action, new Date()));

  const updated = await coll.findOne({ item_id: normalizedItemId });
  if (!updated) {
    throw new QueueActionServiceError("Queue item not found after update", 404);
  }

  return mapQueueItem(updated);
}

export async function bulkQueueAction(
  db: Db,
  body: BulkQueueActionBody,
): Promise<{ updated_count: number }> {
  const clusterId = normalizeString(body.cluster_id, "cluster_id");
  const itemIds = normalizeStringArray(body.item_ids);
  const campaignId = body.campaign_id?.trim() || undefined;
  const batchId = body.batch_id?.trim() || undefined;

  if (!itemIds && !campaignId) {
    throw new QueueActionServiceError("campaign_id is required when item_ids is not provided", 400);
  }

  const filter: Record<string, unknown> = {
    cluster_id: clusterId,
    status: "awaiting_approval",
  };

  if (itemIds) {
    filter.item_id = { $in: itemIds };
  } else {
    filter.campaign_id = campaignId;
  }

  if (batchId) {
    filter.batch_id = batchId;
  }

  const result = await db.collection<MaintenanceQueueDocument>(COLLECTIONS.queue).updateMany(
    filter,
    buildSingleUpdate(body.action, new Date()),
  );

  return { updated_count: result.modifiedCount };
}
