import { FastifyInstance } from "fastify";
import { getJobsHealth } from "../services/jobs-service";

export async function registerJobRoutes(app: FastifyInstance) {
  app.get("/api/jobs/health", async (_req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const docs = await getJobsHealth(app.getDb());
    return reply.send(docs);
  });
}
