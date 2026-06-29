import { FastifyInstance } from "fastify";
import { fetchJsonWithTimeout } from "../proxy/l2-proxy";
import { getUpstreamError } from "../proxy/upstream-error";
import {
  getCatalogConfig,
  getCatalogIndexHistory,
  getCatalogStatsHistory,
  getCatalogTable,
  getCatalogTableHistory,
  listCatalogDatabases,
  listCatalogSnapshots,
  listTableMaintenanceEvents,
  listCatalogSchemas,
  listCatalogTables,
  putCatalogConfig,
} from "../services/catalog-service";

export async function registerCatalogRoutes(app: FastifyInstance) {
  app.get("/api/maintenance/catalog/live-tables", async (req, reply) => {
    try {
      if (!app.config.l1ApiUrl) return reply.code(503).send({ message: "Layer 1 not configured" });
      const query = req.query as Record<string, unknown>;
      const params = new URLSearchParams({
        cluster_id: String(query.cluster_id || "").trim(),
        database: String(query.database || "").trim(),
        schema: String(query.schema || "").trim(),
      });
      const data = await fetchJsonWithTimeout(`${app.config.l1ApiUrl}/catalog/tables?${params.toString()}`, 10_000);
      return reply.send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(upstream.status ?? 502).send(upstream.payload ?? { message: upstream.message ?? "Failed to load live tables" });
    }
  });

  app.get("/api/maintenance/catalog/databases", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const clusterId = String((req.query as Record<string, unknown>).cluster_id || "").trim();
      return reply.send(await listCatalogDatabases(app.getMaintDb(), clusterId));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "listCatalogDatabases failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/schemas", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const query = req.query as Record<string, unknown>;
      return reply.send(
        await listCatalogSchemas(
          app.getMaintDb(),
          String(query.cluster_id || "").trim(),
          String(query.database || "").trim(),
        ),
      );
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "listCatalogSchemas failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/tables", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const query = req.query as Record<string, unknown>;
      return reply.send(
        await listCatalogTables(app.getMaintDb(), {
          cluster_id: String(query.cluster_id || "").trim(),
          database: String(query.database || "").trim(),
          schema: String(query.schema || "").trim(),
          run_id: String(query.run_id || "").trim() || undefined,
          min_frag_pct: query.min_frag_pct != null ? Number(query.min_frag_pct) : undefined,
          has_stale_stats: String(query.has_stale_stats || "").toLowerCase() === "true",
          has_heap: String(query.has_heap || "").toLowerCase() === "true",
        }),
      );
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "listCatalogTables failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/snapshots", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const query = req.query as Record<string, unknown>;
      return reply.send(
        await listCatalogSnapshots(
          app.getMaintDb(),
          String(query.cluster_id || "").trim(),
          String(query.database || "").trim(),
        ),
      );
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "listCatalogSnapshots failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/table", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const query = req.query as Record<string, unknown>;
      return reply.send(await getCatalogTable(app.getMaintDb(), {
        cluster_id: String(query.cluster_id || "").trim(),
        database: String(query.database || "").trim(),
        schema: String(query.schema || "").trim(),
        table: String(query.table || "").trim(),
        run_id: String(query.run_id || "").trim() || undefined,
      }));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "getCatalogTable failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/table-history", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const query = req.query as Record<string, unknown>;
      return reply.send(await getCatalogTableHistory(app.getMaintDb(), {
        cluster_id: String(query.cluster_id || "").trim(),
        database: String(query.database || "").trim(),
        schema: String(query.schema || "").trim(),
        table: String(query.table || "").trim(),
        limit: query.limit != null ? Number(query.limit) : undefined,
        days: query.days != null ? Number(query.days) : undefined,
      }));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "getCatalogTableHistory failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/table-index-history", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const query = req.query as Record<string, unknown>;
      return reply.send(await getCatalogIndexHistory(app.getMaintDb(), {
        cluster_id: String(query.cluster_id || "").trim(),
        database: String(query.database || "").trim(),
        schema: String(query.schema || "").trim(),
        table: String(query.table || "").trim(),
        days: query.days != null ? Number(query.days) : undefined,
      }));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "getCatalogIndexHistory failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/table-stats-history", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const query = req.query as Record<string, unknown>;
      return reply.send(await getCatalogStatsHistory(app.getMaintDb(), {
        cluster_id: String(query.cluster_id || "").trim(),
        database: String(query.database || "").trim(),
        schema: String(query.schema || "").trim(),
        table: String(query.table || "").trim(),
        days: query.days != null ? Number(query.days) : undefined,
      }));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "getCatalogStatsHistory failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/table-events", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const query = req.query as Record<string, unknown>;
      return reply.send(await listTableMaintenanceEvents(app.getMaintDb(), {
        cluster_id: String(query.cluster_id || "").trim(),
        schema: String(query.schema || "").trim(),
        table: String(query.table || "").trim(),
        limit: query.limit != null ? Number(query.limit) : undefined,
      }));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "listTableMaintenanceEvents failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get("/api/maintenance/catalog/config", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const clusterId = String((req.query as Record<string, unknown>).cluster_id || "").trim();
      return reply.send(await getCatalogConfig(app.getMaintDb(), clusterId));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "getCatalogConfig failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.put("/api/maintenance/catalog/config", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      return reply.send(await putCatalogConfig(app.getMaintDb(), req.body as never));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, body: req.body }, "putCatalogConfig failed");
      return reply.code(500).send({ message: err instanceof Error ? err.message : "Internal server error" });
    }
  });
}
