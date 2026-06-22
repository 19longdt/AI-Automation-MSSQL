function normalizeDetectedAtFilterValue(value?: string): string | null {
  if (!value) {
    return null;
  }

  const raw = value.trim();
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(?:Z|\+00:00)?$/
  );
  if (!match) {
    return null;
  }

  const second = match[4] ?? "00";
  const millisecond = (match[5] ?? "000").padEnd(3, "0").slice(0, 3);
  return `${match[1]}T${match[2]}:${match[3]}:${second}.${millisecond}+00:00`;
}

export function parseDetectedAtFilterDate(value?: string): Date | null {
  const normalized = normalizeDetectedAtFilterValue(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildDetectedAtDateRangeMatch(
  since?: string,
  until?: string
): Record<string, Date> | null {
  const sinceValue = parseDetectedAtFilterDate(since);
  const untilValue = parseDetectedAtFilterDate(until);
  if (!sinceValue && !untilValue) {
    return null;
  }

  const detectedAtFilter: Record<string, Date> = {};
  if (sinceValue) {
    detectedAtFilter.$gte = sinceValue;
  }
  if (untilValue) {
    detectedAtFilter.$lte = untilValue;
  }

  return detectedAtFilter;
}

export function applyDetectedAtRangeFilter(
  filter: Record<string, unknown>,
  since?: string,
  until?: string
): void {
  const sinceValue = normalizeDetectedAtFilterValue(since);
  const untilValue = normalizeDetectedAtFilterValue(until);
  if (!sinceValue && !untilValue) {
    return;
  }

  const detectedAtFilter: Record<string, string> = {};
  if (sinceValue) {
    detectedAtFilter.$gte = sinceValue;
  }
  if (untilValue) {
    detectedAtFilter.$lte = untilValue;
  }

  filter.detected_at = detectedAtFilter;
}
