import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

const dotenvCandidates = [
  path.resolve(__dirname, "..", "..", "..", ".env"),
  path.resolve(__dirname, "..", "..", "..", "..", ".env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "..", ".env"),
];

for (const dotenvPath of dotenvCandidates) {
  if (!fs.existsSync(dotenvPath)) continue;
  loadDotenv({ path: dotenvPath, override: false });
  break;
}

export interface AppConfig {
  mongodbUri: string;
  mongodbDb: string;
  maintMongoDb: string;
  l2ApiUrl?: string;
  l1ApiUrl?: string;
  actionBotToken?: string;
  apiPort: number;
  logLevel: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    mongodbUri: env.MONGODB_URI || "mongodb://127.0.0.1:27017",
    mongodbDb: env.MONGODB_DB || "db_monitor",
    maintMongoDb: env.MAINT_MONGODB_DB || "db_maintenance",
    l2ApiUrl: env.L2_API_URL || "http://127.0.0.1:8000",
    l1ApiUrl: env.L1_API_URL || "http://127.0.0.1:8001",
    actionBotToken: env.ACTION_BOT_TOKEN || "",
    apiPort: Number(env.API_PORT || 3000),
    logLevel: env.LOG_LEVEL || "info"
  };
}
