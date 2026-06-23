import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(uri: string, dbName: string): Promise<Db> {
  if (db) return db;
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 2000,
    connectTimeoutMS: 2000,
    socketTimeoutMS: 5000
  });
  await client.connect();
  db = client.db(dbName);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("MongoDB is not connected");
  return db;
}

export function getDbByName(name: string): Db {
  if (!client) throw new Error("MongoDB is not connected");
  return client.db(name);
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
  }
  client = null;
  db = null;
}
