import { parseWallClockDate, toDateTimeLocalValue } from "./format";

export type TimeRangeMode = "preset" | "relative" | "absolute";

export interface PresetTimeRange {
  mode: "preset";
  presetId: string;
  label?: string;
}

export interface RelativeTimeRange {
  mode: "relative";
  amount: number;
  unit: "minutes" | "hours" | "days" | "weeks" | "months";
  label?: string;
}

export interface AbsoluteTimeRange {
  mode: "absolute";
  from: string;
  to: string;
  label?: string;
}

export type TimeRangeState = PresetTimeRange | RelativeTimeRange | AbsoluteTimeRange;

export interface ResolvedTimeRange {
  label: string;
  from: Date;
  to: Date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

function shiftDate(d: Date, amount: number, unit: string): Date {
  const x = new Date(d.getTime());
  if (unit === "minutes") x.setMinutes(x.getMinutes() + amount);
  else if (unit === "hours") x.setHours(x.getHours() + amount);
  else if (unit === "days") x.setDate(x.getDate() + amount);
  else if (unit === "weeks") x.setDate(x.getDate() + amount * 7);
  else if (unit === "months") x.setMonth(x.getMonth() + amount);
  return x;
}

export const PRESETS: Array<{ id: string; label: string }> = [
  { id: "last_1_minute",   label: "Last 1 minute"  },
  { id: "last_15_minutes", label: "Last 15 minutes" },
  { id: "last_30_minutes", label: "Last 30 minutes" },
  { id: "last_1_hour",     label: "Last 1 hour"     },
  { id: "last_24_hours",   label: "Last 24 hours"   },
  { id: "today",           label: "Today"           },
  { id: "this_week",       label: "This week"       },
  { id: "last_7_days",     label: "Last 7 days"     },
  { id: "last_30_days",    label: "Last 30 days"    },
];

function resolvePreset(id: string, now: Date): ResolvedTimeRange {
  if (id === "today")        return { label: "Today",        from: startOfDay(now), to: now };
  if (id === "this_week")    return { label: "This week",    from: startOfWeek(now), to: now };
  if (id === "last_1_minute")  return { label: "Last 1 minute",  from: shiftDate(now, -1, "minutes"), to: now };
  if (id === "last_15_minutes") return { label: "Last 15 minutes", from: shiftDate(now, -15, "minutes"), to: now };
  if (id === "last_30_minutes") return { label: "Last 30 minutes", from: shiftDate(now, -30, "minutes"), to: now };
  if (id === "last_1_hour")  return { label: "Last 1 hour",  from: shiftDate(now, -1, "hours"), to: now };
  if (id === "last_24_hours") return { label: "Last 24 hours", from: shiftDate(now, -24, "hours"), to: now };
  if (id === "last_7_days")  return { label: "Last 7 days",  from: shiftDate(now, -7, "days"), to: now };
  if (id === "last_30_days") return { label: "Last 30 days", from: shiftDate(now, -30, "days"), to: now };
  return { label: "Last 1 hour", from: shiftDate(now, -1, "hours"), to: now };
}

export function resolveTimeRange(state: TimeRangeState | null, now?: Date): ResolvedTimeRange {
  const anchor = now ?? new Date();
  if (!state) return resolvePreset("last_1_hour", anchor);

  if (state.mode === "preset") return { ...resolvePreset(state.presetId, anchor), label: state.label ?? resolvePreset(state.presetId, anchor).label };

  if (state.mode === "relative") {
    const amount = Math.max(1, state.amount);
    return {
      label: state.label ?? `Last ${amount} ${state.unit}`,
      from: shiftDate(anchor, -amount, state.unit),
      to: anchor,
    };
  }

  if (state.mode === "absolute") {
    const from = parseWallClockDate(state.from);
    const to = parseWallClockDate(state.to);
    if (from && to && !isNaN(from.getTime()) && !isNaN(to.getTime())) {
      return { label: state.label ?? "Custom range", from, to };
    }
  }

  return resolvePreset("last_1_hour", anchor);
}

export function chooseTimelineIntervalMinutes(from: Date, to: Date): number {
  const minutes = Math.max(1, (to.getTime() - from.getTime()) / 60000);
  if (minutes <= 180) return 5;
  if (minutes <= 1440) return 30;
  if (minutes <= 4320) return 60;
  if (minutes <= 20160) return 180;
  if (minutes <= 64800) return 720;
  return 1440;
}

export function makeAbsoluteRange(from: Date, to: Date, label = "Custom range"): AbsoluteTimeRange {
  return { mode: "absolute", from: toDateTimeLocalValue(from), to: toDateTimeLocalValue(to), label };
}
