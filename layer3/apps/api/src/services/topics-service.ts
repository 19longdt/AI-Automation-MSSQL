import { Db } from "mongodb";
import { collections } from "../db/collections";

export async function listTopics(db: Db) {
  return db.collection(collections.topics)
    .find({}, { projection: { "queries.sql": 0 } })
    .sort({ topic_id: 1 })
    .toArray();
}
