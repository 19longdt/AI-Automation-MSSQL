import { FastifyInstance } from "fastify";
import {
  deleteJsonWithTimeout,
  fetchJsonWithTimeout,
  postJsonWithTimeout,
  putJsonWithTimeout,
} from "../proxy/l2-proxy";
import { getUpstreamError } from "../proxy/upstream-error";
import { getTopicOverrides, setTopicOverrides, TopicOverridesMap } from "../services/topic-overrides-service";

interface ClusterIdParams {
  id: string;
}

const CLUSTER_TEST_TIMEOUT_MS = 75_000;

export async function registerClusterRoutes(app: FastifyInstance) {
  app.get("/api/clusters", async (_req, reply) => {
    try {
      if (!app.config.l1ApiUrl) return reply.code(503).send({ message: "Layer1 API URL is not configured" });
      const data = await fetchJsonWithTimeout(`${app.config.l1ApiUrl}/clusters`, 10_000);
      return reply.send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(502).send({ message: upstream.message ?? "Failed to load clusters", upstream_error: upstream.payload });
    }
  });

  app.post("/api/clusters", async (req, reply) => {
    try {
      const data = await postJsonWithTimeout(`${app.config.l1ApiUrl}/clusters`, req.body, 10_000);
      return reply.code(201).send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(upstream.status ?? 502).send(upstream.payload ?? { message: upstream.message ?? "Failed to create cluster" });
    }
  });

  app.get<{ Params: ClusterIdParams }>("/api/clusters/:id", async (req, reply) => {
    try {
      const data = await fetchJsonWithTimeout(`${app.config.l1ApiUrl}/clusters/${encodeURIComponent(req.params.id)}`, 10_000);
      return reply.send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(upstream.status ?? 502).send(upstream.payload ?? { message: upstream.message ?? "Failed to load cluster" });
    }
  });

  app.get<{ Params: ClusterIdParams }>("/api/clusters/:id/topic-overrides", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const overrides = await getTopicOverrides(app.getDb(), req.params.id);
      if (overrides === null) return reply.code(404).send({ message: "Cluster not found" });
      return reply.send(overrides);
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, params: req.params }, "getTopicOverrides failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.patch<{ Params: ClusterIdParams; Body: TopicOverridesMap }>("/api/clusters/:id/topic-overrides", async (req, reply) => {
    try {
      if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
      const updated = await setTopicOverrides(app.getDb(), req.params.id, req.body ?? {});
      if (!updated) return reply.code(404).send({ message: "Cluster not found" });
      return reply.send({ ok: true, cluster_id: req.params.id, topic_overrides: req.body ?? {} });
    } catch (err: unknown) {
      app.log.error({ err, url: req.url, params: req.params }, "setTopicOverrides failed");
      return reply.code(500).send({ message: "Internal server error" });
    }
  });

  app.put<{ Params: ClusterIdParams }>("/api/clusters/:id", async (req, reply) => {
    try {
      const data = await putJsonWithTimeout(`${app.config.l1ApiUrl}/clusters/${encodeURIComponent(req.params.id)}`, req.body, 10_000);
      return reply.send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(upstream.status ?? 502).send(upstream.payload ?? { message: upstream.message ?? "Failed to update cluster" });
    }
  });

  app.delete<{ Params: ClusterIdParams }>("/api/clusters/:id", async (req, reply) => {
    try {
      const data = await deleteJsonWithTimeout(`${app.config.l1ApiUrl}/clusters/${encodeURIComponent(req.params.id)}`, 10_000);
      return reply.send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(upstream.status ?? 502).send(upstream.payload ?? { message: upstream.message ?? "Failed to delete cluster" });
    }
  });

  app.post<{ Params: ClusterIdParams }>("/api/clusters/:id/test", async (req, reply) => {
    try {
      app.log.info({ clusterId: req.params.id }, "Proxying cluster test to Layer1");
      const data = await postJsonWithTimeout(
        `${app.config.l1ApiUrl}/clusters/${encodeURIComponent(req.params.id)}/test`,
        {},
        CLUSTER_TEST_TIMEOUT_MS
      );
      return reply.send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(upstream.status ?? 502).send(upstream.payload ?? { message: upstream.message ?? "Failed to test cluster" });
    }
  });

  app.post<{ Params: ClusterIdParams }>("/api/clusters/:id/refresh-roles", async (req, reply) => {
    try {
      app.log.info({ clusterId: req.params.id }, "Proxying refresh-roles to Layer1");
      const data = await postJsonWithTimeout(
        `${app.config.l1ApiUrl}/clusters/${encodeURIComponent(req.params.id)}/refresh-roles`,
        {},
        30_000
      );
      return reply.send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(upstream.status ?? 502).send(upstream.payload ?? { message: upstream.message ?? "Failed to refresh roles" });
    }
  });

  app.post("/api/clusters/test", async (req, reply) => {
    try {
      app.log.info("Proxying ad-hoc cluster test to Layer1");
      const data = await postJsonWithTimeout(`${app.config.l1ApiUrl}/clusters/test`, req.body, CLUSTER_TEST_TIMEOUT_MS);
      return reply.send(data);
    } catch (err: unknown) {
      const upstream = getUpstreamError(err);
      return reply.code(upstream.status ?? 502).send(upstream.payload ?? { message: upstream.message ?? "Failed to test cluster" });
    }
  });
}
