import { Db } from "mongodb";
import { collections } from "../db/collections";
import { fetchJsonWithTimeout } from "../proxy/l2-proxy";

export async function getInsightsSummary(db: Db, l2ApiUrl?: string, days = 30, clusterId?: string) {
  if (l2ApiUrl) {
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (clusterId) params.set("cluster_id", clusterId);
      return await fetchJsonWithTimeout(`${l2ApiUrl}/api/insights/summary?${params}`, 10_000);
    } catch {
      // fallback below
    }
  }

  const filter: Record<string, unknown> = clusterId ? { cluster_id: clusterId } : {};
  const docs = await db.collection(collections.insights)
    .find(filter)
    .sort({ created_at: -1 })
    .limit(200)
    .toArray();

  return { items: docs, source: "mongodb-fallback" };
}

export async function getInsights(db: Db, l2ApiUrl?: string, queryString = "") {
  if (l2ApiUrl) {
    try {
      const suffix = queryString ? `?${queryString}` : "";
      return await fetchJsonWithTimeout(`${l2ApiUrl}/api/insights${suffix}`, 10_000);
    } catch {
      // fallback below
    }
  }

  const docs = await db.collection(collections.insights)
    .find(parseClusterFilter(queryString))
    .sort({ created_at: -1 })
    .limit(500)
    .toArray();

  return { items: docs, source: "mongodb-fallback" };
}

function parseClusterFilter(queryString: string): Record<string, unknown> {
  if (!queryString) return {};
  const params = new URLSearchParams(queryString);
  const clusterId = params.get("cluster_id")?.trim();
  return clusterId ? { cluster_id: clusterId } : {};
}
