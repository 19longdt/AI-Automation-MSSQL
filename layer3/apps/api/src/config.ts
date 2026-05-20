import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env") });

export interface AppConfig {
  mongodbUri: string;
  mongodbDb: string;
  l2ApiUrl?: string;
  l1ApiUrl?: string;
  apiPort: number;
  logLevel: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    mongodbUri: env.MONGODB_URI || "mongodb://127.0.0.1:27017",
    mongodbDb: env.MONGODB_DB || "db_monitor",
    l2ApiUrl: env.L2_API_URL || "http://127.0.0.1:8000",
    l1ApiUrl: env.L1_API_URL || "http://127.0.0.1:8001",
    apiPort: Number(env.API_PORT || 3000),
    logLevel: env.LOG_LEVEL || "info"
  };
}
