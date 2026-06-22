import { Db } from "mongodb";
import { collections } from "../db/collections";

export async function getJobsHealth(db: Db, clusterId?: string) {
  // Job names follow pattern: topic_<cluster_id>_<topic_id>
  // Filter by prefix to scope health view to a specific cluster.
  const matchStage = clusterId
    ? { $match: { job_name: { $regex: `^topic_${clusterId}_` } } }
    : null;
  const pipeline = [
    ...(matchStage ? [matchStage] : []),
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
