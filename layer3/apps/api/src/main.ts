import { closeMongo, connectMongo, getDb } from "./db/client";
import { readConfig } from "./config";
import { createServer } from "./server";

async function main() {
  const config = readConfig();
  let mongoReady = false;

  if (config.mongodbUri && config.mongodbDb) {
    try {
      await connectMongo(config.mongodbUri, config.mongodbDb);
      mongoReady = true;
    } catch (err) {
      console.warn("MongoDB connect failed. Starting in degraded mode.", err);
    }
  } else {
    console.warn("MONGODB_URI/MONGODB_DB are not set. Starting in degraded mode.");
  }

  const app = await createServer(config, mongoReady ? getDb() : null, mongoReady);

  const shutdown = async () => {
    await app.close();
    await closeMongo();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: config.apiPort, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
