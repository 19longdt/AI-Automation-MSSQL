import { FastifyInstance } from "fastify";
import {
  maintenanceHistorySchema,
  maintenanceQueueSchema,
  maintenanceSummarySchema
} from "../schemas/maintenance.schema";
import {
  getMaintenanceSummary,
  listMaintenanceHistory,
  listMaintenanceQueue,
  MaintenanceSummaryQuery,
  MaintenanceHistoryQuery,
  MaintenanceQueueQuery
} from "../services/maintenance-service";

export async function registerMaintenanceRoutes(app: FastifyInstance) {
  app.get<{ Querystring: MaintenanceSummaryQuery }>(
    "/api/maintenance/summary",
    { schema: maintenanceSummarySchema },
    async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const summary = await getMaintenanceSummary(app.getMaintDb(), req.query);
      return reply.send(summary);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "getMaintenanceSummary failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
    }
  );

  app.get<{ Querystring: MaintenanceQueueQuery }>(
    "/api/maintenance/queue",
    { schema: maintenanceQueueSchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const result = await listMaintenanceQueue(app.getMaintDb(), req.query);
        reply.header("X-Total-Count", String(result.total));
        return reply.send(result);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, query: req.query }, "listMaintenanceQueue failed");
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.get<{ Querystring: MaintenanceHistoryQuery }>(
    "/api/maintenance/history",
    { schema: maintenanceHistorySchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const result = await listMaintenanceHistory(app.getMaintDb(), req.query);
        reply.header("X-Total-Count", String(result.total));
        return reply.send(result);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, query: req.query }, "listMaintenanceHistory failed");
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );
}
