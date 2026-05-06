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

export async function listFindings(db: Db, query: FindingsQuery) {
  const filter: Record<string, unknown> = {};
  if (query.finding_id) {
    filter.finding_id = query.finding_id;
  } else {
    if (query.topic_id) filter.topic_id = query.topic_id;
    if (query.severity) filter.severity = query.severity;
    if (query.alert_status) filter.alert_status = query.alert_status;
    if (query.issue_type) filter.issue_type = query.issue_type;
    if (query.node) filter.node = query.node;
    if (query.status) filter.status = query.status;

    applyDetectedAtRangeFilter(filter, query.since, query.until);
    applyBlockingStatusFilter(filter, query.blocking_status);
  }

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
