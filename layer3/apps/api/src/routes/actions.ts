import { FastifyInstance } from "fastify";
import { postJsonWithTimeoutAndHeaders } from "../proxy/l2-proxy";

export async function registerActionRoutes(app: FastifyInstance) {
  app.post("/api/actions/kill-session", async (req, reply) => {
    const body = (req.body || {}) as { session_id?: number | string; node?: string };
    const rawSessionId = body.session_id;
    const node = typeof body.node === "string" ? body.node.trim() : "";
    const sessionId = Number(rawSessionId);
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      return reply.code(400).send({ message: "Invalid session_id" });
    }

    const layer1Url = app.config.l1ApiUrl;
    if (!layer1Url) {
      return reply.code(503).send({ message: "Layer1 API URL is not configured" });
    }

    try {
      const headers: Record<string, string> = {};
      if (app.config.actionBotToken) {
        headers.Authorization = `Bearer ${app.config.actionBotToken}`;
      }
      const result = await postJsonWithTimeoutAndHeaders(
        `${layer1Url}/kill-session`,
        {
          type: "action",
          action_name: "kill-session",
          session_id: sessionId,
          node
        },
        8000,
        headers
      );
      return reply.send({
        flow: "action",
        ok: true,
        session_id: sessionId,
        node,
        action_name: "kill-session",
        target: layer1Url,
        result
      });
    } catch (e: any) {
      app.log.error({ err: e, sessionId, layer1Url }, "Failed to call Layer1 action bot kill-session");
      return reply.code(502).send({
        flow: "action",
        ok: false,
        message: "Failed to call Layer1 kill-session API",
        session_id: sessionId,
        action_name: "kill-session",
        target: layer1Url,
        upstream_status: e && e.status ? e.status : null,
        upstream_error: e && e.payload ? e.payload : { message: e && e.message ? e.message : "Unknown error" }
      });
    }
  });
}
