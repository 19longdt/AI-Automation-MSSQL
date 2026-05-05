import { FastifyInstance } from "fastify";
import { getAnalysisById, listAnalyses } from "../services/analyses-service";

export async function registerAnalysisRoutes(app: FastifyInstance) {
  app.get("/api/analyses", async (req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const q = req.query as Record<string, string>;
    const items = await listAnalyses(app.getDb(), Number(q.limit || 50), Number(q.page || 0));
    return reply.send(items);
  });

  app.get("/api/analyses/:id", async (req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const { id } = req.params as { id: string };
    const doc = await getAnalysisById(app.getDb(), id);
    if (!doc) return reply.code(404).send({ message: "Not found" });
    return reply.send(doc);
  });
}
