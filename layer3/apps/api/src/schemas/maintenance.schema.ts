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
      status: { type: "string", enum: workItemStatusEnum },
      action_type: { type: "string", enum: actionTypeEnum },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      page: { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false
  }
} as const;

export const maintenanceHistorySchema = {
  querystring: {
    type: "object",
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
      outcome: { type: "string", enum: maintenanceOutcomeEnum },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      page: { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false
  }
} as const;
