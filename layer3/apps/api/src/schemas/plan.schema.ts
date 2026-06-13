export const planAnalyzeBodySchema = {
  body: {
    type: "object",
    properties: {
      plan_xml: { type: "string", minLength: 1, maxLength: 1000000 }
    },
    required: ["plan_xml"],
    additionalProperties: false
  }
} as const;
