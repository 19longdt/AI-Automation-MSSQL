export const idParamsSchema = {
  params: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, maxLength: 128 }
    },
    required: ["id"],
    additionalProperties: false
  }
} as const;

export const paginationQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    page: { type: "integer", minimum: 0, default: 0 }
  },
  additionalProperties: false
} as const;
