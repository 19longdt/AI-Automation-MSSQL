import { FastifyInstance } from "fastify";
import { getInsights, getInsightsSummary } from "../services/insights-service";

export async function registerInsightRoutes(app: FastifyInstance) {
  app.get("/api/insights/summary", async (req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const q = req.query as Record<string, string>;
    const days = Number(q.days || 30);
    const data = await getInsightsSummary(app.getDb(), app.config.l2ApiUrl, days);
    return reply.send(data);
  });

  app.get("/api/insights", async (req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const data = await getInsights(app.getDb(), app.config.l2ApiUrl, queryString);
    return reply.send(data);
  });
}
