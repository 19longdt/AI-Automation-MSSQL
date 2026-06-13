import { FastifyInstance } from "fastify";
import { getAnalysisById, listAnalyses } from "../services/analyses-service";
import { analysisByIdSchema, analysesQuerySchema } from "../schemas/analyses.schema";

interface AnalysesQuery {
  limit?: number;
  page?: number;
}

interface IdParams {
  id: string;
}

export async function registerAnalysisRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AnalysesQuery }>("/api/analyses", { schema: analysesQuerySchema }, async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const items = await listAnalyses(app.getDb(), req.query.limit, req.query.page);
      return reply.send(items);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, query: req.query }, "listAnalyses failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.get<{ Params: IdParams }>("/api/analyses/:id", { schema: analysisByIdSchema }, async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const doc = await getAnalysisById(app.getDb(), req.params.id);
      if (!doc) return reply.code(404).send({ message: "Not found" });
      return reply.send(doc);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, params: req.params }, "getAnalysisById failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });
}
