const campaignStatusEnum = [
  "PENDING",
  "DISCOVERING",
  "DISCOVERY_FAILED",
  "ACTIVE",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "",
] as const;

const isoDatePattern = "^\\d{4}-\\d{2}-\\d{2}(T[\\d:.Z+-]+)?$";
const scanTimePattern = "^([01]\\d|2[0-3]):[0-5]\\d$";

const scanTimesSchema = {
  type: "array",
  items: { type: "string", pattern: scanTimePattern },
  minItems: 1,
  maxItems: 10,
  uniqueItems: true,
} as const;

const scopeTableSchema = {
  type: "object",
  required: ["schema_name"],
  properties: {
    schema_name: { type: "string", minLength: 1 },
    table_names: { type: "array", items: { type: "string" }, default: [] },
  },
  additionalProperties: false,
} as const;

const scopeDatabaseSchema = {
  type: "object",
  required: ["database_name", "schemas"],
  properties: {
    database_name: { type: "string", minLength: 1 },
    schemas: { type: "array", items: scopeTableSchema, minItems: 1 },
  },
  additionalProperties: false,
} as const;

const thresholdsSchema = {
  type: "object",
  properties: {
    index: {
      type: "object",
      properties: {
        reorganize_pct: { type: "number", minimum: 0, maximum: 100, nullable: true },
        rebuild_pct: { type: "number", minimum: 0, maximum: 100, nullable: true },
        min_page_count: { type: "integer", minimum: 0, nullable: true },
        max_page_count: { type: "integer", minimum: 0, nullable: true },
      },
      additionalProperties: false,
      nullable: true,
    },
    statistic: {
      type: "object",
      properties: {
        modification_threshold: { type: "integer", minimum: 0, nullable: true },
        stats_min_sample_pct: { type: "number", minimum: 0, maximum: 100, nullable: true },
      },
      additionalProperties: false,
      nullable: true,
    },
    heap: {
      type: "object",
      properties: {
        forwarded_threshold: { type: "integer", minimum: 0, nullable: true },
      },
      additionalProperties: false,
      nullable: true,
    },
  },
  additionalProperties: false,
} as const;

const windowOverrideSchema = {
  type: "object",
  required: ["start", "end", "time_budget_minutes"],
  properties: {
    start: { type: "string", pattern: scanTimePattern },
    end: { type: "string", pattern: scanTimePattern },
    time_budget_minutes: { type: "integer", minimum: 30, maximum: 1440 },
  },
  additionalProperties: false,
} as const;

export const campaignListSchema = {
  querystring: {
    type: "object",
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 32 },
      status: { type: "string", enum: campaignStatusEnum },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      page: { type: "integer", minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
} as const;

export const campaignCreateSchema = {
  body: {
    type: "object",
    required: ["cluster_id", "name", "start_date", "end_date"],
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 32 },
      name: { type: "string", minLength: 1, maxLength: 100 },
      description: { type: "string", maxLength: 500 },
      start_date: { type: "string", pattern: isoDatePattern },
      end_date: { type: "string", pattern: isoDatePattern },
      scan_times: scanTimesSchema,
      scope: { type: "array", items: scopeDatabaseSchema, nullable: true, default: null },
      thresholds: { ...thresholdsSchema, nullable: true, default: null },
      window_override: { ...windowOverrideSchema, nullable: true, default: null },
      execution_types: {
        type: "array",
        items: { type: "string", enum: ["index", "statistic", "heap"] },
        minItems: 1,
        uniqueItems: true,
        default: ["index", "statistic", "heap"],
      },
    },
    additionalProperties: false,
  },
} as const;

export const campaignUpdateSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 64 },
    },
    additionalProperties: false,
  },
  body: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100 },
      description: { type: "string", maxLength: 500 },
      end_date: { type: "string", pattern: isoDatePattern },
      scan_times: scanTimesSchema,
      scope: { type: "array", items: scopeDatabaseSchema, nullable: true, default: null },
      thresholds: { ...thresholdsSchema, nullable: true, default: null },
      window_override: { ...windowOverrideSchema, nullable: true, default: null },
      execution_types: {
        type: "array",
        items: { type: "string", enum: ["index", "statistic", "heap"] },
        minItems: 1,
        uniqueItems: true,
      },
    },
    additionalProperties: false,
    minProperties: 1,
  },
} as const;

export const campaignIdParamSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 64 },
    },
    additionalProperties: false,
  },
} as const;
