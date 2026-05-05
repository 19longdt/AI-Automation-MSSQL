import { FastifyInstance } from "fastify";
import { listTopics } from "../services/topics-service";

export async function registerTopicRoutes(app: FastifyInstance) {
  app.get("/api/topics", async (_req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const docs = await listTopics(app.getDb());
    return reply.send(docs);
  });
}
