import { Db, Document } from "mongodb";
import { collections } from "../db/collections";

const LEGACY_RUN_ID = "__legacy__";

export interface CatalogConfigPayload {
  cluster_id: string;
  enabled?: boolean;
  databases: Array<{
    database_name: string;
    schemas: Array<{
      schema_name: string;
      table_names: string[];
    }>;
  }>;
}

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getDateString(value: unknown): string | null {
  let parsed: Date;
  if (value instanceof Date) {
    parsed = value;
  } else {
    if (typeof value !== "string" && typeof value !== "number") return null;
    parsed = new Date(value);
  }
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapCatalogIndexPartitions(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const result: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const doc = item as Document;
    const partitionNumber = getNumber(doc.partition_number);
    if (partitionNumber == null) continue;
    result.push({
      partition_number: partitionNumber,
      fragmentation_pct: getNumber(doc.fragmentation_pct),
      page_count: getNumber(doc.page_count),
    });
  }
  return result;
}

function getSinceDate(days?: number): Date | null {
  const parsedDays = Number(days);
  if (!Number.isFinite(parsedDays) || parsedDays <= 0) return null;
  return new Date(Date.now() - parsedDays * 24 * 60 * 60 * 1000);
}

function mapCatalogTableSummary(doc: Document): Record<string, unknown> {
  const indexes = Array.isArray(doc.indexes) ? (doc.indexes as Document[]) : [];
  const statistics = Array.isArray(doc.statistics) ? (doc.statistics as Document[]) : [];
  let maxFrag: number | null = null;
  for (const idx of indexes) {
    const frag = getNumber(idx.fragmentation_pct);
    if (frag === null) continue;
    maxFrag = maxFrag === null ? frag : Math.max(maxFrag, frag);
  }
  const staleStatsCount = statistics.filter((item) => (getNumber(item.modification_counter) ?? 0) > 0).length;
  return {
    run_id: getString(doc.run_id),
    schema_name: getString(doc.schema_name),
    table_name: getString(doc.table_name),
    row_count: getNumber(doc.row_count) ?? 0,
    max_fragmentation_pct: maxFrag,
    stale_stats_count: staleStatsCount,
    has_heap_issue: (getNumber(doc.heap_forwarded_count) ?? 0) > 0,
    captured_at: getDateString(doc.captured_at),
  };
}

function mapCatalogTable(doc: Document): Record<string, unknown> {
  const indexes = Array.isArray(doc.indexes)
    ? (doc.indexes as Document[]).map((item) => ({
      ...item,
      partitions: mapCatalogIndexPartitions((item as Document).partitions),
    }))
    : [];
  return {
    cluster_id: getString(doc.cluster_id),
    database_name: getString(doc.database_name),
    run_id: getString(doc.run_id),
    schema_name: getString(doc.schema_name),
    table_name: getString(doc.table_name),
    object_id: getNumber(doc.object_id),
    row_count: getNumber(doc.row_count) ?? 0,
    reserved_kb: getNumber(doc.reserved_kb) ?? 0,
    data_kb: getNumber(doc.data_kb) ?? 0,
    index_kb: getNumber(doc.index_kb) ?? 0,
    indexes,
    statistics: Array.isArray(doc.statistics) ? doc.statistics : [],
    heap_forwarded_count: getNumber(doc.heap_forwarded_count),
    captured_at: getDateString(doc.captured_at),
  };
}

/**
 * Returns explicit table names configured for a given db+schema, unioning across
 * multiple config entries (e.g. 3 entries same schema, different tables).
 * Returns null when any entry uses "all tables" (empty table_names) or config is absent.
 */
function getConfigTableNames(
  configDoc: Document | null,
  databaseName: string,
  schemaName: string,
): string[] | null {
  if (!configDoc?.databases) return null;
  const dbEntry = (configDoc.databases as Array<{
    database_name: string;
    schemas: Array<{ schema_name: string; table_names: string[] }>;
  }>).find((d) => d.database_name === databaseName);
  if (!dbEntry?.schemas?.length) return null;

  const schemaEntries = dbEntry.schemas.filter((s) => s.schema_name === schemaName);
  if (!schemaEntries.length) return null;

  // Any entry with empty table_names means "all tables" → fall back to snapshot
  if (schemaEntries.some((s) => !s.table_names?.length)) return null;

  const allTables = [...new Set(schemaEntries.flatMap((s) => s.table_names).filter(Boolean))];
  return allTables.length > 0 ? allTables : null;
}

function applyTableFilters(query: {
  min_frag_pct?: number;
  has_stale_stats?: boolean;
  has_heap?: boolean;
}) {
  return (item: Record<string, unknown>): boolean => {
    if (query.min_frag_pct != null && ((item.max_fragmentation_pct as number | null) ?? -1) < query.min_frag_pct) return false;
    if (query.has_stale_stats && ((item.stale_stats_count as number) ?? 0) <= 0) return false;
    if (query.has_heap && item.has_heap_issue !== true) return false;
    return true;
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns databases from catalog config (source of truth). Falls back to
 * snapshot distinct values if no config exists yet.
 */
export async function listCatalogDatabases(db: Db, clusterId: string): Promise<string[]> {
  const configDoc = await db.collection(collections.catalogConfig).findOne({ cluster_id: clusterId });
  if (configDoc?.databases?.length) {
    return (configDoc.databases as Array<{ database_name: string }>)
      .map((d) => d.database_name)
      .filter(Boolean)
      .sort();
  }
  return (await db.collection(collections.catalog).distinct("database_name", { cluster_id: clusterId })).sort();
}

/**
 * Returns schemas from catalog config for the given database. Falls back to
 * snapshot distinct values (pinned to latest run_id) if no config exists.
 */
export async function listCatalogSchemas(db: Db, clusterId: string, databaseName: string): Promise<string[]> {
  const configDoc = await db.collection(collections.catalogConfig).findOne({ cluster_id: clusterId });
  if (configDoc?.databases) {
    const dbEntry = (configDoc.databases as Array<{
      database_name: string;
      schemas: Array<{ schema_name: string }>;
    }>).find((d) => d.database_name === databaseName);
    if (dbEntry?.schemas?.length) {
      return [...new Set(dbEntry.schemas.map((s) => s.schema_name).filter(Boolean))].sort();
    }
  }
  const runId = await getLatestCatalogRunId(db, clusterId, databaseName);
  if (!runId) return [];
  return (
    await db.collection(collections.catalog).distinct("schema_name", buildCatalogRunMatch(clusterId, databaseName, runId))
  ).sort();
}

/**
 * Lists tables for a given database + schema.
 *
 * - Explicit run_id: filter to that snapshot only (historical browse).
 * - No run_id + config has specific table_names: show all configured tables,
 *   each enriched with its own latest snapshot data (ignoring run_id grouping).
 *   Tables not yet captured appear with null metrics.
 * - No run_id + config is "all tables" or absent: fall back to latest run_id snapshot.
 */
export async function listCatalogTables(
  db: Db,
  query: {
    cluster_id: string;
    database: string;
    schema: string;
    run_id?: string;
    min_frag_pct?: number;
    has_stale_stats?: boolean;
    has_heap?: boolean;
  },
): Promise<Array<Record<string, unknown>>> {
  const filterFn = applyTableFilters(query);

  // ── Explicit run_id: historical snapshot view ──────────────────────────────
  if (query.run_id) {
    const match: Record<string, unknown> = {
      ...buildCatalogRunMatch(query.cluster_id, query.database, query.run_id),
    };
    if (query.schema.trim()) match.schema_name = query.schema;
    const docs = await db.collection(collections.catalog)
      .find(match)
      .sort({ schema_name: 1, table_name: 1 })
      .toArray();
    return docs.map(mapCatalogTableSummary).filter(filterFn);
  }

  // ── No run_id: config-driven table list + per-table latest snapshot ────────
  const configDoc = await db.collection(collections.catalogConfig).findOne({ cluster_id: query.cluster_id });
  const configuredTableNames = getConfigTableNames(configDoc, query.database, query.schema);

  if (configuredTableNames !== null) {
    // Aggregate: latest snapshot document per table_name
    const docs = await db.collection(collections.catalog).aggregate([
      {
        $match: {
          cluster_id: query.cluster_id,
          database_name: query.database,
          schema_name: query.schema,
          table_name: { $in: configuredTableNames },
        },
      },
      { $sort: { captured_at: -1 } },
      { $group: { _id: "$table_name", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
      { $sort: { schema_name: 1, table_name: 1 } },
    ]).toArray();

    const capturedSet = new Set(docs.map((d) => getString(d.table_name)));

    // Tables in config but not yet captured → include with null metrics
    const uncaptured: Record<string, unknown>[] = configuredTableNames
      .filter((t) => !capturedSet.has(t))
      .map((t) => ({
        run_id: null,
        schema_name: query.schema,
        table_name: t,
        row_count: 0,
        max_fragmentation_pct: null,
        stale_stats_count: 0,
        has_heap_issue: false,
        captured_at: null,
      }));

    const allItems = [...docs.map(mapCatalogTableSummary), ...uncaptured]
      .sort((a, b) => String(a.table_name ?? "").localeCompare(String(b.table_name ?? "")));

    return allItems.filter(filterFn);
  }

  // ── Fallback: "all tables" config or no config → latest run snapshot ───────
  const runId = await getLatestCatalogRunId(db, query.cluster_id, query.database);
  if (!runId) return [];
  const match: Record<string, unknown> = buildCatalogRunMatch(query.cluster_id, query.database, runId);
  if (query.schema.trim()) match.schema_name = query.schema;
  const docs = await db.collection(collections.catalog)
    .find(match)
    .sort({ schema_name: 1, table_name: 1 })
    .toArray();
  return docs.map(mapCatalogTableSummary).filter(filterFn);
}

/**
 * Returns detail for a single table. When no run_id is provided, uses the
 * latest snapshot for that specific table (not the latest run across all tables).
 */
export async function getCatalogTable(
  db: Db,
  query: { cluster_id: string; database: string; schema: string; table: string; run_id?: string },
): Promise<Record<string, unknown> | null> {
  const runId = query.run_id || await getLatestTableRunId(db, query.cluster_id, query.database, query.schema, query.table);
  if (!runId) return null;
  const doc = await db.collection(collections.catalog).findOne({
    ...buildCatalogRunMatch(query.cluster_id, query.database, runId),
    schema_name: query.schema,
    table_name: query.table,
  });
  return doc ? mapCatalogTable(doc) : null;
}

export async function getCatalogTableHistory(
  db: Db,
  query: { cluster_id: string; database: string; schema: string; table: string; limit?: number; days?: number },
): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(Math.max(Number(query.limit || 30), 1), 100);
  const since = getSinceDate(query.days);
  const match: Record<string, unknown> = {
    cluster_id: query.cluster_id,
    database_name: query.database,
    schema_name: query.schema,
    table_name: query.table,
  };
  if (since) match.captured_at = { $gte: since };
  const docs = await db.collection(collections.catalog).aggregate([
    { $match: match },
    {
      $addFields: {
        resolved_run_id: { $ifNull: ["$run_id", LEGACY_RUN_ID] },
        max_fragmentation_pct: {
          $let: {
            vars: {
              fragValues: {
                $filter: {
                  input: {
                    $map: {
                      input: { $ifNull: ["$indexes", []] },
                      as: "idx",
                      in: "$$idx.fragmentation_pct",
                    },
                  },
                  as: "frag",
                  cond: { $ne: ["$$frag", null] },
                },
              },
            },
            in: {
              $cond: [
                { $gt: [{ $size: "$$fragValues" }, 0] },
                { $max: "$$fragValues" },
                null,
              ],
            },
          },
        },
        stale_stats_count: {
          $size: {
            $filter: {
              input: { $ifNull: ["$statistics", []] },
              as: "stat",
              cond: { $gt: [{ $ifNull: ["$$stat.modification_counter", 0] }, 0] },
            },
          },
        },
      },
    },
    { $sort: { captured_at: 1 } },
    {
      $group: {
        _id: "$resolved_run_id",
        captured_at: { $max: "$captured_at" },
        row_count: { $last: "$row_count" },
        max_fragmentation_pct: { $last: "$max_fragmentation_pct" },
        stale_stats_count: { $last: "$stale_stats_count" },
      },
    },
    { $sort: { captured_at: -1 } },
    { $limit: limit },
    { $sort: { captured_at: 1 } },
  ]).toArray();

  return docs.map((doc) => ({
    run_id: getString(doc._id) ?? LEGACY_RUN_ID,
    captured_at: getDateString(doc.captured_at),
    row_count: getNumber(doc.row_count) ?? 0,
    max_fragmentation_pct: getNumber(doc.max_fragmentation_pct),
    stale_stats_count: getNumber(doc.stale_stats_count) ?? 0,
  })).filter((item) => item.captured_at);
}

export async function getCatalogIndexHistory(
  db: Db,
  query: { cluster_id: string; database: string; schema: string; table: string; days?: number },
): Promise<Array<Record<string, unknown>>> {
  const since = getSinceDate(query.days);
  const match: Record<string, unknown> = {
    cluster_id: query.cluster_id,
    database_name: query.database,
    schema_name: query.schema,
    table_name: query.table,
  };
  if (since) match.captured_at = { $gte: since };
  const docs = await db.collection(collections.catalog).aggregate([
    { $match: match },
    { $sort: { captured_at: 1 } },
    {
      $addFields: {
        resolved_run_id: { $ifNull: ["$run_id", LEGACY_RUN_ID] },
      },
    },
    { $unwind: { path: "$indexes", preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: {
          run_id: "$resolved_run_id",
          index_id: "$indexes.index_id",
        },
        captured_at: { $last: "$captured_at" },
        index_name: { $last: "$indexes.index_name" },
        index_type: { $last: "$indexes.index_type" },
        is_partitioned: { $last: "$indexes.is_partitioned" },
        fragmentation_pct: { $last: "$indexes.fragmentation_pct" },
        page_count: { $last: "$indexes.page_count" },
        partitions: { $last: "$indexes.partitions" },
      },
    },
    { $sort: { captured_at: 1 } },
    {
      $group: {
        _id: "$_id.index_id",
        index_name: { $last: "$index_name" },
        index_type: { $last: "$index_type" },
        is_partitioned: { $last: "$is_partitioned" },
        points: {
          $push: {
            run_id: "$_id.run_id",
            captured_at: "$captured_at",
            fragmentation_pct: "$fragmentation_pct",
            page_count: "$page_count",
            partitions: "$partitions",
          },
        },
      },
    },
    { $sort: { index_name: 1, _id: 1 } },
  ]).toArray();

  return docs.map((doc) => ({
    index_id: getNumber(doc._id) ?? 0,
    index_name: getString(doc.index_name),
    index_type: getString(doc.index_type) ?? "-",
    is_partitioned: Boolean(doc.is_partitioned),
    points: Array.isArray(doc.points)
      ? (doc.points as Document[]).map((point) => ({
        run_id: getString(point.run_id) ?? LEGACY_RUN_ID,
        captured_at: getDateString(point.captured_at),
        fragmentation_pct: getNumber(point.fragmentation_pct),
        page_count: getNumber(point.page_count),
        partitions: mapCatalogIndexPartitions(point.partitions),
      })).filter((point) => point.captured_at)
      : [],
  }));
}

export async function getCatalogStatsHistory(
  db: Db,
  query: { cluster_id: string; database: string; schema: string; table: string; days?: number },
): Promise<Array<Record<string, unknown>>> {
  const since = getSinceDate(query.days);
  const match: Record<string, unknown> = {
    cluster_id: query.cluster_id,
    database_name: query.database,
    schema_name: query.schema,
    table_name: query.table,
  };
  if (since) match.captured_at = { $gte: since };
  const docs = await db.collection(collections.catalog).aggregate([
    { $match: match },
    { $sort: { captured_at: 1 } },
    {
      $addFields: {
        resolved_run_id: { $ifNull: ["$run_id", LEGACY_RUN_ID] },
      },
    },
    { $unwind: { path: "$statistics", preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: {
          run_id: "$resolved_run_id",
          stats_id: "$statistics.stats_id",
        },
        captured_at: { $last: "$captured_at" },
        stats_name: { $last: "$statistics.stats_name" },
        auto_created: { $last: "$statistics.auto_created" },
        modification_counter: { $last: "$statistics.modification_counter" },
        rows: { $last: "$statistics.rows" },
        last_updated: { $last: "$statistics.last_updated" },
      },
    },
    { $sort: { captured_at: 1 } },
    {
      $group: {
        _id: "$_id.stats_id",
        stats_name: { $last: "$stats_name" },
        auto_created: { $last: "$auto_created" },
        points: {
          $push: {
            run_id: "$_id.run_id",
            captured_at: "$captured_at",
            modification_counter: "$modification_counter",
            rows: "$rows",
            last_updated: "$last_updated",
          },
        },
      },
    },
    { $sort: { stats_name: 1, _id: 1 } },
  ]).toArray();

  return docs.map((doc) => ({
    stats_id: getNumber(doc._id) ?? 0,
    stats_name: getString(doc.stats_name) ?? "-",
    auto_created: Boolean(doc.auto_created),
    points: Array.isArray(doc.points)
      ? (doc.points as Document[]).map((point) => ({
        run_id: getString(point.run_id) ?? LEGACY_RUN_ID,
        captured_at: getDateString(point.captured_at),
        modification_counter: getNumber(point.modification_counter) ?? 0,
        rows: getNumber(point.rows) ?? 0,
        last_updated: getDateString(point.last_updated),
      })).filter((point) => point.captured_at)
      : [],
  }));
}

export async function listTableMaintenanceEvents(
  db: Db,
  query: { cluster_id: string; schema: string; table: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  const docs = await db.collection("maintenance_history")
    .find({
      cluster_id: query.cluster_id,
      schema_name: query.schema,
      table_name: query.table,
    })
    .sort({ created_at: -1, started_at: -1, _id: -1 })
    .limit(limit)
    .toArray();

  return docs.map((doc) => ({
    history_id: getString(doc.history_id) ?? getString(doc._id) ?? "",
    action_type: getString(doc.action_type) ?? "-",
    outcome: getString(doc.outcome) ?? "-",
    index_name: getString(doc.index_name),
    stats_name: getString(doc.stats_name),
    frag_before_pct: getNumber(doc.frag_before_pct ?? doc.fragmentation_before_pct),
    frag_after_pct: getNumber(doc.frag_after_pct ?? doc.fragmentation_after_pct),
    duration_ms: getNumber(doc.duration_ms),
    started_at: getDateString(doc.started_at) ?? getDateString(doc.created_at),
    finished_at: getDateString(doc.finished_at),
  })).filter((item) => item.started_at);
}

export async function listCatalogSnapshots(
  db: Db,
  clusterId: string,
  databaseName: string,
): Promise<Array<Record<string, unknown>>> {
  const docs = await db.collection(collections.catalog).aggregate([
    { $match: { cluster_id: clusterId, database_name: databaseName } },
    {
      $group: {
        _id: "$run_id",
        captured_at: { $max: "$captured_at" },
        table_count: { $sum: 1 },
      },
    },
    { $sort: { captured_at: -1 } },
    { $limit: 30 },
  ]).toArray();
  return docs
    .map((doc) => ({
      run_id: getString(doc._id) ?? LEGACY_RUN_ID,
      captured_at: getDateString(doc.captured_at),
      table_count: getNumber(doc.table_count) ?? 0,
    }))
    .filter((item) => item.run_id);
}

export async function getCatalogConfig(db: Db, clusterId: string): Promise<Record<string, unknown> | null> {
  const doc = await db.collection(collections.catalogConfig).findOne({ cluster_id: clusterId });
  if (!doc) return null;
  const { _id, ...rest } = doc as Document & { _id?: unknown };
  void _id;
  return rest;
}

export async function putCatalogConfig(db: Db, payload: CatalogConfigPayload): Promise<Record<string, unknown>> {
  if (!payload.cluster_id?.trim()) {
    throw new Error("cluster_id is required");
  }
  // Key = (db, schema, table). Cho phép nhiều entry cùng schema nếu bảng rời nhau.
  // Chặn: cùng schema mà cùng all-tables, hoặc table set giao nhau.
  for (const db_ of payload.databases ?? []) {
    const bySchema = new Map<string, Array<string[]>>();
    for (const schema of db_.schemas ?? []) {
      const key = schema.schema_name?.trim().toLowerCase();
      if (!key) continue;
      const tables = (schema.table_names ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
      const prior = bySchema.get(key) ?? [];
      for (const existing of prior) {
        const overlapAll = existing.length === 0 || tables.length === 0;
        const overlapTables = !overlapAll && existing.some((t) => tables.includes(t));
        if (overlapAll || overlapTables) {
          throw new Error(`Schema '${schema.schema_name}' trong database '${db_.database_name}' có scope entry trùng/giao bảng`);
        }
      }
      prior.push(tables);
      bySchema.set(key, prior);
    }
  }
  const doc = {
    cluster_id: payload.cluster_id.trim(),
    enabled: payload.enabled !== false,
    databases: payload.databases ?? [],
    updated_at: new Date(),
  };
  await db.collection(collections.catalogConfig).replaceOne(
    { cluster_id: doc.cluster_id },
    doc,
    { upsert: true },
  );
  return doc;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Latest run_id across all tables in a database (used as fallback for schema listing). */
async function getLatestCatalogRunId(db: Db, clusterId: string, databaseName: string): Promise<string | null> {
  const doc = await db.collection(collections.catalog).findOne(
    { cluster_id: clusterId, database_name: databaseName },
    { projection: { run_id: 1 }, sort: { captured_at: -1 } },
  );
  return getString(doc?.run_id) ?? (doc ? LEGACY_RUN_ID : null);
}

/** Latest run_id for a specific table — avoids cross-table run_id bleed. */
async function getLatestTableRunId(
  db: Db,
  clusterId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
): Promise<string | null> {
  const doc = await db.collection(collections.catalog).findOne(
    { cluster_id: clusterId, database_name: databaseName, schema_name: schemaName, table_name: tableName },
    { projection: { run_id: 1 }, sort: { captured_at: -1 } },
  );
  return getString(doc?.run_id) ?? (doc ? LEGACY_RUN_ID : null);
}

function buildCatalogRunMatch(clusterId: string, databaseName: string, runId: string): Record<string, unknown> {
  if (runId === LEGACY_RUN_ID) {
    return {
      cluster_id: clusterId,
      database_name: databaseName,
      $or: [
        { run_id: { $exists: false } },
        { run_id: null },
      ],
    };
  }
  return {
    cluster_id: clusterId,
    database_name: databaseName,
    run_id: runId,
  };
}
