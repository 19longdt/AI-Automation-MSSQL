import { FastifyInstance } from "fastify";
import { listTopics } from "../services/topics-service";

export async function registerTopicRoutes(app: FastifyInstance) {
  app.get("/api/topics", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const docs = await listTopics(app.getDb());
      return reply.send(docs);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "listTopics failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });
}
