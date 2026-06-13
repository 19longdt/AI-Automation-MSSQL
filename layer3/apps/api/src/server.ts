import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { Db } from "mongodb";
import { AppConfig } from "./config";
import { registerHealthRoutes } from "./routes/health";
import { registerFindingRoutes } from "./routes/findings";
import { registerAnalysisRoutes } from "./routes/analyses";
import { registerInsightRoutes } from "./routes/insights";
import { registerTopicRoutes } from "./routes/topics";
import { registerJobRoutes } from "./routes/jobs";
import { registerActionRoutes } from "./routes/actions";
import { registerPlanRoutes } from "./routes/plan";
import { fetchJsonWithTimeout } from "./proxy/l2-proxy";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    mongoReady: boolean;
    getDb(): Db;
    checkL2(): Promise<boolean>;
  }
}

export async function createServer(config: AppConfig, db: Db | null, mongoReady: boolean) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      serializers: {
        req(req) {
          return { method: req.method, url: req.url, reqId: req.id };
        }
      }
    },
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "reqId"
  });
  app.decorate("config", config);
  app.decorate("mongoReady", mongoReady);
  app.decorate("getDb", () => {
    if (!db) throw new Error("MongoDB is unavailable");
    return db;
  });
  app.decorate("checkL2", async () => {
    if (!config.l2ApiUrl) return false;
    try {
      await fetchJsonWithTimeout(`${config.l2ApiUrl}/health`, 3000);
      return true;
    } catch {
      return false;
    }
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { global: false });

  // __dirname = layer3/apps/api/dist at runtime
  // repoRoot = layer3/
  const repoRoot = path.resolve(__dirname, "../../..");
  const dist2Root = path.join(repoRoot, "dist-v2");

  // Vite build output: dist-v2/assets/ → served at /assets/*
  // decorateReply defaults to true → attaches reply.sendFile to all handlers below.
  await app.register(fastifyStatic, {
    root: path.join(dist2Root, "assets"),
    prefix: "/assets/",
  });

  // Legacy static assets — qp.js diagram library + qp.css + qp_icons.png
  await app.register(fastifyStatic, {
    root: path.join(repoRoot, "dist"),
    prefix: "/dist/",
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: path.join(repoRoot, "css"),
    prefix: "/css/",
    decorateReply: false,
  });
  // qp_icons.png is referenced by qp.css as a relative url — also expose at root level
  // so both /css/qp_icons.png and /qp_icons.png resolve correctly
  app.get("/qp_icons.png", async (_req, reply) => {
    return reply.sendFile("qp_icons.png", path.join(repoRoot, "css"));
  });

  // React SPA — all page routes serve the same index.html
  app.get("/",                   async (_req, reply) => reply.sendFile("index.html", dist2Root));
  app.get("/dashboard",          async (_req, reply) => reply.sendFile("index.html", dist2Root));
  app.get("/insights",           async (_req, reply) => reply.sendFile("index.html", dist2Root));
  app.get("/query-plan",         async (_req, reply) => reply.sendFile("index.html", dist2Root));
  app.get("/extract-query-plan", async (_req, reply) => reply.sendFile("index.html", dist2Root));
  app.get("/history",            async (_req, reply) => reply.sendFile("index.html", dist2Root));

  await registerHealthRoutes(app);
  await registerFindingRoutes(app);
  await registerAnalysisRoutes(app);
  await registerInsightRoutes(app);
  await registerTopicRoutes(app);
  await registerJobRoutes(app);
  await registerActionRoutes(app);
  await registerPlanRoutes(app);

  app.setNotFoundHandler(async (_req, reply) => reply.code(404).send({ message: "Not found" }));

  return app;
}
