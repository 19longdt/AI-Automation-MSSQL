import { idParamsSchema, paginationQuerySchema } from "./common.schema";

export const analysesQuerySchema = {
  querystring: paginationQuerySchema
} as const;

export const analysisByIdSchema = idParamsSchema;
