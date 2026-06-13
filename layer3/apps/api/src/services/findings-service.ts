import { Db, Document } from "mongodb";
import { collections } from "../db/collections";
import { buildDetectedAtDateRangeMatch } from "./time-filter";

export interface FindingsQuery {
  finding_id?: string;
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
  topic_id?: string;
  severity?: string;
  alert_status?: string;
  blocking_status?: string;
  since?: string;
  until?: string;
  interval_minutes?: number;
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

function buildFindingsFilter(query: FindingsQuery | FindingTimelineQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const findingQuery = query as FindingsQuery;

  if (findingQuery.finding_id) {
    filter.finding_id = findingQuery.finding_id;
    return filter;
  }

  if (query.topic_id) filter.topic_id = query.topic_id;
  if (query.severity) filter.severity = query.severity;
  if (query.alert_status) filter.alert_status = query.alert_status;

  if ("node" in query && query.node) filter.node = query.node;
  if ("status" in query && query.status) filter.status = query.status;

  applyBlockingStatusFilter(filter, query.blocking_status);

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
  const totalPipeline: Array<Record<string, unknown>> = [{ $match: filter }, ...dateStages, { $count: "total" }];
  const itemsPipeline: Array<Record<string, unknown>> = [
    { $match: filter },
    ...dateStages,
    { $sort: { detected_at_date: -1, detected_at: -1 } },
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
