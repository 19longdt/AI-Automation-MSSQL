import { FastifyInstance } from "fastify";
import { postJsonWithTimeout } from "../proxy/l2-proxy";
import { getUpstreamError, type UpstreamError } from "../proxy/upstream-error";
import { planAnalyzeBodySchema } from "../schemas/plan.schema";

interface PlanAnalyzeBody {
  plan_xml: string;
}

export async function registerPlanRoutes(app: FastifyInstance) {
  app.post<{ Body: PlanAnalyzeBody }>("/api/plan/analyze", { schema: planAnalyzeBodySchema }, async (req, reply) => {
    const planXml = req.body.plan_xml.trim();

    try {
      if (!planXml) {
        return reply.code(400).send({ message: "plan_xml is required" });
      }
      if (!app.config.l2ApiUrl) {
        return reply.code(503).send({ message: "Layer2 API URL is not configured" });
      }

      const result = await postJsonWithTimeout(
        `${app.config.l2ApiUrl}/api/v1/plan/analyze`,
        { plan_xml: planXml, source: "layer3" },
        15000
      );
      return reply.send(result);
    } catch (err: unknown) {
      const upstreamError = getUpstreamError(err);
      app.log.error({ err, url: req.url }, "plan analyze failed");
      return reply.code(502).send({
        message: "Failed to analyze plan via Layer2",
        upstream_status: upstreamError.status ?? null,
        upstream_error: upstreamError.payload ?? { message: upstreamError.message ?? "Unknown error" }
      });
    }
  });
}
