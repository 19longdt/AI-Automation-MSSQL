import { Db } from "mongodb";
import { collections } from "../db/collections";

export async function getJobsHealth(db: Db) {
  const pipeline = [
    { $sort: { job_name: 1, started_at: -1 } },
    {
      $group: {
        _id: "$job_name",
        latest: { $first: "$$ROOT" }
      }
    },
    {
      $replaceRoot: { newRoot: "$latest" }
    },
    {
      $addFields: {
        is_healthy: { $in: ["$status", ["completed", "running"]] }
      }
    },
    { $sort: { job_name: 1 } }
  ];

  return db.collection(collections.jobs).aggregate(pipeline).toArray();
}
