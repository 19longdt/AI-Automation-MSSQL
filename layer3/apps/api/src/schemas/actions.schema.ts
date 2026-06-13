export const killSessionBodySchema = {
  body: {
    type: "object",
    properties: {
      session_id: { type: "integer", minimum: 1, maximum: 32767 },
      node: { type: "string", maxLength: 64, default: "" }
    },
    required: ["session_id"],
    additionalProperties: false
  }
} as const;
