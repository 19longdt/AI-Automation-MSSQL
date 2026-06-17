import { FastifyInstance } from "fastify";
import { getJobsHealth } from "../services/jobs-service";

export async function registerJobRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { cluster_id?: string } }>("/api/jobs/health", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const docs = await getJobsHealth(app.getDb(), req.query.cluster_id);
      return reply.send(docs);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "getJobsHealth failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });
}
