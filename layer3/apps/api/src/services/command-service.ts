import { randomUUID } from "node:crypto";
import { Db } from "mongodb";
import { collections } from "../db/collections";

export interface MaintenanceCommandCreateBody {
  cluster_id: string;
  type: "run_catalog" | "run_discovery";
  catalog_scope?: Array<{
    database_name: string;
    schemas: Array<{
      schema_name: string;
      table_names: string[];
    }>;
  }>;
}

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function createCommandId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function normalizeCatalogScope(value: unknown): MaintenanceCommandCreateBody["catalog_scope"] {
  if (!Array.isArray(value)) return undefined;
  const databases = value
    .map((db) => {
      if (!db || typeof db !== "object") return null;
      const databaseName = getString((db as { database_name?: unknown }).database_name);
      const schemasValue = (db as { schemas?: unknown }).schemas;
      if (!databaseName || !Array.isArray(schemasValue) || !schemasValue.length) return null;
      const schemas = schemasValue
        .map((schema) => {
          if (!schema || typeof schema !== "object") return null;
          const schemaName = getString((schema as { schema_name?: unknown }).schema_name);
          const tableNamesValue = (schema as { table_names?: unknown }).table_names;
          if (!schemaName || !Array.isArray(tableNamesValue)) return null;
          return {
            schema_name: schemaName,
            table_names: tableNamesValue
              .map((table) => getString(table))
              .filter((table): table is string => Boolean(table)),
          };
        })
        .filter(
          (
            schema,
          ): schema is {
            schema_name: string;
            table_names: string[];
          } => Boolean(schema),
        );
      if (!schemas.length) return null;
      return { database_name: databaseName, schemas };
    })
    .filter(
      (
        db,
      ): db is {
        database_name: string;
        schemas: Array<{
          schema_name: string;
          table_names: string[];
        }>;
      } => Boolean(db),
    );
  return databases.length ? databases : undefined;
}

export async function createMaintenanceCommand(
  db: Db,
  payload: MaintenanceCommandCreateBody,
): Promise<Record<string, unknown>> {
  const clusterId = getString(payload.cluster_id);
  if (!clusterId) throw new Error("cluster_id is required");
  if (payload.type !== "run_catalog" && payload.type !== "run_discovery") {
    throw new Error("type must be run_catalog or run_discovery");
  }
  const catalogScope = normalizeCatalogScope(payload.catalog_scope);
  if (payload.type !== "run_catalog" && catalogScope) {
    throw new Error("catalog_scope is only supported for run_catalog");
  }

  const doc = {
    command_id: createCommandId(),
    cluster_id: clusterId,
    type: payload.type,
    ...(catalogScope ? { catalog_scope: catalogScope } : {}),
    status: "pending",
    requested_at: new Date(),
    claimed_at: null,
    finished_at: null,
    error: null,
  };
  await db.collection(collections.maintenanceCommands).insertOne(doc);
  const { _id, ...result } = doc as typeof doc & { _id?: unknown };
  return result;
}
