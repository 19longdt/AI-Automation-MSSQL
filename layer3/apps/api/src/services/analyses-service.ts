import { Db } from "mongodb";
import { collections } from "../db/collections";

export async function listAnalyses(db: Db, limit = 50, page = 0) {
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
  const safePage = Math.max(Number(page || 0), 0);

  const docs = await db.collection(collections.analyses)
    .find({}, { projection: { finding_snapshot: 0 } })
    .sort({ started_at: -1 })
    .skip(safePage * safeLimit)
    .limit(safeLimit)
    .toArray();

  return docs;
}

export async function getAnalysisById(db: Db, id: string) {
  return db.collection(collections.analyses).findOne({ analysis_id: id });
}
