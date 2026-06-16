export interface UpstreamError {
  status?: number;
  payload?: unknown;
  message?: string;
}

export function getUpstreamError(err: unknown): UpstreamError {
  if (typeof err !== "object" || err === null) {
    return {};
  }
  return err as UpstreamError;
}
