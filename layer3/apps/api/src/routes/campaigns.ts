import { FastifyInstance } from "fastify";
import {
  campaignCreateSchema,
  campaignIdParamSchema,
  campaignListSchema,
  campaignUpdateSchema,
} from "../schemas/campaigns.schema";
import {
  cancelCampaign,
  CampaignCreateBody,
  CampaignListQuery,
  CampaignUpdateBody,
  createCampaign,
  isCampaignServiceError,
  listCampaigns,
  updateCampaign,
} from "../services/campaign-service";

interface CampaignIdParams {
  id: string;
}

export async function registerCampaignRoutes(app: FastifyInstance) {
  app.get<{ Querystring: CampaignListQuery }>(
    "/api/maintenance/campaigns",
    { schema: campaignListSchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const result = await listCampaigns(app.getMaintDb(), req.query);
        reply.header("X-Total-Count", String(result.total));
        return reply.send(result);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, query: req.query }, "listCampaigns failed");
        if (isCampaignServiceError(err)) {
          return reply.code(err.statusCode).send({ message: err.message });
        }
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.post<{ Body: CampaignCreateBody }>(
    "/api/maintenance/campaigns",
    {
      schema: campaignCreateSchema,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const created = await createCampaign(app.getMaintDb(), req.body);
        return reply.code(201).send(created);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, body: req.body }, "createCampaign failed");
        if (isCampaignServiceError(err)) {
          return reply.code(err.statusCode).send({ message: err.message });
        }
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.put<{ Params: CampaignIdParams; Body: CampaignUpdateBody }>(
    "/api/maintenance/campaigns/:id",
    {
      schema: campaignUpdateSchema,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const updated = await updateCampaign(app.getMaintDb(), req.params.id, req.body);
        return reply.send(updated);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, params: req.params, body: req.body }, "updateCampaign failed");
        if (isCampaignServiceError(err)) {
          return reply.code(err.statusCode).send({ message: err.message });
        }
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.delete<{ Params: CampaignIdParams }>(
    "/api/maintenance/campaigns/:id",
    {
      schema: campaignIdParamSchema,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const updated = await cancelCampaign(app.getMaintDb(), req.params.id);
        return reply.send(updated);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, params: req.params }, "cancelCampaign failed");
        if (isCampaignServiceError(err)) {
          return reply.code(err.statusCode).send({ message: err.message });
        }
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );
}
