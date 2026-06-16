const resolvedEnum = ["true", "false", ""] as const;

export const insightsSummaryQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      days: { type: "integer", minimum: 1, maximum: 365, default: 30 }
    },
    additionalProperties: false
  }
} as const;

export const insightsQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      issue_type: { type: "string", minLength: 1, maxLength: 128 },
      table: { type: "string", minLength: 1, maxLength: 128 },
      resolved: { type: "string", enum: resolvedEnum },
      priority: { type: "string", minLength: 1, maxLength: 32 },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      page:  { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false
  }
} as const;
