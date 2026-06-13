import { useState } from "react";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useDashboardStore } from "@/store/dashboard.store";
import { useTimeRange } from "@/hooks/useTimeRange";
import { PRESETS, makeAbsoluteRange, resolveTimeRange } from "@/lib/time-range";
import { formatDateTime, formatDateTimeShort, toDateTimeLocalValue } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ManualRefreshButton } from "@/components/shared/LiveIndicator";
import { cn } from "@/lib/utils";

export function TimeRangePicker() {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]   = useState("");
  const { timeRange, setTimeRange } = useDashboardStore();
  const resolved = useTimeRange();

  function applyPreset(presetId: string, label: string) {
    setTimeRange({ mode: "preset", presetId, label });
    setOpen(false);
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    setTimeRange(makeAbsoluteRange(new Date(customFrom), new Date(customTo)));
    setOpen(false);
  }

  function shift(direction: 1 | -1) {
    const duration = Math.max(60_000, resolved.to.getTime() - resolved.from.getTime());
    const delta = duration * direction;
    setTimeRange(makeAbsoluteRange(
      new Date(resolved.from.getTime() + delta),
      new Date(resolved.to.getTime() + delta),
      "Shifted range",
    ));
  }

  const label = resolved.label;
  const rangeText = `${formatDateTimeShort(resolved.from)} -> ${formatDateTimeShort(resolved.to)}`;

  return (
    <div className="relative flex items-center gap-1">
      <div
        className="max-w-[210px] truncate pr-2 text-[11px] text-[var(--color-muted)] font-code"
        title={`${formatDateTime(resolved.from)} -> ${formatDateTime(resolved.to)}`}
      >
        {rangeText}
      </div>

      <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Shift range back" className="h-8 w-7">
        <ChevronLeft className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setCustomFrom(toDateTimeLocalValue(resolved.from));
          setCustomTo(toDateTimeLocalValue(resolved.to));
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="gap-1.5 max-w-[260px]"
      >
        <CalendarClock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate text-[12px]">{label}</span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-180")} />
      </Button>

      <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Shift range forward" className="h-8 w-7">
        <ChevronRight className="w-3.5 h-3.5" />
      </Button>

      <ManualRefreshButton />

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Time range picker"
            className="absolute right-0 top-full mt-1 z-50 w-[340px] rounded-xl border border-[var(--color-border-2)] bg-[var(--color-surface)] shadow-xl overflow-hidden animate-[fade-in_120ms_ease]"
          >
            {/* Presets */}
            <div className="p-3 border-b border-[var(--color-border)]">
              <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">Quick presets</p>
              <div className="grid grid-cols-2 gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id, p.label)}
                    className={cn(
                      "px-2.5 py-1.5 text-[12px] rounded-md text-left transition-colors cursor-pointer",
                      timeRange.mode === "preset" && (timeRange as { presetId: string }).presetId === p.id
                        ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)] font-medium"
                        : "text-[var(--color-text-2)] hover:bg-[var(--color-row-hover)]",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom range */}
            <div className="p-3">
              <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">Custom range</p>
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-[11px] text-[var(--color-muted)] mb-0.5 block">From</label>
                  <input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-md border border-[var(--color-border-2)] bg-[var(--color-surface-2)] text-[12px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[var(--color-muted)] mb-0.5 block">To</label>
                  <input
                    type="datetime-local"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-md border border-[var(--color-border-2)] bg-[var(--color-surface-2)] text-[12px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
                <Button variant="primary" size="sm" onClick={applyCustom} disabled={!customFrom || !customTo}>
                  Apply range
                </Button>
              </div>
            </div>

            {/* Current range display */}
            <div className="px-3 pb-3 text-[11px] text-[var(--color-muted)] font-code">
              {formatDateTime(resolved.from)} → {formatDateTime(resolved.to)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
