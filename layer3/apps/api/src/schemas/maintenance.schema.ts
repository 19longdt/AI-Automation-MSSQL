const workItemStatusEnum = [
  "AWAITING_APPROVAL",
  "APPROVED",
  "RUNNING",
  "PAUSED",
  "DONE",
  "FAILED",
  "SKIPPED",
  "EXPIRED",
  ""
] as const;

const actionTypeEnum = [
  "REORGANIZE",
  "REBUILD",
  "REBUILD_PARTITION",
  "UPDATE_STATISTICS",
  "HEAP_REBUILD",
  ""
] as const;

const maintenanceOutcomeEnum = [
  "DONE",
  "FAILED",
  "SKIPPED",
  "PAUSED",
  "ABORTED",
  "DRY_RUN",
  ""
] as const;

export const maintenanceSummarySchema = {
  querystring: {
    type: "object",
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 }
    },
    additionalProperties: false
  }
} as const;

export const maintenanceQueueSchema = {
  querystring: {
    type: "object",
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
      campaign_id: { type: "string", minLength: 1, maxLength: 128 },
      status: { type: "string", enum: workItemStatusEnum },
      action_type: { type: "string", enum: actionTypeEnum },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      page: { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false
  }
} as const;

export const queueItemActionSchema = {
  params: {
    type: "object",
    required: ["itemId"],
    properties: {
      itemId: { type: "string", minLength: 1, maxLength: 64 },
    },
    additionalProperties: false,
  },
  body: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["approve", "reject", "skip", "reset"] },
    },
    additionalProperties: false,
  },
} as const;

export const queueBulkActionSchema = {
  body: {
    type: "object",
    required: ["action", "cluster_id"],
    properties: {
      action: { type: "string", enum: ["approve", "reject", "skip"] },
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
      item_ids: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 64 },
        maxItems: 200,
      },
      campaign_id: { type: "string", minLength: 1, maxLength: 128 },
      batch_id: { type: "string", minLength: 1, maxLength: 128 },
    },
    additionalProperties: false,
  },
} as const;

export const maintenanceHistorySchema = {
  querystring: {
    type: "object",
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
      campaign_id: { type: "string", minLength: 1, maxLength: 128 },
      outcome: { type: "string", enum: maintenanceOutcomeEnum },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      page: { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false
  }
} as const;

export const maintenanceCampaignSummarySchema = {
  params: {
    type: "object",
    required: ["campaignId"],
    properties: {
      campaignId: { type: "string", minLength: 1, maxLength: 128 },
    },
    additionalProperties: false,
  },
} as const;

const timePattern = "^([01]\\d|2[0-3]):[0-5]\\d$";

const windowSlotSchema = {
  type: "object",
  required: ["start", "end", "time_budget_minutes"],
  properties: {
    start: { type: "string", pattern: timePattern },
    end: { type: "string", pattern: timePattern },
    time_budget_minutes: { type: "integer", minimum: 30, maximum: 1440 },
  },
  additionalProperties: false,
} as const;

export const maintenanceWindowGetSchema = {
  querystring: {
    type: "object",
    required: ["cluster_id"],
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
    },
    additionalProperties: false,
  },
} as const;

export const maintenanceWindowPutSchema = {
  body: {
    type: "object",
    required: ["cluster_id", "enabled", "kill_switch", "default", "day_overrides", "gates"],
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
      enabled: { type: "boolean" },
      kill_switch: { type: "boolean" },
      default: windowSlotSchema,
      day_overrides: {
        type: "object",
        patternProperties: {
          "^[0-6]$": {
            anyOf: [
              windowSlotSchema,
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      gates: {
        type: "object",
        required: [
          "cpu_max_pct",
          "active_requests_max",
          "log_send_queue_max_kb",
          "redo_queue_max_kb",
        ],
        properties: {
          cpu_max_pct: { anyOf: [{ type: "number" }, { type: "null" }] },
          active_requests_max: { anyOf: [{ type: "integer" }, { type: "null" }] },
          log_send_queue_max_kb: { anyOf: [{ type: "integer" }, { type: "null" }] },
          redo_queue_max_kb: { anyOf: [{ type: "integer" }, { type: "null" }] },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
} as const;

export const maintenanceWindowEnabledSchema = {
  body: {
    type: "object",
    required: ["cluster_id", "enabled"],
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
      enabled: { type: "boolean" },
    },
    additionalProperties: false,
  },
} as const;

export const maintenanceWindowKillSwitchSchema = {
  body: {
    type: "object",
    required: ["cluster_id", "kill_switch"],
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
      kill_switch: { type: "boolean" },
    },
    additionalProperties: false,
  },
} as const;
