import { FastifyInstance } from "fastify";
import { postJsonWithTimeout } from "../proxy/l2-proxy";

export async function registerPlanRoutes(app: FastifyInstance) {
  app.post("/api/plan/analyze", async (req, reply) => {
    const body = (req.body || {}) as { plan_xml?: string };
    const planXml = typeof body.plan_xml === "string" ? body.plan_xml.trim() : "";

    if (!planXml) {
      return reply.code(400).send({ message: "plan_xml is required" });
    }
    if (!app.config.l2ApiUrl) {
      return reply.code(503).send({ message: "Layer2 API URL is not configured" });
    }

    try {
      const result = await postJsonWithTimeout(
        `${app.config.l2ApiUrl}/api/v1/plan/analyze`,
        { plan_xml: planXml, source: "layer3" },
        15000
      );
      return reply.send(result);
    } catch (e: any) {
      app.log.error({ err: e }, "Failed to call Layer2 plan analyze");
      return reply.code(502).send({
        message: "Failed to analyze plan via Layer2",
        upstream_status: e && e.status ? e.status : null,
        upstream_error: e && e.payload ? e.payload : { message: e && e.message ? e.message : "Unknown error" }
      });
    }
  });
}

