const severityEnum = ["CRITICAL", "WARNING", "INFO", ""] as const;
const alertStatusEnum = ["sent", "suppressed", "pending", ""] as const;
const blockingStatusEnum = ["blocked", "not_blocked", ""] as const;
const detectedAtPattern = "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d{1,3})?(?:Z|\\+00:00)?)?$";

export const findingsQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      finding_id: { type: "string", minLength: 1, maxLength: 128 },
      topic_id: { type: "string", minLength: 1, maxLength: 64 },
      severity: { type: "string", enum: severityEnum },
      alert_status: { type: "string", enum: alertStatusEnum },
      issue_type: { type: "string", minLength: 1, maxLength: 64 },
      node: { type: "string", minLength: 1, maxLength: 128 },
      status: { type: "string", minLength: 1, maxLength: 64 },
      blocking_status: { type: "string", enum: blockingStatusEnum },
      since: { type: "string", maxLength: 64, pattern: detectedAtPattern },
      until: { type: "string", maxLength: 64, pattern: detectedAtPattern },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      page: { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false
  }
} as const;

export const findingsTimelineQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      topic_id: { type: "string", minLength: 1, maxLength: 64 },
      severity: { type: "string", enum: severityEnum },
      alert_status: { type: "string", enum: alertStatusEnum },
      blocking_status: { type: "string", enum: blockingStatusEnum },
      since: { type: "string", maxLength: 64, pattern: detectedAtPattern },
      until: { type: "string", maxLength: 64, pattern: detectedAtPattern },
      interval_minutes: { type: "integer", minimum: 1, maximum: 1440, default: 30 }
    },
    additionalProperties: false
  }
} as const;
