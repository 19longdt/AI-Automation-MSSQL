import { Db } from "mongodb";
import { collections } from "../db/collections";
import { applyDetectedAtRangeFilter } from "./time-filter";

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

function applyBlockingStatusFilter(filter: Record<string, unknown>, blockingStatus?: string) {
  if (blockingStatus === "blocked") {
    filter.$and = [
      ...((filter.$and as unknown[]) || []),
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
      ...((filter.$and as unknown[]) || []),
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

  applyDetectedAtRangeFilter(filter, query.since, query.until);
  applyBlockingStatusFilter(filter, query.blocking_status);

  return filter;
}

export async function listFindings(db: Db, query: FindingsQuery) {
  const filter = buildFindingsFilter(query);

  if (!query.finding_id && query.issue_type) filter.issue_type = query.issue_type;

  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  const page = Math.max(Number(query.page || 0), 0);

  const findingsColl = db.collection(collections.findings);
  const analysesColl = db.collection(collections.analyses);

  const total = await findingsColl.countDocuments(filter);
  const items = await findingsColl.find(filter).sort({ detected_at: -1 }).skip(page * limit).limit(limit).toArray();

  const findingIds = items.map((x: any) => x.finding_id).filter(Boolean);
  const analyzedFindingIdSet = new Set<string>();
  const latestAnalysisByFindingId: Record<string, any> = {};

  if (findingIds.length) {
    const analyses = await analysesColl
      .find(
        { finding_id: { $in: findingIds } },
        { sort: { started_at: -1 } }
      )
      .toArray();

    analyses.forEach((a: any) => {
      if (!a.finding_id) return;
      const fid = String(a.finding_id);
      analyzedFindingIdSet.add(fid);
      if (!latestAnalysisByFindingId[fid]) {
        const sanitized = { ...a };
        delete sanitized.finding_snapshot;
        latestAnalysisByFindingId[fid] = sanitized;
      }
    });
  }

  const mapped = items.map((x: any) => {
    const findingId = String(x.finding_id || "");
    return {
      ...x,
      ai_analyzed: analyzedFindingIdSet.has(findingId),
      ai_analysis: latestAnalysisByFindingId[findingId] || null
    };
  });

  return { total, items: mapped };
}

function parseTimelineDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeIntervalMinutes(value?: number): number {
  const raw = Number(value || 30);
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(Math.max(Math.round(raw), 1), 24 * 60);
}

export async function getFindingTimeline(db: Db, query: FindingTimelineQuery) {
  const intervalMinutes = normalizeIntervalMinutes(query.interval_minutes);
  const intervalMs = intervalMinutes * 60 * 1000;
  const since = parseTimelineDate(query.since);
  const until = parseTimelineDate(query.until);
  const filter = buildFindingsFilter(query);
  const findingsColl = db.collection(collections.findings);

  const detectedAtAsDate = {
    $convert: {
      input: "$detected_at",
      to: "date",
      onError: null,
      onNull: null
    }
  };

  const buckets = await findingsColl.aggregate([
    { $match: filter },
    { $addFields: { detected_at_date: detectedAtAsDate } },
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

  if (!rangeStart && buckets.length) rangeStart = buckets[0]._id;
  if (!rangeEnd && buckets.length) rangeEnd = buckets[buckets.length - 1]._id;
  if (!rangeStart && !rangeEnd) {
    const now = new Date();
    rangeEnd = now;
    rangeStart = new Date(now.getTime() - intervalMs * 24);
  } else if (!rangeStart && rangeEnd) {
    rangeStart = new Date(rangeEnd.getTime() - intervalMs * 24);
  } else if (rangeStart && !rangeEnd) {
    rangeEnd = new Date(rangeStart.getTime() + intervalMs * 24);
  }

  const indexed = new Map<number, any>();
  buckets.forEach((bucket: any) => {
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

async function findAnalysisForFinding(db: Db, finding: any) {
  const analyses = db.collection(collections.analyses);

  if (finding.finding_id) {
    const byFindingId = await analyses.findOne({ finding_id: finding.finding_id }, { sort: { started_at: -1 } });
    if (byFindingId) return byFindingId;
  }

  return null;
}

export async function getFindingById(db: Db, id: string) {
  const finding = await db.collection(collections.findings).findOne({ finding_id: id });
  if (!finding) return null;

  const analysis = await findAnalysisForFinding(db, finding);

  const sanitizedAnalysis = analysis ? { ...analysis } : null;
  if (sanitizedAnalysis) delete sanitizedAnalysis.finding_snapshot;

  return {
    ...finding,
    analysis_text: analysis ? analysis.analysis_text : finding.analysis_text,
    root_cause_summary: analysis ? analysis.root_cause_summary : finding.root_cause_summary,
    top_actions: analysis ? analysis.top_actions : finding.top_actions,
    ai_analysis: sanitizedAnalysis
  };
}
