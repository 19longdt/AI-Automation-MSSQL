import { Db, Document } from "mongodb";
import { collections } from "../db/collections";

export interface TopicNotifyOverride {
  notify_enabled: boolean;
}

export type TopicOverridesMap = Record<string, TopicNotifyOverride>;

interface ClusterDocument extends Document {
  cluster_id?: string;
  topic_overrides?: unknown;
}

function isTopicNotifyOverride(value: unknown): value is TopicNotifyOverride {
  return Boolean(
    value
    && typeof value === "object"
    && "notify_enabled" in value
    && typeof (value as { notify_enabled?: unknown }).notify_enabled === "boolean"
  );
}

function normalizeTopicOverrides(value: unknown): TopicOverridesMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([topicId, override]) => topicId.trim() && isTopicNotifyOverride(override))
    .map(([topicId, override]) => [topicId, { notify_enabled: override.notify_enabled }] as const);
  return Object.fromEntries(entries);
}

export async function getTopicOverrides(db: Db, clusterId: string): Promise<TopicOverridesMap | null> {
  const doc = await db.collection<ClusterDocument>(collections.clusters).findOne(
    { cluster_id: clusterId },
    { projection: { _id: 0, topic_overrides: 1 } }
  );
  if (!doc) return null;
  return normalizeTopicOverrides(doc.topic_overrides);
}

export async function setTopicOverrides(db: Db, clusterId: string, overrides: TopicOverridesMap): Promise<boolean> {
  const result = await db.collection<ClusterDocument>(collections.clusters).updateOne(
    { cluster_id: clusterId },
    { $set: { topic_overrides: normalizeTopicOverrides(overrides) } }
  );
  return result.matchedCount > 0;
}
