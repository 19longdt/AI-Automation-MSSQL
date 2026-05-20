import { FastifyInstance } from "fastify";
import { postJsonWithTimeout } from "../proxy/l2-proxy";

export async function registerActionRoutes(app: FastifyInstance) {
  app.post("/api/actions/kill-session", async (req, reply) => {
    const body = (req.body || {}) as { session_id?: number | string };
    const rawSessionId = body.session_id;
    const sessionId = Number(rawSessionId);
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      return reply.code(400).send({ message: "Invalid session_id" });
    }

    if (!app.config.l1ApiUrl) {
      return reply.code(503).send({ message: "Layer1 API URL is not configured" });
    }

    try {
      const result = await postJsonWithTimeout(
        `${app.config.l1ApiUrl}/kill-session`,
        { session_id: sessionId },
        8000
      );
      return reply.send({
        ok: true,
        session_id: sessionId,
        target: app.config.l1ApiUrl,
        result
      });
    } catch (e: any) {
      app.log.error({ err: e, sessionId }, "Failed to call Layer1 kill-session");
      return reply.code(502).send({
        ok: false,
        message: "Failed to call Layer1 kill-session API",
        session_id: sessionId
      });
    }
  });
}
