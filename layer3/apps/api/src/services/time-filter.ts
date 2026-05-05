export function applyDetectedAtRangeFilter(
  filter: Record<string, unknown>,
  since?: string,
  until?: string
) {
  const sinceDate = parseDateQueryParam(since);
  const untilDate = parseDateQueryParam(until);
  if (!sinceDate && !untilDate) return;

  // Use $convert so this works for both Date and ISO-string stored detected_at values.
  const detectedAtAsDate = {
    $convert: {
      input: "$detected_at",
      to: "date",
      onError: null,
      onNull: null
    }
  };

  const andExpr: any[] = [{ $ne: [detectedAtAsDate, null] }];
  if (sinceDate) andExpr.push({ $gte: [detectedAtAsDate, sinceDate] });
  if (untilDate) andExpr.push({ $lte: [detectedAtAsDate, untilDate] });

  filter.$expr = andExpr.length === 1 ? andExpr[0] : { $and: andExpr };
}

function parseDateQueryParam(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
