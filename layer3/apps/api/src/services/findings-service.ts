import { Db, Document } from "mongodb";
import { collections } from "../db/collections";
import { buildDetectedAtDateRangeMatch } from "./time-filter";

export interface FindingsQuery {
  finding_id?: string;
  query_hash?: string;
  cluster_id?: string;
  topic_id?: string;
  severity?: string;
  alert_status?: string;
  issue_type?: string;
  node?: string;
  status?: string;
  blocking_status?: string;
  since?: string;
  until?: string;
  limit?: number;
  page?: number;
}

export interface FindingTimelineQuery {
  finding_id?: string;
  query_hash?: string;
  cluster_id?: string;
  topic_id?: string;
  severity?: string;
  alert_status?: string;
  blocking_status?: string;
  since?: string;
  until?: string;
  interval_minutes?: number;
}

export interface SlowQueryStatsQuery {
  finding_id?: string;
  query_hash?: string;
  cluster_id?: string;
  severity?: string;
  alert_status?: string;
  blocking_status?: string;
  replica?: string;
  since?: string;
  until?: string;
  sort_by?: "impact" | "count" | "avg_elapsed" | "max_elapsed" | "avg_cpu";
  sort_dir?: "asc" | "desc";
  limit?: number;
}

interface FindingDocument extends Document {
  finding_id?: string;
  analysis_text?: string;
  root_cause_summary?: string;
  top_actions?: unknown;
}

interface AnalysisDocument extends Document {
  finding_id?: string;
  started_at?: string;
  analysis_text?: string;
  root_cause_summary?: string;
  top_actions?: unknown;
  finding_snapshot?: unknown;
  tool_snapshots?: unknown;
}

interface TimelineBucket {
  _id: Date;
  count?: number;
  critical?: number;
  warning?: number;
  info?: number;
}

interface SlowQueryStatsDocument {
  query_hash: string;
  count: number;
  avg_elapsed: number;
  max_elapsed: number;
  avg_cpu: number;
  impact: number;
  sql_text: string;
  severity: string;
}

function applyBlockingStatusFilter(filter: Record<string, unknown>, blockingStatus?: string): void {
  const currentAnd = Array.isArray(filter.$and) ? filter.$and : [];

  if (blockingStatus === "blocked") {
    filter.$and = [
      ...currentAnd,
      {
        $or: [
          { "metrics.blocking_session_id": { $gt: 0 } },
          { "metrics.blocking_session_id": { $regex: /^[1-9][0-9]*$/ } }
        ]
      }
    ];
    return;
  }

  if (blockingStatus === "not_blocked") {
    filter.$and = [
      ...currentAnd,
      {
        $or: [
          { "metrics.blocking_session_id": { $exists: false } },
          { "metrics.blocking_session_id": null },
          { "metrics.blocking_session_id": "" },
          { "metrics.blocking_session_id": "0" },
          { "metrics.blocking_session_id": { $lte: 0 } }
        ]
      }
    ];
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFindingsFilter(query: FindingsQuery | FindingTimelineQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const andClauses: Array<Record<string, unknown>> = [];

  if (query.finding_id) {
    andClauses.push({
      finding_id: { $regex: escapeRegex(query.finding_id), $options: "i" }
    });
  }

  if (query.query_hash) {
    andClauses.push({
      "metrics.query_hash": {
        $regex: escapeRegex(query.query_hash.trim()),
        $options: "i"
      }
    });
  }

  if ("cluster_id" in query && query.cluster_id) filter.cluster_id = query.cluster_id;
  if (query.topic_id) filter.topic_id = query.topic_id;
  if (query.severity) filter.severity = query.severity;
  if (query.alert_status) filter.alert_status = query.alert_status;

  if ("node" in query && query.node) filter.node = query.node;
  if ("status" in query && query.status) filter.status = query.status;

  applyBlockingStatusFilter(filter, query.blocking_status);

  if (andClauses.length > 0) {
    const currentAnd = Array.isArray(filter.$and) ? filter.$and : [];
    filter.$and = [...currentAnd, ...andClauses];
  }

  return filter;
}

function detectedAtAsDateExpression(): Record<string, unknown> {
  return {
    $convert: {
      input: "$detected_at",
      to: "date",
      onError: null,
      onNull: null
    }
  };
}

function buildDetectedAtPipeline(since?: string, until?: string): Array<Record<string, unknown>> {
  const rangeMatch = buildDetectedAtDateRangeMatch(since, until);
  if (!rangeMatch) {
    return [];
  }
  return [
    { $addFields: { detected_at_date: detectedAtAsDateExpression() } },
    { $match: { detected_at_date: rangeMatch } }
  ];
}

function sanitizeAnalysisDocument(analysis: AnalysisDocument): AnalysisDocument {
  const sanitized = { ...analysis };
  delete sanitized.finding_snapshot;
  delete sanitized.tool_snapshots;
  return sanitized;
}

export async function listFindings(db: Db, query: FindingsQuery): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const filter = buildFindingsFilter(query);

  if (!query.finding_id && query.issue_type) {
    filter.issue_type = query.issue_type;
  }

  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  const page = Math.max(Number(query.page || 0), 0);

  const findingsColl = db.collection<FindingDocument>(collections.findings);
  const analysesColl = db.collection<AnalysisDocument>(collections.analyses);

  const dateStages = buildDetectedAtPipeline(query.since, query.until);
  const sortStage = dateStages.length > 0
    ? { $sort: { detected_at_date: -1, detected_at: -1 } }
    : { $sort: { detected_at: -1 } };
  const totalPipeline: Array<Record<string, unknown>> = [{ $match: filter }, ...dateStages, { $count: "total" }];
  const itemsPipeline: Array<Record<string, unknown>> = [
    { $match: filter },
    ...dateStages,
    sortStage,
    { $skip: page * limit },
    { $limit: limit }
  ];

  const totalResult = await findingsColl.aggregate<{ total?: number }>(totalPipeline).toArray();
  const total = Number(totalResult[0]?.total || 0);
  const items = await findingsColl.aggregate<FindingDocument>(itemsPipeline).toArray();

  const findingIds = items
    .map((item) => item.finding_id)
    .filter((findingId): findingId is string => Boolean(findingId));
  const analyzedFindingIdSet = new Set<string>();
  const latestAnalysisByFindingId: Record<string, AnalysisDocument> = {};

  if (findingIds.length > 0) {
    const analyses = await analysesColl.aggregate<AnalysisDocument>([
      { $match: { finding_id: { $in: findingIds } } },
      { $sort: { started_at: -1 } },
      { $group: { _id: "$finding_id", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } }
    ]).toArray();

    analyses.forEach((analysis) => {
      if (!analysis.finding_id) {
        return;
      }
      analyzedFindingIdSet.add(analysis.finding_id);
      latestAnalysisByFindingId[analysis.finding_id] = sanitizeAnalysisDocument(analysis);
    });
  }

  const mapped = items.map((finding) => {
    const findingId = String(finding.finding_id || "");
    return {
      ...finding,
      ai_analyzed: analyzedFindingIdSet.has(findingId),
      ai_analysis: latestAnalysisByFindingId[findingId] ?? null
    };
  });

  return { total, items: mapped };
}

function parseTimelineDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeIntervalMinutes(value?: number): number {
  const raw = Number(value || 30);
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(Math.max(Math.round(raw), 1), 24 * 60);
}

export async function getFindingTimeline(
  db: Db,
  query: FindingTimelineQuery
): Promise<{ interval_minutes: number; from: string | null; to: string | null; buckets: Array<{ ts: string; count: number; critical: number; warning: number; info: number }> }> {
  const intervalMinutes = normalizeIntervalMinutes(query.interval_minutes);
  const intervalMs = intervalMinutes * 60 * 1000;
  const since = parseTimelineDate(query.since);
  const until = parseTimelineDate(query.until);
  const filter = buildFindingsFilter(query);
  const findingsColl = db.collection<FindingDocument>(collections.findings);

  const dateStages = buildDetectedAtPipeline(query.since, query.until);

  const buckets = await findingsColl.aggregate<TimelineBucket>([
    { $match: filter },
    ...dateStages,
    { $addFields: { detected_at_date: detectedAtAsDateExpression() } },
    { $match: { detected_at_date: { $ne: null } } },
    {
      $group: {
        _id: {
          $toDate: {
            $subtract: [
              { $toLong: "$detected_at_date" },
              { $mod: [{ $toLong: "$detected_at_date" }, intervalMs] }
            ]
          }
        },
        count: { $sum: 1 },
        critical: {
          $sum: {
            $cond: [{ $eq: ["$severity", "CRITICAL"] }, 1, 0]
          }
        },
        warning: {
          $sum: {
            $cond: [{ $eq: ["$severity", "WARNING"] }, 1, 0]
          }
        },
        info: {
          $sum: {
            $cond: [{ $eq: ["$severity", "INFO"] }, 1, 0]
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  let rangeStart = since;
  let rangeEnd = until;

  if (!rangeStart && buckets.length > 0) rangeStart = buckets[0]._id;
  if (!rangeEnd && buckets.length > 0) rangeEnd = buckets[buckets.length - 1]._id;
  if (!rangeStart && !rangeEnd) {
    const now = new Date();
    rangeEnd = now;
    rangeStart = new Date(now.getTime() - intervalMs * 24);
  } else if (!rangeStart && rangeEnd) {
    rangeStart = new Date(rangeEnd.getTime() - intervalMs * 24);
  } else if (rangeStart && !rangeEnd) {
    rangeEnd = new Date(rangeStart.getTime() + intervalMs * 24);
  }

  const indexed = new Map<number, TimelineBucket>();
  buckets.forEach((bucket) => {
    indexed.set(new Date(bucket._id).getTime(), bucket);
  });

  const items: Array<{
    ts: string;
    count: number;
    critical: number;
    warning: number;
    info: number;
  }> = [];

  if (rangeStart && rangeEnd) {
    let cursor = rangeStart.getTime() - (rangeStart.getTime() % intervalMs);
    const end = rangeEnd.getTime();
    while (cursor <= end) {
      const bucket = indexed.get(cursor);
      items.push({
        ts: new Date(cursor).toISOString(),
        count: bucket ? Number(bucket.count || 0) : 0,
        critical: bucket ? Number(bucket.critical || 0) : 0,
        warning: bucket ? Number(bucket.warning || 0) : 0,
        info: bucket ? Number(bucket.info || 0) : 0
      });
      cursor += intervalMs;
    }
  }

  return {
    interval_minutes: intervalMinutes,
    from: rangeStart ? rangeStart.toISOString() : null,
    to: rangeEnd ? rangeEnd.toISOString() : null,
    buckets: items
  };
}

export async function getSlowQueryStats(
  db: Db,
  query: SlowQueryStatsQuery
): Promise<{ items: SlowQueryStatsDocument[] }> {
  const filter = buildFindingsFilter({
    finding_id: query.finding_id,
    query_hash: query.query_hash,
    cluster_id: query.cluster_id,
    topic_id: "slow_sessions",
    severity: query.severity,
    alert_status: query.alert_status,
    blocking_status: query.blocking_status
  });
  const limit = Math.min(Math.max(Number(query.limit || 5), 1), 20);
  const sortBy = query.sort_by || "impact";
  const sortDirection = query.sort_dir === "asc" ? 1 : -1;
  const findingsColl = db.collection<FindingDocument>(collections.findings);
  const dateStages = buildDetectedAtPipeline(query.since, query.until);
  const replicaStages = query.replica
    ? [{ $match: { "metrics.replica_server_name": query.replica } }]
    : [];
  const sortStage: Record<string, 1 | -1> =
    sortBy === "count"
      ? { count: sortDirection, impact: -1, avg_elapsed: -1, max_elapsed: -1 }
      : sortBy === "avg_elapsed"
        ? { avg_elapsed: sortDirection, count: -1, max_elapsed: -1 }
        : sortBy === "max_elapsed"
          ? { max_elapsed: sortDirection, avg_elapsed: -1, count: -1 }
          : sortBy === "avg_cpu"
            ? { avg_cpu: sortDirection, impact: -1, avg_elapsed: -1 }
            : { impact: sortDirection, avg_elapsed: -1, count: -1, max_elapsed: -1 };

  const items = await findingsColl.aggregate<SlowQueryStatsDocument>([
    { $match: filter },
    ...dateStages,
    ...replicaStages,
    {
      $addFields: {
        query_hash_str: {
          $toUpper: {
            $trim: {
              input: {
                $convert: {
                  input: "$metrics.query_hash",
                  to: "string",
                  onError: "",
                  onNull: ""
                }
              }
            }
          }
        },
        elapsed_num: {
          $convert: {
            input: "$metrics.elapsed_seconds",
            to: "double",
            onError: 0,
            onNull: 0
          }
        },
        cpu_num: {
          $convert: {
            input: "$metrics.cpu_time_seconds",
            to: "double",
            onError: 0,
            onNull: 0
          }
        },
        sql_text_str: {
          $trim: {
            input: {
              $convert: {
                input: "$metrics.sql_text",
                to: "string",
                onError: "",
                onNull: ""
              }
            }
          }
        },
        severity_rank: {
          $switch: {
            branches: [
              { case: { $eq: ["$severity", "CRITICAL"] }, then: 3 },
              { case: { $eq: ["$severity", "WARNING"] }, then: 2 }
            ],
            default: 1
          }
        }
      }
    },
    {
      $match: {
        query_hash_str: {
          $nin: ["", "0X0000000000000000"]
        }
      }
    },
    {
      $addFields: {
        has_sql_text: {
          $cond: [{ $gt: [{ $strLenCP: "$sql_text_str" }, 0] }, 1, 0]
        }
      }
    },
    { $sort: { query_hash_str: 1, has_sql_text: -1, detected_at_date: -1, detected_at: -1 } },
    {
      $group: {
        _id: "$query_hash_str",
        count: { $sum: 1 },
        avg_elapsed: { $avg: "$elapsed_num" },
        max_elapsed: { $max: "$elapsed_num" },
        avg_cpu: { $avg: "$cpu_num" },
        sql_text: { $first: "$sql_text_str" },
        severity_rank: { $max: "$severity_rank" }
      }
    },
    {
      $project: {
        _id: 0,
        query_hash: "$_id",
        count: 1,
        avg_elapsed: 1,
        max_elapsed: 1,
        avg_cpu: 1,
        impact: { $multiply: ["$avg_elapsed", "$count"] },
        sql_text: 1,
        severity: {
          $switch: {
            branches: [
              { case: { $eq: ["$severity_rank", 3] }, then: "CRITICAL" },
              { case: { $eq: ["$severity_rank", 2] }, then: "WARNING" }
            ],
            default: "INFO"
          }
        }
      }
    },
    { $sort: sortStage },
    { $limit: limit }
  ]).toArray();

  return { items };
}

export interface AgSecondaryStatus {
  status: "active" | "no_secondary";
  last_seen_at: string | null;
}

export async function getAgSecondaryStatus(db: Db, clusterId: string): Promise<AgSecondaryStatus> {
  // detected_at is stored as naive UTC+7 strings by Layer 1 (e.g. "2026-06-23T16:55:00").
  // MongoDB $convert treats them as UTC, so comparisons must use the same naive convention.
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const sinceTs = Date.now() + VN_OFFSET_MS - 2 * 60 * 1000;
  const since = new Date(sinceTs).toISOString().replace("Z", ""); // strip Z → naive string
  const filter: Record<string, unknown> = { topic_id: "ag_health" };
  if (clusterId) filter.cluster_id = clusterId;

  const findingsColl = db.collection<FindingDocument>(collections.findings);
  const dateStages = buildDetectedAtPipeline(since, undefined);

  const result = await findingsColl.aggregate<{ total: number }>([
    { $match: filter },
    ...dateStages,
    { $count: "total" }
  ]).toArray();

  if ((result[0]?.total ?? 0) > 0) {
    return { status: "active", last_seen_at: since };
  }

  const latest = await findingsColl.findOne(
    filter as Parameters<typeof findingsColl.findOne>[0],
    { sort: { detected_at: -1 } }
  );
  return {
    status: "no_secondary",
    last_seen_at: latest ? String(latest.detected_at ?? null) : null
  };
}

async function findAnalysisForFinding(db: Db, finding: FindingDocument): Promise<AnalysisDocument | null> {
  const analyses = db.collection<AnalysisDocument>(collections.analyses);

  if (finding.finding_id) {
    const byFindingId = await analyses.findOne({ finding_id: finding.finding_id }, { sort: { started_at: -1 } });
    if (byFindingId) {
      return byFindingId;
    }
  }

  return null;
}

export async function getFindingById(db: Db, id: string): Promise<Record<string, unknown> | null> {
  const finding = await db.collection<FindingDocument>(collections.findings).findOne({ finding_id: id });
  if (!finding) return null;

  const analysis = await findAnalysisForFinding(db, finding);
  const sanitizedAnalysis = analysis ? sanitizeAnalysisDocument(analysis) : null;

  return {
    ...finding,
    analysis_text: analysis ? analysis.analysis_text : finding.analysis_text,
    root_cause_summary: analysis ? analysis.root_cause_summary : finding.root_cause_summary,
    top_actions: analysis ? analysis.top_actions : finding.top_actions,
    ai_analysis: sanitizedAnalysis
  };
}
