import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshingOverlay } from "@/components/dashboard/AsyncState";
import { formatDateTime, parseWallClockDate } from "@/lib/format";
import { useDashboardStore } from "@/store/dashboard.store";
import type { TimelineResponse, TimelineBucket } from "@/types";

interface Props {
  data: TimelineResponse | null | undefined;
  isLoading: boolean;
  isFetching?: boolean;
}

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

function formatChartTick(d: Date, intMin: number): string {
  if (intMin >= 1440) return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  if (intMin >= 180)  return `${pad2(d.getHours())}:00`;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function floorTimeToMinutes(ts: number, minutes: number): number {
  const step = minutes * 60_000;
  return ts - (ts % step);
}
function ceilTimeToMinutes(ts: number, minutes: number): number {
  const step = minutes * 60_000;
  const r = ts % step;
  return r === 0 ? ts : ts + (step - r);
}

function buildNiceTicks(max: number): number[] {
  const m = Math.max(1, Math.ceil(max));
  let step = Math.max(1, Math.ceil(m / 4));
  if (step > 5) {
    const exp = Math.floor(Math.log10(step));
    const base = Math.pow(10, exp);
    const f = step / base;
    step = Math.round((f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * base);
  }
  return Array.from({ length: 5 }, (_, i) => step * i);
}

function chooseXAxisLabelMinutes(intervalMin: number, rangeMin: number, plotWidth: number): number {
  const maxLabels = Math.max(1, Math.floor(plotWidth / 80));
  const rawStep = Math.max(intervalMin, Math.ceil(rangeMin / maxLabels));
  const choices = [intervalMin, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]
    .filter((c) => c >= intervalMin && c % intervalMin === 0)
    .sort((a, b) => a - b);
  return choices.find((c) => c >= rawStep) ?? rawStep;
}

export function TimelineChart({ data, isLoading, isFetching = false }: Props) {
  const svgRef  = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef  = useRef<HTMLDivElement>(null);
  const { theme } = useDashboardStore();

  // Trigger redraws on resize — don't store width in state to avoid stale initial render
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setResizeTick((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-read CSS vars whenever theme changes so SVG colors stay in sync
  const colors = useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      grid:     s.getPropertyValue("--color-border").trim()    || "#e2e8f0",
      axis:     s.getPropertyValue("--color-muted").trim()     || "#64748b",
      critical: s.getPropertyValue("--color-critical").trim()  || "#dc2626",
      warning:  s.getPropertyValue("--color-warning").trim()   || "#d97706",
      info:     s.getPropertyValue("--color-info").trim()      || "#2563eb",
      now:      s.getPropertyValue("--color-critical").trim()  || "#dc2626",
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const showTip = useCallback((item: TimelineBucket, clientX: number, clientY: number) => {
    const tip  = tipRef.current;
    const wrap = wrapRef.current;
    if (!tip || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const d = parseWallClockDate(item.ts) ?? new Date();
    tip.innerHTML = `
      <div class="text-[11px] font-semibold text-[var(--color-text)] mb-1">${formatDateTime(d)}</div>
      <div class="text-[12px] font-bold text-[var(--color-text)]">Total: ${item.count}</div>
      <div class="flex flex-col gap-0.5 mt-1 text-[11px]">
        <span style="color:var(--color-critical)">● Critical: ${item.critical}</span>
        <span style="color:var(--color-warning)">● Warning: ${item.warning}</span>
        <span style="color:var(--color-info)">● Info: ${item.info}</span>
      </div>`;
    tip.style.left = `${clientX - rect.left + 8}px`;
    tip.style.top  = `${clientY - rect.top - 6}px`;
    tip.classList.remove("hidden");
  }, []);

  const hideTip = useCallback(() => { tipRef.current?.classList.add("hidden"); }, []);

  useEffect(() => {
    const svg  = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap || isLoading) return;
    svg.innerHTML = "";
    if (!data?.buckets.length) return;

    const buckets  = data.buckets;
    const hasData  = buckets.some((b) => b.count > 0);
    if (!hasData) return;

    // Read actual rendered width synchronously — matches old dashboard pattern
    const width = Math.max(wrap.clientWidth || 960, 320);

    const H = 160, ML = 40, MT = 14, MR = 10, MB = 26;
    const pw = width - ML - MR;
    const ph = H - MT - MB;
    const intMs = Math.max(1, data.interval_minutes * 60_000);
    const ns = "http://www.w3.org/2000/svg";

    svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
    // Removes default "xMidYMid meet" — content fills SVG element exactly,
    // preventing pillarboxing when CSS width ≠ viewBox width during first paint.
    svg.removeAttribute("preserveAspectRatio");

    const fromDate = parseWallClockDate(data.from);
    const toDate   = parseWallClockDate(data.to);
    const visibleFrom = fromDate
      ? floorTimeToMinutes(fromDate.getTime(), data.interval_minutes)
      : 0;
    const visibleTo = toDate
      ? ceilTimeToMinutes(toDate.getTime(), data.interval_minutes)
      : visibleFrom + intMs;
    const span = Math.max(1, visibleTo - visibleFrom);

    const slotCount = Math.max(1, Math.ceil(span / intMs));
    const slotW     = pw / slotCount;
    const barGap    = Math.min(8, Math.max(2, slotW * 0.2));
    const barW      = Math.min(48, Math.max(2, slotW - barGap));
    const barOff    = Math.max(0, (slotW - barW) / 2);

    const maxCount = Math.max(...buckets.map((b) => b.count));
    const ticks    = buildNiceTicks(maxCount);
    const yMax     = ticks[ticks.length - 1] || 1;

    const mk = (tag: string): SVGElement => document.createElementNS(ns, tag) as SVGElement;

    const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, dash?: string) => {
      const l = mk("line");
      Object.entries({ x1, y1, x2, y2, stroke, "stroke-width": sw })
        .forEach(([k, v]) => l.setAttribute(k, String(v)));
      if (dash) l.setAttribute("stroke-dasharray", dash);
      svg.appendChild(l);
    };

    const text = (x: number, y: number, txt: string, fill: string, anchor?: string) => {
      const t = mk("text");
      t.setAttribute("x", String(x)); t.setAttribute("y", String(y));
      t.setAttribute("fill", fill);   t.setAttribute("font-size", "11");
      t.setAttribute("font-family", "inherit");
      if (anchor) t.setAttribute("text-anchor", anchor);
      t.textContent = txt;
      svg.appendChild(t);
    };

    const timeToX = (ts: number): number => ML + pw * ((ts - visibleFrom) / span);

    // Grid + Y axis
    ticks.forEach((v, i) => {
      const y = MT + ph - (v / yMax) * ph;
      line(ML, y, width - MR, y, colors.grid, i === 0 ? 1.2 : 0.8, i === 0 ? "" : "2 4");
      text(ML - 8, y + 4, String(v), colors.axis, "end");
    });

    // Now marker
    const nowTs = Date.now();
    const nowLocal = new Date();
    const nowLocalTs = new Date(
      nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(),
      nowLocal.getHours(), nowLocal.getMinutes(), nowLocal.getSeconds(),
    ).getTime();
    if (nowLocalTs >= visibleFrom && nowLocalTs <= visibleTo) {
      const nx = timeToX(nowLocalTs);
      line(nx, MT, nx, MT + ph, colors.now, 1.2, "3 3");
      text(nx - 2, MT + 11, "now", colors.now, "end");
    }

    // Bars
    buckets.forEach((item) => {
      const d = parseWallClockDate(item.ts);
      if (!d) return;
      const ts = d.getTime();
      if (ts + intMs <= visibleFrom || ts >= visibleTo) return;
      if (!item.count) return;

      const slotX = timeToX(ts);
      const x     = slotX + barOff;
      const g     = mk("g");
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", `${item.count} findings at ${formatChartTick(d, data.interval_minutes)}`);

      // Hover zone covers full slot width for easier interaction
      const hz = mk("rect");
      Object.entries({ x: slotX, y: MT, width: slotW, height: ph, fill: "transparent" })
        .forEach(([k, v]) => hz.setAttribute(k, String(v)));
      g.appendChild(hz);

      // Stacked bars: info (bottom) → warning → critical (top)
      const isPeak = item.count === maxCount;
      let stacked = 0;
      [
        { v: item.info,     c: colors.info     },
        { v: item.warning,  c: colors.warning  },
        { v: item.critical, c: colors.critical },
      ].forEach(({ v, c }) => {
        if (!v) return;
        const sh = Math.max(2, (v / yMax) * ph);
        const sy = MT + ph - stacked - sh;
        const r  = mk("rect");
        Object.entries({
          x, y: sy, width: barW, height: sh, fill: c,
          "fill-opacity": isPeak ? "0.98" : "0.88",
          rx: "2",
          stroke: isPeak ? "rgba(255,255,255,0.35)" : "transparent",
          "stroke-width": isPeak ? "0.6" : "0",
        }).forEach(([k, vv]) => r.setAttribute(k, String(vv)));
        g.appendChild(r);
        stacked += sh;
      });

      g.addEventListener("mouseenter", (e) => { const ev = e as MouseEvent; showTip(item, ev.clientX, ev.clientY); });
      g.addEventListener("mousemove",  (e) => { const ev = e as MouseEvent; showTip(item, ev.clientX, ev.clientY); });
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("focus",      () => {
        const wr = wrapRef.current!.getBoundingClientRect();
        showTip(item, wr.left + x, wr.top + MT + 20);
      });
      g.addEventListener("blur", hideTip);
      svg.appendChild(g);
    });

    // X axis labels
    const rangeMin   = Math.max(1, Math.round(span / 60_000));
    const labelStep  = chooseXAxisLabelMinutes(data.interval_minutes, rangeMin, pw);
    let tick = floorTimeToMinutes(visibleFrom, labelStep);
    if (tick < visibleFrom) tick += labelStep * 60_000;
    while (tick <= visibleTo) {
      const lx = ML + pw * ((tick - visibleFrom) / span) + slotW / 2;
      text(lx, H - 14, formatChartTick(new Date(tick), labelStep), colors.axis, "middle");
      tick += labelStep * 60_000;
    }
  }, [data, isLoading, resizeTick, colors, showTip, hideTip]);

  const hasActivity = data?.buckets.some((b) => b.count > 0);

  if (isLoading) return <Skeleton className="h-[160px] w-full rounded-lg" />;

  return (
    <div className="relative bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3">
      <div className="flex items-center justify-between mb-2 text-[11px] text-[var(--color-muted)]">
        <span>Findings over time</span>
        {data && (
          <span className="font-code">
            {data.interval_minutes >= 1440
              ? `${data.interval_minutes / 1440}d buckets`
              : data.interval_minutes >= 60
              ? `${data.interval_minutes / 60}h buckets`
              : `${data.interval_minutes}m buckets`}
          </span>
        )}
      </div>

      <div className="relative" ref={wrapRef}>
        {!hasActivity && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--color-muted)]">
            No activity in this time range
          </div>
        )}
        <svg
          ref={svgRef}
          role="img"
          aria-label="Findings activity timeline chart"
          className="w-full block"
          style={{ height: 160 }}
        />
        <div
          ref={tipRef}
          className="absolute hidden pointer-events-none z-30 rounded-lg px-3 py-2.5 text-xs border border-[var(--color-border)] shadow-xl bg-[var(--color-surface-2)] text-[var(--color-text)]"
          style={{ backdropFilter: "blur(8px)" }}
        />
      </div>
      <RefreshingOverlay visible={isFetching && !!data} />
    </div>
  );
}
