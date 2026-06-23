import { FastifyInstance } from "fastify";
import { getDiagnosticsByFindingId } from "../services/findings-diagnostics-service";
import { getAgSecondaryStatus, getFindingById, getFindingTimeline, getSlowQueryStats, listFindings } from "../services/findings-service";
import { idParamsSchema } from "../schemas/common.schema";
import { findingsQuerySchema, findingsTimelineQuerySchema, slowQueryStatsQuerySchema } from "../schemas/findings.schema";

interface FindingsRouteQuery {
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

interface FindingsTimelineRouteQuery {
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

interface SlowQueryStatsRouteQuery {
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

interface IdParams {
  id: string;
}

export async function registerFindingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: FindingsRouteQuery }>("/api/findings", { schema: findingsQuerySchema }, async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const { total, items } = await listFindings(app.getDb(), req.query);
      reply.header("X-Total-Count", String(total));
      return reply.send({ total, items });
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, query: req.query }, "listFindings failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get<{ Querystring: FindingsTimelineRouteQuery }>(
    "/api/findings/timeline",
    { schema: findingsTimelineQuerySchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const timeline = await getFindingTimeline(app.getDb(), req.query);
        return reply.send(timeline);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, query: req.query }, "getFindingTimeline failed");
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.get<{ Querystring: SlowQueryStatsRouteQuery }>(
    "/api/findings/slow-query-stats",
    { schema: slowQueryStatsQuerySchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const stats = await getSlowQueryStats(app.getDb(), req.query);
        return reply.send(stats);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, query: req.query }, "getSlowQueryStats failed");
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.get<{ Querystring: { cluster_id?: string } }>(
    "/api/findings/ag-secondary-status",
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const status = await getAgSecondaryStatus(app.getDb(), req.query.cluster_id ?? "");
        return reply.send(status);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url }, "getAgSecondaryStatus failed");
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.get<{ Params: IdParams }>("/api/findings/:id", { schema: idParamsSchema }, async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const doc = await getFindingById(app.getDb(), req.params.id);
      if (!doc) return reply.code(404).send({ message: "Not found" });
      return reply.send(doc);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, params: req.params }, "getFindingById failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get<{ Params: IdParams }>("/api/findings/:id/diagnostics", { schema: idParamsSchema }, async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const doc = await getDiagnosticsByFindingId(app.getDb(), req.params.id);
      if (!doc) return reply.code(404).send({ message: "Not found" });
      return reply.send(doc);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, params: req.params }, "getDiagnosticsByFindingId failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });
}
