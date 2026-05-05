import { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    const mongoOk = app.mongoReady === true;
    const l2Ok = await app.checkL2();
    return reply.send({ status: mongoOk ? "ok" : "degraded", mongodb: mongoOk, l2: l2Ok });
  });
}
