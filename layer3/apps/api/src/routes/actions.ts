import { FastifyInstance } from "fastify";
import { postJsonWithTimeoutAndHeaders } from "../proxy/l2-proxy";
import { getUpstreamError, type UpstreamError } from "../proxy/upstream-error";
import { killSessionBodySchema } from "../schemas/actions.schema";

interface KillSessionBody {
  session_id: number;
  node?: string;
  cluster_id?: string;
}

export async function registerActionRoutes(app: FastifyInstance) {
  app.post<{ Body: KillSessionBody }>(
    "/api/actions/kill-session",
    {
      schema: killSessionBodySchema,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
    },
    async (req, reply) => {
      const sessionId = req.body.session_id;
      const node = req.body.node?.trim() ?? "";
      const clusterId = req.body.cluster_id?.trim() ?? "";

      try {
        const layer1Url = app.config.l1ApiUrl;
        if (!layer1Url) {
          return reply.code(503).send({ message: "Layer1 API URL is not configured" });
        }

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
            node,
            cluster_id: clusterId || undefined
          },
          20000,
          headers
        );

        return reply.send({
          flow: "action",
          ok: true,
          session_id: sessionId,
          node,
          cluster_id: clusterId || undefined,
          action_name: "kill-session",
          target: layer1Url,
          result
        });
      } catch (err: unknown) {
        const upstreamError = getUpstreamError(err);
        app.log.error(
          { err, url: req.url, sessionId, node, layer1Url: app.config.l1ApiUrl },
          "kill-session failed"
        );
        return reply.code(502).send({
          flow: "action",
          ok: false,
          message: "Failed to call Layer1 kill-session API",
          session_id: sessionId,
          action_name: "kill-session",
          target: app.config.l1ApiUrl,
          upstream_status: upstreamError.status ?? null,
          upstream_error: upstreamError.payload ?? { message: upstreamError.message ?? "Unknown error" }
        });
      }
    }
  );
}
