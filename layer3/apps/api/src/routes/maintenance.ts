import { FastifyInstance } from "fastify";
import {
  maintenanceCampaignSummarySchema,
  maintenanceWindowGetSchema,
  maintenanceWindowPutSchema,
  maintenanceWindowEnabledSchema,
  maintenanceWindowKillSwitchSchema,
  maintenanceHistorySchema,
  maintenanceQueueSchema,
  maintenanceSummarySchema,
  queueBulkActionSchema,
  queueItemActionSchema,
} from "../schemas/maintenance.schema";
import {
  getCampaignSummary,
  getWindowConfig,
  getMaintenanceSummary,
  listMaintenanceHistory,
  listMaintenanceQueue,
  MaintenanceCampaignSummaryParams,
  MaintenanceSummaryQuery,
  MaintenanceHistoryQuery,
  MaintenanceQueueQuery,
  upsertWindowConfig,
  setWindowEnabled,
  setKillSwitch
} from "../services/maintenance-service";
import { createMaintenanceCommand } from "../services/command-service";
import {
  bulkQueueAction,
  type BulkQueueActionBody,
  isQueueActionServiceError,
  type QueueItemAction,
  updateQueueItemAction,
} from "../services/queue-action-service";
import { registerCatalogRoutes } from "./catalog";

interface QueueItemActionParams {
  itemId: string;
}

interface QueueItemActionBody {
  action: QueueItemAction;
}

export async function registerMaintenanceRoutes(app: FastifyInstance) {
  await registerCatalogRoutes(app);
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

  app.get<{ Params: MaintenanceCampaignSummaryParams }>(
    "/api/maintenance/campaigns/:campaignId/summary",
    { schema: maintenanceCampaignSummarySchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const summary = await getCampaignSummary(app.getMaintDb(), req.params);
        if (!summary) return reply.code(404).send({ message: "Campaign not found" });
        return reply.send(summary);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, params: req.params }, "getCampaignSummary failed");
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

  app.patch<{ Params: QueueItemActionParams; Body: QueueItemActionBody }>(
    "/api/maintenance/queue/:itemId",
    {
      schema: queueItemActionSchema,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const item = await updateQueueItemAction(app.getMaintDb(), req.params.itemId, req.body.action);
        return reply.send(item);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, params: req.params, body: req.body }, "updateQueueItemAction failed");
        if (isQueueActionServiceError(err)) {
          return reply.code(err.statusCode).send({ message: err.message });
        }
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.post<{ Body: BulkQueueActionBody }>(
    "/api/maintenance/queue/bulk-action",
    {
      schema: queueBulkActionSchema,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const result = await bulkQueueAction(app.getMaintDb(), req.body);
        return reply.send(result);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, body: req.body }, "bulkQueueAction failed");
        if (isQueueActionServiceError(err)) {
          return reply.code(err.statusCode).send({ message: err.message });
        }
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.post("/api/maintenance/commands", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      return reply.code(202).send(await createMaintenanceCommand(app.getMaintDb(), req.body as never));
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, body: req.body }, "createMaintenanceCommand failed");
      const msg = err instanceof Error ? err.message : "Internal server error";
      const isValidation = msg.includes("required") || msg.includes("must be");
      return reply.code(isValidation ? 400 : 500).send({ message: msg });
    }
  });

  app.get<{ Querystring: { cluster_id: string } }>(
    "/api/maintenance/window",
    { schema: maintenanceWindowGetSchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const config = await getWindowConfig(app.getMaintDb(), req.query.cluster_id);
        return reply.send(config);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, query: req.query }, "getWindowConfig failed");
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.put(
    "/api/maintenance/window",
    { schema: maintenanceWindowPutSchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        await upsertWindowConfig(app.getMaintDb(), req.body as never);
        return reply.code(204).send();
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, body: req.body }, "upsertWindowConfig failed");
        const msg = err instanceof Error ? err.message : "Internal server error";
        const isValidation = msg.includes("required") || msg.includes("must be");
        return reply.code(isValidation ? 400 : 500).send({ message: msg });
      }
    }
  );

  app.patch(
    "/api/maintenance/window/enabled",
    { schema: maintenanceWindowEnabledSchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const body = req.body as { cluster_id: string; enabled: boolean };
        await setWindowEnabled(app.getMaintDb(), body.cluster_id, body.enabled);
        return reply.code(204).send();
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, body: req.body }, "setWindowEnabled failed");
        const msg = err instanceof Error ? err.message : "Internal server error";
        return reply.code(msg.includes("not found") ? 404 : 500).send({ message: msg });
      }
    }
  );

  app.patch(
    "/api/maintenance/window/kill-switch",
    { schema: maintenanceWindowKillSwitchSchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const body = req.body as { cluster_id: string; kill_switch: boolean };
        await setKillSwitch(app.getMaintDb(), body.cluster_id, body.kill_switch);
        return reply.code(204).send();
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, body: req.body }, "setKillSwitch failed");
        const msg = err instanceof Error ? err.message : "Internal server error";
        const isNotFound = msg.includes("not found");
        return reply.code(isNotFound ? 404 : 500).send({ message: msg });
      }
    }
  );
}
