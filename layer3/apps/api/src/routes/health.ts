import { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async (req, reply) => {
    try {
      const mongoOk = app.mongoReady === true;
      const l2Ok = await app.checkL2();
      return reply.send({ status: mongoOk ? "ok" : "degraded", mongodb: mongoOk, l2: l2Ok });
    } catch (err: unknown) {
      app.log.error({ err, url: req.url }, "health check failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });
}
