import { Db } from "mongodb";
import { collections } from "../db/collections";
import { fetchJsonWithTimeout } from "../proxy/l2-proxy";

export async function getInsightsSummary(db: Db, l2ApiUrl?: string, days = 30) {
  if (l2ApiUrl) {
    try {
      return await fetchJsonWithTimeout(`${l2ApiUrl}/api/insights/summary?days=${days}`, 10_000);
    } catch {
      // fallback below
    }
  }

  const docs = await db.collection(collections.insights)
    .find({})
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
    .find({})
    .sort({ created_at: -1 })
    .limit(500)
    .toArray();

  return { items: docs, source: "mongodb-fallback" };
}
