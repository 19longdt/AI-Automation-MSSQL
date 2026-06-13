import { FastifyInstance } from "fastify";
import { getInsights, getInsightsSummary } from "../services/insights-service";
import { insightsQuerySchema, insightsSummaryQuerySchema } from "../schemas/insights.schema";

interface InsightsSummaryQuery {
  days?: number;
}

interface InsightsQuery {
  issue_type?: string;
  table?: string;
  resolved?: string;
  priority?: string;
  limit?: number;
  page?: number;
}

export async function registerInsightRoutes(app: FastifyInstance) {
  app.get<{ Querystring: InsightsSummaryQuery }>(
    "/api/insights/summary",
    { schema: insightsSummaryQuerySchema },
    async (req, reply) => {
      try {
        if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
        const data = await getInsightsSummary(app.getDb(), app.config.l2ApiUrl, req.query.days);
        return reply.send(data);
      } catch (err: unknown) {
        app.log.error({ err, url: req.url, query: req.query }, "getInsightsSummary failed");
        return reply.code(500).send({ message: "Internal server error" });
      }
    }
  );

  app.get<{ Querystring: InsightsQuery }>("/api/insights", { schema: insightsQuerySchema }, async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const queryString = new URLSearchParams(
        Object.entries(req.query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]])
      ).toString();
      const data = await getInsights(app.getDb(), app.config.l2ApiUrl, queryString);
      return reply.send(data);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, query: req.query }, "getInsights failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });
}
