const campaignStatusEnum = [
  "PENDING",
  "DISCOVERING",
  "DISCOVERY_FAILED",
  "ACTIVE",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  ""
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

export const campaignListSchema = {
  querystring: {
    type: "object",
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 12 },
      status: { type: "string", enum: campaignStatusEnum },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      page: { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false
  }
} as const;

export const campaignCreateSchema = {
  body: {
    type: "object",
    required: ["cluster_id", "name", "start_date", "end_date"],
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 12 },
      name: { type: "string", minLength: 1, maxLength: 100 },
      description: { type: "string", maxLength: 500 },
      start_date: { type: "string", pattern: isoDatePattern },
      end_date: { type: "string", pattern: isoDatePattern },
      scan_times: scanTimesSchema
    },
    additionalProperties: false
  }
} as const;

export const campaignUpdateSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 64 }
    },
    additionalProperties: false
  },
  body: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100 },
      description: { type: "string", maxLength: 500 },
      end_date: { type: "string", pattern: isoDatePattern },
      scan_times: scanTimesSchema
    },
    additionalProperties: false,
    minProperties: 1
  }
} as const;

export const campaignIdParamSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 64 }
    },
    additionalProperties: false
  }
} as const;
