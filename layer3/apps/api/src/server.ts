import Fastify from "fastify";
import cors from "@fastify/cors";
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
  const app = Fastify({ logger: { level: config.logLevel } });
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

  // __dirname = layer3/apps/api/dist at runtime
  const repoRoot = path.resolve(__dirname, "../../..");

  await app.register(fastifyStatic, {
    root: path.join(repoRoot, "dist"),
    prefix: "/dist/"
  });
  await app.register(fastifyStatic, {
    root: path.join(repoRoot, "examples"),
    prefix: "/examples/",
    decorateReply: false
  });
  await app.register(fastifyStatic, {
    root: path.join(repoRoot, "css"),
    prefix: "/css/",
    decorateReply: false
  });
  await app.register(fastifyStatic, {
    root: path.join(repoRoot, "apps/web/css"),
    prefix: "/apps/web/css/",
    decorateReply: false
  });
  await app.register(fastifyStatic, {
    root: path.join(repoRoot, "assets"),
    prefix: "/assets/",
    decorateReply: false
  });
  await app.register(fastifyStatic, {
    root: path.join(repoRoot, "images"),
    prefix: "/images/",
    decorateReply: false
  });

  app.get("/", async (_req, reply) => reply.sendFile("index.html", path.join(repoRoot, "examples")));
  app.get("/history", async (_req, reply) => reply.sendFile("index.html", path.join(repoRoot, "examples")));
  app.get("/extract-query-plan", async (_req, reply) => reply.sendFile("query-plan.html", path.join(repoRoot, "apps/web/pages")));
  app.get("/query-plan", async (_req, reply) => reply.sendFile("query-plan.html", path.join(repoRoot, "apps/web/pages")));
  app.get("/dashboard", async (_req, reply) => reply.sendFile("dashboard.html", path.join(repoRoot, "apps/web/pages")));
  app.get("/insights", async (_req, reply) => reply.sendFile("insights.html", path.join(repoRoot, "apps/web/pages")));

  await registerHealthRoutes(app);
  await registerFindingRoutes(app);
  await registerAnalysisRoutes(app);
  await registerInsightRoutes(app);
  await registerTopicRoutes(app);
  await registerJobRoutes(app);

  app.setNotFoundHandler(async (_req, reply) => reply.code(404).send({ message: "Not found" }));

  return app;
}
