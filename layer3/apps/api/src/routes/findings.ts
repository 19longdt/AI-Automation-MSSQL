import { FastifyInstance } from "fastify";
import { listFindings, getFindingById } from "../services/findings-service";
import { getDiagnosticsByFindingId } from "../services/findings-diagnostics-service";

export async function registerFindingRoutes(app: FastifyInstance) {
  app.get("/api/findings", async (req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const q = req.query as Record<string, string>;
    const { total, items } = await listFindings(app.getDb(), q);
    reply.header("X-Total-Count", String(total));
    return reply.send(items);
  });

  app.get("/api/findings/:id", async (req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const { id } = req.params as { id: string };
    const doc = await getFindingById(app.getDb(), id);
    if (!doc) return reply.code(404).send({ message: "Not found" });
    return reply.send(doc);
  });

  app.get("/api/findings/:id/diagnostics", async (req, reply) => {
    if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
    const { id } = req.params as { id: string };
    const doc = await getDiagnosticsByFindingId(app.getDb(), id);
    if (!doc) return reply.code(404).send({ message: "Not found" });
    return reply.send(doc);
  });
}
