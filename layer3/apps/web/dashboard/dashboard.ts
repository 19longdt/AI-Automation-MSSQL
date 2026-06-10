import { apiGet, apiPost } from "./api-client";
import { withButtonLoading, withGlobalLoading } from "./loading-overlay";
import { bindModalEvents, openActionConfirmModal, openModal } from "./modal";
import { PlanAnalysisResult } from "@layer3/core";
import { PlanAnalysisComponent } from "./plan-analysis-component";
import { createTopicLayoutHandlers, TopicLayoutKey } from "./topics/layout-registry";
import { renderBlockingChainModal } from "./topics/blocking-detail";
import { renderAgHealthModal } from "./topics/ag-health-detail";
import { attachGlossaryTooltips } from "./glossary-tooltip";
declare const QP: any;
declare const window: any;

var page = 0;
var limit = 15;
var activeTopicId = "";
var topics: any[] = [];
var activeTimeRange: any = null;
var autoRefreshTimer: number | null = null;
var isLoadingFindings = false;
var autoRefreshTick = 0;
var TIME_RANGE_STORAGE_KEY = "dashboard.timeRange.recent.v1";
var AUTO_REFRESH_STORAGE_KEY = "dashboard.timeRange.autoRefresh.v1";
var latestTimelineData: any = null;

interface TimelineBucket {
  ts: string
  count: number
  critical: number
  warning: number
  info: number
}

interface TimelineResponse {
  interval_minutes: number
  from: string | null
  to: string | null
  buckets: TimelineBucket[]
}

function pad2(n: number): string {
  return n < 10 ? "0" + String(n) : String(n);
}

function toDateTimeLocalValue(d: Date): string {
  return String(d.getFullYear()) + "-" +
    pad2(d.getMonth() + 1) + "-" +
    pad2(d.getDate()) + "T" +
    pad2(d.getHours()) + ":" +
    pad2(d.getMinutes()) + ":" +
    pad2(d.getSeconds());
}

function buildRelativeTimeRange(amount: number, unit: string, label?: string): any {
  return {
    mode: "relative",
    amount: amount,
    unit: unit,
    label: label || ("Last " + String(amount) + " " + unit)
  };
}

function buildAbsoluteTimeRange(fromValue: string, toValue: string, label?: string): any {
  return {
    mode: "absolute",
    from: fromValue,
    to: toValue,
    label: label || "Custom range"
  };
}

function readLocalDateTimeInput(v: string): Date | null {
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function startOfWeek(d: Date): Date {
  var x = startOfDay(d);
  var day = x.getDay();
  var diff = day === 0 ? -6 : (1 - day);
  x.setDate(x.getDate() + diff);
  return x;
}

function shiftDate(d: Date, amount: number, unit: string): Date {
  var x = new Date(d.getTime());
  if (unit === "minutes") x.setMinutes(x.getMinutes() + amount);
  else if (unit === "hours") x.setHours(x.getHours() + amount);
  else if (unit === "days") x.setDate(x.getDate() + amount);
  else if (unit === "weeks") x.setDate(x.getDate() + amount * 7);
  else if (unit === "months") x.setMonth(x.getMonth() + amount);
  return x;
}

function presetTimeRange(presetId: string, now?: Date): any {
  var anchor = now || new Date();
  if (presetId === "today") {
    return { label: "Today", from: startOfDay(anchor), to: anchor };
  }
  if (presetId === "this_week") {
    return { label: "This week", from: startOfWeek(anchor), to: anchor };
  }
  if (presetId === "last_1_minute") {
    return { label: "Last 1 minute", from: shiftDate(anchor, -1, "minutes"), to: anchor };
  }
  if (presetId === "last_15_minutes") {
    return { label: "Last 15 minutes", from: shiftDate(anchor, -15, "minutes"), to: anchor };
  }
  if (presetId === "last_30_minutes") {
    return { label: "Last 30 minutes", from: shiftDate(anchor, -30, "minutes"), to: anchor };
  }
  if (presetId === "last_1_hour") {
    return { label: "Last 1 hour", from: shiftDate(anchor, -1, "hours"), to: anchor };
  }
  if (presetId === "last_24_hours") {
    return { label: "Last 24 hours", from: shiftDate(anchor, -24, "hours"), to: anchor };
  }
  if (presetId === "last_7_days") {
    return { label: "Last 7 days", from: shiftDate(anchor, -7, "days"), to: anchor };
  }
  if (presetId === "last_30_days") {
    return { label: "Last 30 days", from: shiftDate(anchor, -30, "days"), to: anchor };
  }
  if (presetId === "last_90_days") {
    return { label: "Last 90 days", from: shiftDate(anchor, -90, "days"), to: anchor };
  }
  if (presetId === "last_1_year") {
    return { label: "Last 1 year", from: shiftDate(anchor, -12, "months"), to: anchor };
  }
  return { label: "Last 1 hour", from: shiftDate(anchor, -1, "hours"), to: anchor };
}

function resolveTimeRange(state: any, now?: Date): { label: string; from: Date; to: Date } {
  var anchor = now || new Date();
  if (!state || !state.mode) {
    var fallback = presetTimeRange("last_1_hour", anchor);
    return { label: fallback.label, from: fallback.from, to: fallback.to };
  }
  if (state.mode === "absolute") {
    var fromAbs = readLocalDateTimeInput(String(state.from || ""));
    var toAbs = readLocalDateTimeInput(String(state.to || ""));
    if (fromAbs && toAbs) return { label: String(state.label || "Custom range"), from: fromAbs, to: toAbs };
  }
  if (state.mode === "preset") {
    var preset = presetTimeRange(String(state.presetId || ""), anchor);
    return { label: String(state.label || preset.label), from: preset.from, to: preset.to };
  }
  if (state.mode === "relative") {
    var amount = Math.max(1, Number(state.amount) || 1);
    var unit = String(state.unit || "minutes");
    return {
      label: String(state.label || ("Last " + String(amount) + " " + unit)),
      from: shiftDate(anchor, -amount, unit),
      to: anchor
    };
  }
  var fallback2 = presetTimeRange("last_1_hour", anchor);
  return { label: fallback2.label, from: fallback2.from, to: fallback2.to };
}

function formatTimeRangeDisplay(d: Date): string {
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[d.getMonth()] + " " + String(d.getDate()) + ", " + String(d.getFullYear()) +
    " @ " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function parseWallClockDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  var raw = String(v).trim();
  if (!raw) return null;
  var normalized = raw;
  if (normalized.charAt(normalized.length - 1) === "Z") normalized = normalized.slice(0, -1);
  if (normalized.indexOf("T") >= 0) normalized = normalized.replace("T", " ");
  var m = normalized.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/);
  if (!m) {
    var fallback = new Date(raw);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || "0"),
    0
  );
}

function formatChartTick(d: Date, intervalMinutes: number): string {
  if (intervalMinutes >= 24 * 60) {
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1);
  }
  if (intervalMinutes >= 180) {
    return pad2(d.getHours()) + ":00";
  }
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function formatTimelineRange(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return "No range";
  var from = parseWallClockDate(fromIso);
  var to = parseWallClockDate(toIso);
  if (!from || !to) return "No range";
  return formatTimeRangeDisplay(from) + " -> " + formatTimeRangeDisplay(to);
}

function formatWindowLabel(fromDate: Date, toDate: Date): string {
  return "Showing activity window: " + formatTimeRangeDisplay(fromDate) + " -> " + formatTimeRangeDisplay(toDate);
}

function formatIntervalLabel(intervalMinutes: number): string {
  if (intervalMinutes % (24 * 60) === 0) {
    var days = intervalMinutes / (24 * 60);
    return "Interval: " + String(days) + " day" + (days > 1 ? "s" : "");
  }
  if (intervalMinutes % 60 === 0) {
    var hours = intervalMinutes / 60;
    return "Interval: " + String(hours) + " hour" + (hours > 1 ? "s" : "");
  }
  return "Interval: " + String(intervalMinutes) + " minute" + (intervalMinutes > 1 ? "s" : "");
}

function formatTooltipDateTime(d: Date): string {
  return formatTimeRangeDisplay(d);
}

function buildNiceTicks(maxValue: number): number[] {
  // Findings count là số nguyên. Chọn step nguyên để 4 mốc cách đều tuyệt đối:
  // value/yMax = i/4 cho mọi tick, tránh tình trạng làm tròn lệch (vd [0,3,5,8,10]).
  var max = Math.max(1, Math.ceil(maxValue));
  var step = Math.max(1, Math.ceil(max / 4));
  // Làm step "tròn" hơn (2,5,10...) khi giá trị lớn, vẫn giữ tính nguyên & đều.
  if (step > 5) {
    var exponent = Math.floor(Math.log(step) / Math.log(10));
    var base = Math.pow(10, exponent);
    var fraction = step / base;
    var niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    step = Math.round(niceFraction * base);
  }
  var ticks: number[] = [];
  for (var i = 0; i <= 4; i++) ticks.push(step * i);
  return ticks;
}

function chooseXAxisLabelMinutes(intervalMinutes: number, rangeMinutes: number, plotWidth: number): number {
  if (intervalMinutes <= 30) {
    return intervalMinutes;
  }
  var targetLabels = Math.max(6, Math.floor(plotWidth / 72));
  var rawStep = Math.max(intervalMinutes, Math.ceil(rangeMinutes / Math.max(targetLabels, 1)));
  var choices = [
    intervalMinutes,
    30,
    60,
    120,
    180,
    240,
    360,
    720,
    1440
  ].sort(function (a, b) { return a - b; });
  for (var i = 0; i < choices.length; i++) {
    var candidate = choices[i];
    if (candidate >= rawStep && candidate >= intervalMinutes && candidate % intervalMinutes === 0) {
      return candidate;
    }
  }
  return Math.max(intervalMinutes, rawStep);
}

function floorTimeToMinutes(ts: number, stepMinutes: number): number {
  var stepMs = stepMinutes * 60 * 1000;
  return ts - (ts % stepMs);
}

function ceilTimeToMinutes(ts: number, stepMinutes: number): number {
  var stepMs = stepMinutes * 60 * 1000;
  var remainder = ts % stepMs;
  return remainder === 0 ? ts : ts + (stepMs - remainder);
}

function chooseTimelineIntervalMinutes(from: Date, to: Date): number {
  var durationMs = Math.max(1, to.getTime() - from.getTime());
  var minutes = durationMs / 60000;
  if (minutes <= 180) return 5;
  if (minutes <= 24 * 60) return 30;
  if (minutes <= 3 * 24 * 60) return 60;
  if (minutes <= 14 * 24 * 60) return 180;
  if (minutes <= 45 * 24 * 60) return 720;
  return 1440;
}

function buildTimelineQueryParams(
  severity: string,
  alertStatus: string,
  blockingStatus: string,
  detectedFrom: string,
  detectedTo: string
): Record<string, string | number | undefined> {
  var resolved = currentResolvedTimeRange();
  return {
    topic_id: activeTopicId,
    severity: severity,
    alert_status: alertStatus,
    blocking_status: blockingStatus,
    since: detectedFrom,
    until: detectedTo,
    interval_minutes: chooseTimelineIntervalMinutes(resolved.from, resolved.to)
  };
}

function setTimelineCardVisible(visible: boolean): void {
  var card = document.getElementById("findingsTimelineCard");
  if (!card) return;
  if (visible) card.classList.remove("hidden");
  else card.classList.add("hidden");
}

function renderFindingTimeline(data: TimelineResponse | null): void {
  latestTimelineData = data;
  var svg = document.getElementById("findingsTimelineSvg") as any;
  var empty = document.getElementById("findingsTimelineEmpty");
  var wrap = document.getElementById("findingsTimelineSvgWrap");
  var rangeEl = document.getElementById("findingsTimelineRange");
  var windowEl = document.getElementById("findingsTimelineWindow");
  var intervalEl = document.getElementById("findingsTimelineInterval");
  var summaryEl = document.getElementById("findingsTimelineSummary");
  var tooltip = document.getElementById("findingsTimelineTooltip") as HTMLDivElement | null;
  if (!svg || !empty || !wrap || !rangeEl || !windowEl || !intervalEl || !summaryEl || !tooltip) return;

  rangeEl.textContent = data ? formatTimelineRange(data.from, data.to) : "No range";
  windowEl.classList.add("hidden");
  windowEl.textContent = "";
  intervalEl.textContent = data ? formatIntervalLabel(Number(data.interval_minutes || 0)) : "Interval: -";
  summaryEl.textContent = "Waiting for data.";

  var buckets = data && data.buckets ? data.buckets : [];
  var hasActivity = false;
  for (var i = 0; i < buckets.length; i++) {
    if (Number(buckets[i].count || 0) > 0) {
      hasActivity = true;
      break;
    }
  }

  empty.classList.toggle("hidden", hasActivity);
  wrap.classList.toggle("hidden", !hasActivity);
  svg.innerHTML = "";
  tooltip.classList.add("hidden");
  if (!hasActivity) summaryEl.textContent = "No findings for the active filters and time range.";
  if (!hasActivity || !data) return;

  // viewBox width khớp đúng chiều rộng render thực tế của wrap → tỉ lệ viewBox
  // trùng khít khung CSS (width × 170px) nên "xMidYMid meet" mặc định vừa lấp đầy
  // (không còn khoảng trắng 2 bên) vừa giữ scale 1:1 → đường kẻ/nét đứt sắc nét.
  var width = Math.max(wrap.clientWidth || 960, 320);
  var height = 170;
  svg.setAttribute("viewBox", "0 0 " + String(width) + " " + String(height));
  svg.removeAttribute("preserveAspectRatio");
  var marginLeft = 40;
  var marginTop = 14;
  var marginRight = 10;
  var marginBottom = 26;
  var plotWidth = width - marginLeft - marginRight;
  var plotHeight = height - marginTop - marginBottom;
  var now = new Date();
  var fromDate = parseWallClockDate(data.from);
  var toDate = parseWallClockDate(data.to);
  var fromTime = fromDate ? fromDate.getTime() : 0;
  var toTime = toDate ? toDate.getTime() : 0;
  var intervalMs = Math.max(1, data.interval_minutes * 60 * 1000);
  var maxCount = 0;
  var totalCount = 0;
  var peakBucket: TimelineBucket | null = null;
  for (var j = 0; j < buckets.length; j++) {
    var bucketCount = Number(buckets[j].count || 0);
    totalCount += bucketCount;
    if (bucketCount >= maxCount) peakBucket = buckets[j];
    maxCount = Math.max(maxCount, bucketCount);
  }
  var ticks = buildNiceTicks(maxCount);
  var yMax = ticks[ticks.length - 1];
  var ns = "http://www.w3.org/2000/svg";
  var visibleFromDate = fromDate || (parseWallClockDate(buckets[0] && buckets[0].ts) || new Date());
  var visibleToDate = toDate || (parseWallClockDate(buckets[buckets.length - 1] && buckets[buckets.length - 1].ts) || new Date());
  var visibleFromTime = floorTimeToMinutes(visibleFromDate.getTime(), data.interval_minutes);
  var visibleToTime = ceilTimeToMinutes(visibleToDate.getTime(), data.interval_minutes);
  if (visibleToTime <= visibleFromTime) visibleToTime = visibleFromTime + intervalMs;
  var visibleBucketCount = Math.max(1, Math.ceil((visibleToTime - visibleFromTime) / intervalMs));
  var barSlotWidth = plotWidth / visibleBucketCount;

  windowEl.classList.add("hidden");

  summaryEl.textContent = "Total " + String(totalCount) + " findings. Peak " + String(maxCount) + " at " +
    (peakBucket ? formatChartTick(parseWallClockDate(peakBucket.ts) || new Date(), data.interval_minutes) : "-") + ".";

  function svgEl(name: string): SVGElement {
    return document.createElementNS(ns, name) as any;
  }

  function appendLine(x1: number, y1: number, x2: number, y2: number, color: string, widthPx: number, dash?: string): void {
    var line = svgEl("line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(widthPx));
    if (dash) line.setAttribute("stroke-dasharray", dash);
    svg.appendChild(line);
  }

  function appendText(x: number, y: number, text: string, color: string, anchor?: string): void {
    var el = svgEl("text");
    el.setAttribute("x", String(x));
    el.setAttribute("y", String(y));
    el.setAttribute("fill", color);
    el.setAttribute("font-size", "11");
    el.setAttribute("font-family", "inherit");
    if (anchor) el.setAttribute("text-anchor", anchor);
    el.textContent = text;
    svg.appendChild(el);
  }

  var styles = getComputedStyle(document.documentElement);
  var gridColor = styles.getPropertyValue("--color-border").trim() || "#d7deea";
  var axisColor = styles.getPropertyValue("--color-muted").trim() || "#5b6472";
  var criticalColor = styles.getPropertyValue("--color-danger").trim() || "#d5443e";
  var warningColor = styles.getPropertyValue("--color-warning").trim() || "#ca8a04";
  var infoColor = styles.getPropertyValue("--color-primary").trim() || "#2563eb";
  var markerColor = styles.getPropertyValue("--color-danger").trim() || "#d5443e";

  for (var step = 0; step < ticks.length; step++) {
    var value = ticks[step];
    var y = marginTop + plotHeight - ((value / yMax) * plotHeight);
    appendLine(marginLeft, y, width - marginRight, y, gridColor, step === 0 ? 1.2 : 0.8, step === 0 ? "" : "2 4");
    appendText(marginLeft - 8, y + 4, String(value), axisColor, "end");
  }

  // Cột là histogram phủ khoảng [T, T+interval) nên phải lấp gần đầy slot và
  // neo mép trái tại timeToX(T). Cap ở 48px để khi rất ít bucket cột không quá to.
  var barGap = Math.min(8, Math.max(2, barSlotWidth * 0.2));
  var barWidth = Math.min(48, Math.max(2, barSlotWidth - barGap));
  // Căn giữa cột trong slot để tâm cột = slotX + barSlotWidth/2, khớp với nhãn thời gian.
  var barOffset = Math.max(0, (barSlotWidth - barWidth) / 2);

  function timeToX(ts: number): number {
    return marginLeft + (plotWidth * ((ts - visibleFromTime) / Math.max(1, visibleToTime - visibleFromTime)));
  }

  if (now.getTime() >= visibleFromTime && now.getTime() <= visibleToTime) {
    var nowRatio = (now.getTime() - visibleFromTime) / Math.max(1, visibleToTime - visibleFromTime);
    var nowX = marginLeft + (plotWidth * nowRatio);
    appendLine(nowX, marginTop, nowX, marginTop + plotHeight, markerColor, 1.2);
    appendText(nowX - 2, marginTop + 11, "now", markerColor, "end");
  }

  function showTooltip(item: TimelineBucket, clientX: number, clientY: number): void {
    var itemDate = parseWallClockDate(item.ts) || new Date();
    tooltip.innerHTML =
      "<div class='findings-timeline-tooltip-time'>" + esc(formatTooltipDateTime(itemDate)) + "</div>" +
      "<div class='findings-timeline-tooltip-total'>Total: " + String(item.count) + "</div>" +
      "<div class='findings-timeline-tooltip-list'>" +
      "<div class='findings-timeline-tooltip-row'><span>Critical</span><strong>" + String(item.critical || 0) + "</strong></div>" +
      "<div class='findings-timeline-tooltip-row'><span>Warning</span><strong>" + String(item.warning || 0) + "</strong></div>" +
      "<div class='findings-timeline-tooltip-row'><span>Info</span><strong>" + String(item.info || 0) + "</strong></div>" +
      "</div>";
    var rect = wrap.getBoundingClientRect();
    tooltip.style.left = String(clientX - rect.left + 8) + "px";
    tooltip.style.top = String(clientY - rect.top - 6) + "px";
    tooltip.classList.remove("hidden");
  }

  function hideTooltip(): void {
    tooltip.classList.add("hidden");
  }

  for (var b = 0; b < buckets.length; b++) {
    (function (item: TimelineBucket, b: number) {
      var itemDate = parseWallClockDate(item.ts) || new Date();
      var itemTime = itemDate.getTime();
      if (itemTime + intervalMs <= visibleFromTime || itemTime >= visibleToTime) return;
      var count = Number(item.count || 0);
      var slotX = timeToX(itemTime);
      var x = slotX + barOffset;
      var group = svgEl("g");
      group.setAttribute("data-ts", item.ts);
      group.setAttribute("tabindex", "0");

      var hoverZone = svgEl("rect");
      hoverZone.setAttribute("x", String(slotX));
      hoverZone.setAttribute("y", String(marginTop));
      hoverZone.setAttribute("width", String(barSlotWidth));
      hoverZone.setAttribute("height", String(plotHeight));
      hoverZone.setAttribute("fill", "transparent");
      group.appendChild(hoverZone);

      var stackValues = [
        { key: "info", value: Number(item.info || 0), color: infoColor },
        { key: "warning", value: Number(item.warning || 0), color: warningColor },
        { key: "critical", value: Number(item.critical || 0), color: criticalColor }
      ];
      var stackedHeight = 0;
      for (var s = 0; s < stackValues.length; s++) {
        var stack = stackValues[s];
        if (stack.value <= 0) continue;
        var segmentHeight = yMax <= 0 ? 0 : (stack.value / yMax) * plotHeight;
        var segmentY = marginTop + plotHeight - stackedHeight - segmentHeight;
        var rect = svgEl("rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(segmentY));
        rect.setAttribute("width", String(barWidth));
        rect.setAttribute("height", String(Math.max(segmentHeight, 2)));
        rect.setAttribute("fill", stack.color);
        rect.setAttribute("fill-opacity", count === maxCount ? "0.98" : "0.88");
        rect.setAttribute("stroke", count === maxCount ? "rgba(255,255,255,0.35)" : "transparent");
        rect.setAttribute("stroke-width", count === maxCount ? "0.6" : "0");
        group.appendChild(rect);
        stackedHeight += segmentHeight;
      }

      group.addEventListener("mousemove", function (ev) {
        var mouseEv = ev as MouseEvent;
        showTooltip(item, mouseEv.clientX, mouseEv.clientY);
      });
      group.addEventListener("mouseenter", function (ev) {
        var mouseEv = ev as MouseEvent;
        showTooltip(item, mouseEv.clientX, mouseEv.clientY);
      });
      group.addEventListener("mouseleave", function () {
        hideTooltip();
      });
      group.addEventListener("focus", function () {
        var wrapRect = wrap.getBoundingClientRect();
        showTooltip(item, wrapRect.left + x, wrapRect.top + marginTop + 20);
      });
      group.addEventListener("blur", function () {
        hideTooltip();
      });
      svg.appendChild(group);
    })(buckets[b], b);
  }

  if (visibleToTime > visibleFromTime) {
    var rangeMinutes = Math.max(1, Math.round((visibleToTime - visibleFromTime) / 60000));
    var labelStepMinutes = chooseXAxisLabelMinutes(data.interval_minutes, rangeMinutes, plotWidth);
    var tickTime = floorTimeToMinutes(visibleFromTime, labelStepMinutes);
    if (tickTime < visibleFromTime) tickTime += labelStepMinutes * 60 * 1000;

    while (tickTime <= visibleToTime) {
      var ratio = (tickTime - visibleFromTime) / Math.max(1, visibleToTime - visibleFromTime);
      // +barSlotWidth/2: cột phủ [T, T+interval) nên tâm cột nằm lệch nửa slot so
      // với timeToX(T); đặt nhãn ngay chính giữa cột thay vì ở mép trái.
      var tickX = marginLeft + (plotWidth * ratio) + (barSlotWidth / 2);
      appendText(tickX, height - 14, formatChartTick(new Date(tickTime), labelStepMinutes), axisColor, "middle");
      tickTime += labelStepMinutes * 60 * 1000;
    }
  }
}

function currentResolvedTimeRange(): { label: string; from: Date; to: Date } {
  return resolveTimeRange(activeTimeRange);
}

function ensureCustomDateTimeInputsFilled(): void {
  var fromEl = document.getElementById("detectedFromCustom") as HTMLInputElement | null;
  var toEl = document.getElementById("detectedToCustom") as HTMLInputElement | null;
  if (!fromEl || !toEl) return;
  if (fromEl.value && toEl.value) return;
  var fallback = presetTimeRange("last_1_hour");
  if (!fromEl.value) fromEl.value = toDateTimeLocalValue(fallback.from);
  if (!toEl.value) toEl.value = toDateTimeLocalValue(fallback.to);
}

function syncDetectedAtInputsFromState(): void {
  var fromEl = document.getElementById("detectedFromFilter") as HTMLInputElement | null;
  var toEl = document.getElementById("detectedToFilter") as HTMLInputElement | null;
  if (!fromEl || !toEl) return;
  var range = currentResolvedTimeRange();
  fromEl.value = toDateTimeLocalValue(range.from);
  toEl.value = toDateTimeLocalValue(range.to);
}

function updateTimeRangeSummary(): void {
  var summaryEl = document.getElementById("timeRangeSummary");
  var summaryLabelEl = document.getElementById("timeRangeSummaryLabel");
  var customFromEl = document.getElementById("detectedFromCustom") as HTMLInputElement | null;
  var customToEl = document.getElementById("detectedToCustom") as HTMLInputElement | null;
  var range = currentResolvedTimeRange();
  if (summaryLabelEl) summaryLabelEl.textContent = range.label;
  if (summaryEl) summaryEl.textContent = formatTimeRangeDisplay(range.from) + " -> " + formatTimeRangeDisplay(range.to);
  if (customFromEl) customFromEl.value = toDateTimeLocalValue(range.from);
  if (customToEl) customToEl.value = toDateTimeLocalValue(range.to);
  ensureCustomDateTimeInputsFilled();
}

function recentRangeItems(): any[] {
  try {
    var raw = window.localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function saveRecentRangeItems(items: any[]): void {
  try {
    window.localStorage.setItem(TIME_RANGE_STORAGE_KEY, JSON.stringify(items.slice(0, 8)));
  } catch (_e) { }
}

function pushRecentRange(label: string, from: Date, to: Date): void {
  var entry = {
    mode: "absolute",
    label: label,
    from: toDateTimeLocalValue(from),
    to: toDateTimeLocalValue(to)
  };
  var key = entry.from + "|" + entry.to;
  var items = recentRangeItems().filter(function (x: any) {
    return (String(x && x.from || "") + "|" + String(x && x.to || "")) !== key;
  });
  items.unshift(entry);
  saveRecentRangeItems(items);
}

function renderRecentRanges(): void {
  var box = document.getElementById("recentRangesList");
  if (!box) return;
  var items = recentRangeItems();
  if (!items.length) {
    box.innerHTML = "<div class='time-picker-empty'>No recent ranges yet.</div>";
    return;
  }
  box.innerHTML = items.map(function (x: any, idx: number) {
    var from = readLocalDateTimeInput(String(x && x.from || ""));
    var to = readLocalDateTimeInput(String(x && x.to || ""));
    var detail = (from && to)
      ? formatTimeRangeDisplay(from) + " -> " + formatTimeRangeDisplay(to)
      : "";
    return "<a href='#' class='time-recent-link' data-recent-idx='" + String(idx) + "'>" +
      "<span class='time-recent-label'>" + esc(String(x && x.label || "Range")) + "</span>" +
      "<span class='time-recent-detail'>" + esc(detail) + "</span></a>";
  }).join("");
}

function applyTimeRangeState(nextState: any, saveRecent?: boolean): void {
  activeTimeRange = nextState;
  syncDetectedAtInputsFromState();
  updateTimeRangeSummary();
  renderRecentRanges();
  if (saveRecent !== false) {
    var range = currentResolvedTimeRange();
    pushRecentRange(range.label, range.from, range.to);
    renderRecentRanges();
  }
  scheduleAutoRefresh();
}

function initDefaultDetectedAtRange() {
  if (!activeTimeRange) activeTimeRange = { mode: "preset", presetId: "last_1_hour", label: "Last 1 hour" };
  applyTimeRangeState(activeTimeRange, false);
  ensureCustomDateTimeInputsFilled();
}

function positionTimePicker(): void {
  var popover = document.getElementById("timePickerPopover");
  var btn = document.getElementById("timeRangeBtn");
  if (!popover || !btn || popover.classList.contains("hidden")) return;
  var rect = btn.getBoundingClientRect();
  var margin = 12;
  var width = popover.offsetWidth;
  var height = popover.offsetHeight;
  var left = rect.left;
  if (left + width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - margin - width);
  }
  var top = rect.bottom + 8;
  // Nếu tràn dưới mép màn hình mà phía trên có chỗ → hiển thị phía trên nút
  if (top + height > window.innerHeight - margin && rect.top - 8 - height > margin) {
    top = rect.top - 8 - height;
  }
  top = Math.max(margin, top);
  popover.style.left = String(Math.round(left)) + "px";
  popover.style.top = String(Math.round(top)) + "px";
}

function setTimePickerOpen(open: boolean): void {
  var popover = document.getElementById("timePickerPopover");
  var btn = document.getElementById("timeRangeBtn");
  if (!popover || !btn) return;
  popover.classList.toggle("hidden", !open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    updateTimeRangeSummary();
    ensureCustomDateTimeInputsFilled();
    renderRecentRanges();
    positionTimePicker();
  }
}

function shiftActiveRange(direction: number): void {
  var range = currentResolvedTimeRange();
  var duration = Math.max(1000, range.to.getTime() - range.from.getTime());
  var delta = duration * direction;
  var nextFrom = new Date(range.from.getTime() + delta);
  var nextTo = new Date(range.to.getTime() + delta);
  applyTimeRangeState(buildAbsoluteTimeRange(toDateTimeLocalValue(nextFrom), toDateTimeLocalValue(nextTo), "Shifted range"));
}

function autoRefreshIntervalMs(): number {
  var toggle = document.getElementById("autoRefreshToggle") as HTMLInputElement | null;
  var valueEl = document.getElementById("autoRefreshValue") as HTMLInputElement | null;
  var unitEl = document.getElementById("autoRefreshUnit") as HTMLSelectElement | null;
  if (!toggle || !valueEl || !unitEl || !toggle.checked) return 0;
  var value = Math.max(1, Number(valueEl.value) || 0);
  var unit = String(unitEl.value || "seconds");
  return unit === "minutes" ? value * 60 * 1000 : value * 1000;
}

function persistAutoRefreshSettings(): void {
  var toggle = document.getElementById("autoRefreshToggle") as HTMLInputElement | null;
  var valueEl = document.getElementById("autoRefreshValue") as HTMLInputElement | null;
  var unitEl = document.getElementById("autoRefreshUnit") as HTMLSelectElement | null;
  if (!toggle || !valueEl || !unitEl) return;
  try {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify({
      enabled: !!toggle.checked,
      value: Math.max(1, Number(valueEl.value) || 60),
      unit: String(unitEl.value || "seconds")
    }));
  } catch (_e) { }
}

function restoreAutoRefreshSettings(): void {
  var toggle = document.getElementById("autoRefreshToggle") as HTMLInputElement | null;
  var valueEl = document.getElementById("autoRefreshValue") as HTMLInputElement | null;
  var unitEl = document.getElementById("autoRefreshUnit") as HTMLSelectElement | null;
  if (!toggle || !valueEl || !unitEl) return;
  try {
    var raw = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    if (!raw) return;
    var parsed = JSON.parse(raw) || {};
    toggle.checked = !!parsed.enabled;
    valueEl.value = String(Math.max(1, Number(parsed.value) || 60));
    unitEl.value = parsed.unit === "minutes" ? "minutes" : "seconds";
  } catch (_e) { }
}

function scheduleAutoRefresh(): void {
  if (autoRefreshTimer) {
    window.clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  var delay = autoRefreshIntervalMs();
  if (!delay) return;
  autoRefreshTimer = window.setTimeout(async function () {
    if (document.hidden || isLoadingFindings) {
      scheduleAutoRefresh();
      return;
    }
    var token = ++autoRefreshTick;
    try {
      await loadFindings({ silent: true, autoRefreshToken: token });
    } finally {
      scheduleAutoRefresh();
    }
  }, delay);
}
function getActiveTopic(): any {
  for (var i = 0; i < topics.length; i++) {
    if (String(topics[i].topic_id || "") === String(activeTopicId || "")) return topics[i];
  }
  return null;
}
function isSlowSessionTopic(): boolean {
  var t = getActiveTopic();
  var id = String((t && t.topic_id) || activeTopicId || "").toLowerCase();
  return id === "slow_sessions";
}

// Topic → layout key: thêm topic layout mới = thêm 1 case + 1 handler trong layout-registry.ts
function layoutKeyForTopic(topicLikeId: any): TopicLayoutKey {
  var id = String(topicLikeId || "").toLowerCase();
  if (id === "slow_sessions") return "slow_sessions";
  if (id === "blocking") return "blocking";
  if (id === "ag_health") return "ag_health";
  if (id === "ag_redo_secondary") return "ag_redo_secondary";
  if (id === "cdc_health") return "cdc_health";
  return "default";
}

function activeLayoutKey(): TopicLayoutKey {
  var t = getActiveTopic();
  return layoutKeyForTopic((t && t.topic_id) || activeTopicId);
}

function severityBadge(sev: string): string {
  if (sev === "CRITICAL") return '<span class="badge badge-critical">CRITICAL</span>';
  if (sev === "WARNING") return '<span class="badge badge-warning">WARNING</span>';
  return '<span class="badge badge-info">INFO</span>';
}

function alertStatusBadge(v: string): string {
  var x = String(v || "").toLowerCase();
  if (x === "sent") return '<span class="badge badge-success">sent</span>';
  if (x === "suppressed") return '<span class="badge badge-warning">suppressed</span>';
  return esc(String(v || ""));
}

function roleNodeCell(role: any, node: any): string {
  var roleText = String(role || "");
  var roleLower = roleText.toLowerCase();
  var roleStyle = "";
  if (roleLower === "primary") roleStyle = "color:#0b3d91;font-weight:700;";
  else if (roleLower === "secondary") roleStyle = "color:#4f8edc;font-weight:600;";

  var roleHtml = roleStyle
    ? "<span style='" + roleStyle + "'>" + esc(roleText) + "</span>"
    : esc(roleText);
  return roleHtml + " | " + esc(String(node || ""));
}

function hasBlockingSession(metrics: any): boolean {
  var id = Number(metrics && metrics.blocking_session_id);
  return isFinite(id) && id > 0;
}

function blockingBadge(metrics: any): string {
  if (!hasBlockingSession(metrics)) return '<span class="blocking-badge blocking-no">None</span>';
  return '<span class="blocking-badge blocking-yes blocking-kill-btn" title="blocking_session_id ' + esc(String(metrics.blocking_session_id)) + ' (click for KILL option)">#' + esc(String(metrics.blocking_session_id)) + '</span>';
}

function sessionIdBadge(metrics: any): string {
  var sessionId = metrics && metrics.session_id;
  if (sessionId === undefined || sessionId === null || sessionId === "") {
    return '<span class="blocking-badge session-id-none">None</span>';
  }
  return '<span class="blocking-badge session-id-badge session-kill-btn" title="session_id ' + esc(String(sessionId)) + ' (click for KILL option)">#' + esc(String(sessionId)) + '</span>';
}

// Topic `blocking` — head blocker cell: #sid + login, host/program trong title attr
function headBlockerCell(metrics: any): string {
  var sid = metrics && metrics.head_blocker_session_id;
  if (sid === undefined || sid === null || sid === "") {
    return '<span class="blocking-badge blocking-no">None</span>';
  }
  var titleParts: string[] = [];
  if (metrics.head_blocker_host) titleParts.push("host: " + String(metrics.head_blocker_host));
  if (metrics.head_blocker_program) titleParts.push("program: " + String(metrics.head_blocker_program));
  var title = esc(titleParts.join(" | "));
  var login = metrics.head_blocker_login ? " <span class='hb-login'>" + esc(String(metrics.head_blocker_login)) + "</span>" : "";
  return "<span class='blocking-badge blocking-yes' title='" + title + "'>#" + esc(String(sid)) + "</span>" + login;
}

// Topic `blocking` — state: IDLE TXN (forgotten transaction, kill an toàn) vs ACTIVE
function blockingStateBadge(metrics: any): string {
  var idle = !!(metrics && metrics.head_blocker_is_idle);
  var openTxn = Number(metrics && metrics.head_blocker_open_txn_count) || 0;
  if (idle && openTxn > 0) {
    var sec = (metrics.head_blocker_idle_sec === undefined || metrics.head_blocker_idle_sec === null)
      ? "" : " " + String(metrics.head_blocker_idle_sec) + "s";
    return "<span class='state-badge state-idle-txn' title='Idle session holding " + esc(String(openTxn)) +
      " open transaction(s) - forgotten transaction'>IDLE TXN ⚠" + esc(sec) + "</span>";
  }
  return "<span class='state-badge state-active'>ACTIVE</span>";
}

function truncateForPreview(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + "...";
}

function renderSqlPreviewBlock(title: string, value: any): string {
  var raw = value === undefined || value === null ? "" : String(value);
  if (!raw.trim()) return "";
  return "<div class='kill-confirm-sql-block'>" +
    "<div class='kill-confirm-sql-title'>" + esc(title) + "</div>" +
    "<pre class='kill-confirm-sql-pre'>" + esc(truncateForPreview(raw, 600)) + "</pre>" +
    "</div>";
}

async function requestKillSession(sessionId: number, sourceLabel: string, metrics: any, node: string) {
  var m = metrics || {};
  var killButtonLabel = sourceLabel === "blocking_session_id" ? "KILL Blocking"
    : sourceLabel === "head_blocker_session_id" ? "KILL Head Blocker"
    : "KILL Session";
  var confirmed = await openActionConfirmModal(
    "Confirm KILL Session",
    "<div class='kill-confirm'>" +
      "<div class='d-flex align-items-baseline justify-content-between flex-wrap gap-2 mb-2'>" +
        "<div class='kill-confirm-session'>Session <strong>#" + esc(String(sessionId)) + "</strong></div>" +
        "<div class='kill-confirm-target'>Source: " + esc(sourceLabel) + "</div>" +
      "</div>" +
      "<div class='kill-confirm-note'>This action will execute <code>KILL " + esc(String(sessionId)) + "</code>.</div>" +
      "<div class='kill-confirm-sql-grid d-flex flex-column gap-2'>" +
        renderSqlPreviewBlock("sql_text", m.sql_text) +
        renderSqlPreviewBlock("blocker_sql_text", m.blocker_sql_text) +
      "</div>" +
    "</div>",
    killButtonLabel,
    "Cancel"
  );
  if (!confirmed) return;
  try {
    var resp: any = null;
    await withGlobalLoading(async function () {
      resp = await apiPost("/api/actions/kill-session", { session_id: sessionId, node: node || "" });
    });
    var okMsg = (resp && resp.result && resp.result.message) || (resp && resp.message) || ("KILL session #" + String(sessionId) + " success.");
    openModal("KILL Result", "<div class='kill-result ok'>" + esc(String(okMsg)) + "</div>");
  } catch (e) {
    var status = e && e.status ? String(e.status) : "unknown";
    var payload = e && e.payload ? e.payload : null;
    var msg = (payload && (payload.message || payload.error)) || "Call API failed";
    var detail = payload ? JSON.stringify(payload, null, 2) : "";
    openModal(
      "KILL Failed",
      "<div class='kill-result fail'><strong>Error (" + esc(status) + "):</strong> " + esc(String(msg)) + "</div>" +
      (detail ? "<pre class='kill-result-detail'>" + esc(detail) + "</pre>" : "")
    );
  }
}

function formatDetectedAtForUi(v: any): string {
  if (!v) return "";
  return String(v);
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Diagnostics ---
var DIAG_PHASE_GROUPS: Array<{ label: string; tools: string[] }> = [
  {
    label: "Phase 1 - DMV Snapshot",
    tools: ["get_blocking_chain", "get_blocked_victims_snapshot", "get_wait_stats", "get_memory_grant", "get_tempdb_usage",
      "get_ag_status", "get_memory_pressure", "get_resource_governor_stats",
      "get_cdc_status", "get_missing_indexes", "get_query_stats", "get_query_store_history"]
  },
  { label: "Phase 2 - Static Analysis", tools: ["get_plan_analysis", "get_query_structure"] },
  { label: "Phase 3 - Table Details", tools: ["get_index_usage", "get_statistics_info"] },
  { label: "Phase 4 - Historical Context", tools: ["get_table_context", "get_recent_findings", "get_analysis_history"] }
];

function diagStatusClass(status: string): string {
  if (status === "ok") return "diag-status-ok";
  if (status === "empty") return "diag-status-empty";
  if (status === "skipped") return "diag-status-skipped";
  if (status === "timeout") return "diag-status-timeout";
  return "diag-status-error";
}

function renderDiagnosticsPanel(diag: any): string {
  if (!diag) return "<div class='diag-empty-msg'>No diagnostics data.</div>";
  var results: Record<string, any> = diag.results || {};
  var requested: string[] = diag.tools_requested || [];
  var captured: string[] = diag.tools_captured || [];
  var failed: string[] = diag.tools_failed || [];
  var durSec = diag.capture_duration_ms ? (diag.capture_duration_ms / 1000).toFixed(1) : "?";
  var summary = "<div class='diag-summary'>" +
    "Captured in <strong>" + esc(durSec) + "s</strong>" +
    " &nbsp;&middot;&nbsp; <span class='diag-ok-count'>" + esc(String(captured.length)) + " ok</span>" +
    (failed.length ? " &nbsp;&middot;&nbsp; <span class='diag-fail-count'>" + esc(String(failed.length)) + " failed</span>" : "") +
    (diag.captured_at ? " &nbsp;&middot;&nbsp; " + esc(String(diag.captured_at)) : "") +
    "</div>";

  var phases = DIAG_PHASE_GROUPS.map(function (g) {
    var inPhase = requested.filter(function (tid) { return g.tools.indexOf(tid) >= 0; });
    if (!inPhase.length) return "";
    var badges = inPhase.map(function (tid) {
      var r = results[tid]; if (!r) return "";
      var cls = diagStatusClass(r.status || "error");
      var label = tid.replace(/^get_/, "").replace(/_/g, " ");
      var cnt = (r.status === "ok" && r.row_count > 0) ? " <span class='diag-rowcount'>" + esc(String(r.row_count)) + "</span>" : "";
      var dur = (r.duration_ms != null) ? " <span class='diag-duration'>" + esc(String(r.duration_ms)) + "ms</span>" : "";
      return "<button type='button' class='diag-tool-badge " + cls + "' data-tool='" + esc(tid) + "'>" + esc(label) + cnt + dur + "</button>";
    }).join("");
    return "<div class='diag-phase-section'>" +
      "<div class='diag-phase-title'>" + esc(g.label) + "</div>" +
      "<div class='diag-phase-badges'>" + badges + "</div>" +
      "</div>";
  }).join("");

  return "<div class='diag-panel'>" + summary + phases + "<div id='diagDetailBox' class='diag-detail-box hidden'></div></div>";
}

function renderDiagToolRows(result: any): string {
  if (!result) return "<div class='diag-detail-msg'>No data.</div>";
  var status = String(result.status || "unknown");
  if (status !== "ok") return "<div class='diag-detail-msg " + diagStatusClass(status) + "'>" + esc(String(result.reason || result.error || status)) + "</div>";
  var rows: any[] = result.rows || [];
  if (!rows.length) return "<div class='diag-detail-msg diag-status-empty'>No rows returned.</div>";
  if (rows.length === 1 && typeof rows[0] === "object" && !Array.isArray(rows[0])) {
    var isNested = Object.keys(rows[0]).some(function (k) { return typeof rows[0][k] === "object" && rows[0][k] !== null; });
    if (isNested) return "<div style='font-family:var(--font-code);font-size:12px;line-height:1.5;padding:8px'>" + renderJsonTree(rows[0]) + "</div>";
  }
  if (typeof rows[0] === "object" && !Array.isArray(rows[0])) {
    var cols = Object.keys(rows[0]);
    if (cols.length) {
      var thead = cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("");
      var tbody = rows.map(function (row: any, ri: number) {
        var cells = cols.map(function (c) {
          var v = row[c]; var s = (v == null) ? "" : String(v);
          if (s.length > 300) s = s.substring(0, 300) + "...";
          return "<td><pre class='cell-pre'>" + esc(s) + "</pre></td>";
        }).join("");
        return "<tr><td class='no-cell'>" + String(ri + 1) + "</td>" + cells + "</tr>";
      }).join("");
      return "<div class='diag-rows-scroll'><table class='kv-table'><thead><tr><th class='no-cell'>No</th>" + thead + "</tr></thead><tbody>" + tbody + "</tbody></table></div>";
    }
  }
  return "<div style='font-family:var(--font-code);font-size:12px;line-height:1.5;padding:8px'>" + renderJsonTree(rows) + "</div>";
}

function bindDiagnosticsPanel(diag: any): void {
  var panel = document.querySelector(".diag-panel") as HTMLElement | null;
  if (!panel) return;
  var detailBox = document.getElementById("diagDetailBox");
  if (!detailBox) return;
  var results: Record<string, any> = (diag && diag.results) || {};
  var badges = panel.querySelectorAll(".diag-tool-badge");
  var active = "";
  for (var i = 0; i < badges.length; i++) {
    (function (b: Element) {
      b.addEventListener("click", function () {
        var tid = (b as HTMLElement).getAttribute("data-tool") || "";
        if (active === tid) {
          detailBox.classList.add("hidden");
          detailBox.innerHTML = "";
          active = "";
          b.classList.remove("diag-active");
          return;
        }
        for (var j = 0; j < badges.length; j++) badges[j].classList.remove("diag-active");
        b.classList.add("diag-active");
        active = tid;
        detailBox.innerHTML = "<div class='diag-detail-title'>" + esc(tid) + "</div>" + renderDiagToolRows(results[tid]);
        detailBox.classList.remove("hidden");
      });
    })(badges[i]);
  }
}

function renderTabbedFindingModal(finding: any): string {
  if (!finding || !finding.has_diagnostics) return renderCleanDetail(finding);
  return "<div class='finding-modal-tabs'>" +
    "<div class='finding-tab-bar'>" +
    "<button type='button' class='finding-tab-btn active' data-tab='detail'>Detail</button>" +
    "<button type='button' class='finding-tab-btn' data-tab='diag'>Diagnostics</button>" +
    "</div>" +
    "<div class='finding-tab-pane' id='ftab-detail'>" + renderCleanDetail(finding) + "</div>" +
    "<div class='finding-tab-pane hidden' id='ftab-diag'><div class='diag-loading'>Loading...</div></div>" +
    "</div>";
}

function renderTabbedMetricsModal(metrics: any, hasDiag: boolean): string {
  var metricsHtml = renderSlowSessionMetricsTable(metrics);
  if (!hasDiag) return metricsHtml;
  return "<div class='finding-modal-tabs'>" +
    "<div class='finding-tab-bar'>" +
    "<button type='button' class='finding-tab-btn active' data-tab='detail'>Metrics</button>" +
    "<button type='button' class='finding-tab-btn' data-tab='diag'>Diagnostics</button>" +
    "</div>" +
    "<div class='finding-tab-pane' id='ftab-detail'>" + metricsHtml + "</div>" +
    "<div class='finding-tab-pane hidden' id='ftab-diag'><div class='diag-loading'>Loading...</div></div>" +
    "</div>";
}

function bindFindingModalTabs(findingId: string): void {
  var tabBar = document.querySelector(".finding-tab-bar") as HTMLElement | null;
  if (!tabBar) return;
  var loaded = false;
  var btns = tabBar.querySelectorAll(".finding-tab-btn");
  for (var i = 0; i < btns.length; i++) {
    (function (btn: Element) {
      btn.addEventListener("click", async function () {
        var tab = (btn as HTMLElement).getAttribute("data-tab") || "";
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove("active");
        btn.classList.add("active");
        var dp = document.getElementById("ftab-detail");
        var pp = document.getElementById("ftab-diag");
        if (dp) dp.classList.toggle("hidden", tab !== "detail");
        if (pp) pp.classList.toggle("hidden", tab !== "diag");
        if (tab === "diag" && !loaded) {
          loaded = true;
          try {
            var diag = await apiGet("/api/findings/" + encodeURIComponent(findingId) + "/diagnostics");
            if (pp) {
              pp.innerHTML = renderDiagnosticsPanel(diag);
              bindDiagnosticsPanel(diag);
            }
          } catch (e) {
            var status = e && e.status ? Number(e.status) : 0;
            if (pp) {
              pp.innerHTML = status === 404
                ? "<div class='diag-empty-msg'>No diagnostics data.</div>"
                : "<div class='diag-empty-msg'>Failed to load diagnostics.</div>";
            }
          }
        }
      });
    })(btns[i]);
  }
}

function removePlanXmlFields(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(removePlanXmlFields);
  if (typeof obj !== "object") return obj;

  var out: any = {};
  Object.keys(obj).forEach(function (k) {
    var lk = k.toLowerCase();
    if (lk === "query_plan_xml" || lk === "plan_xml" || lk === "showplan_xml") return;
    out[k] = removePlanXmlFields(obj[k]);
  });
  return out;
}

function buildCleanDetailPayload(d: any): any {
  var finding = removePlanXmlFields({
    finding_id: d && d.finding_id,
    detected_at: d && d.detected_at,
    topic_id: d && d.topic_id,
    issue_type: d && d.issue_type,
    severity: d && d.severity,
    node: d && d.node,
    role: d && d.role,
    alert_status: d && d.alert_status,
    finding_hash: d && d.finding_hash,
    metrics: d && d.metrics,
    plan_patterns: d && d.plan_patterns,
    query_text: d && d.query_text
  });

  var ai = removePlanXmlFields({
    analysis_text: d && d.analysis_text,
    root_cause_summary: d && d.root_cause_summary,
    top_actions: d && d.top_actions,
    ai_analysis_id: d && d.ai_analysis_id
  });

  var hasAi = !!(ai.analysis_text || ai.root_cause_summary || (Array.isArray(ai.top_actions) && ai.top_actions.length) || ai.ai_analysis_id);
  return hasAi ? { finding: finding, ai_analysis: ai } : { finding: finding };
}

function renderJsonTree(value: any, key?: string): string {
  var keyHtml = key ? "<span style='color:var(--color-accent-strong)'>\"" + esc(key) + "\"</span>: " : "";
  if (value === null) return "<div>" + keyHtml + "<span style='color:var(--color-muted)'>null</span></div>";

  var t = typeof value;
  if (t === "string") return "<div>" + keyHtml + "<span style='color:var(--color-warning)'>\"" + esc(value) + "\"</span></div>";
  if (t === "number" || t === "boolean") return "<div>" + keyHtml + "<span style='color:var(--color-text)'>" + esc(String(value)) + "</span></div>";

  if (Array.isArray(value)) {
    if (!value.length) return "<div>" + keyHtml + "[]</div>";
    var arrItems = value.map(function (v, i) { return renderJsonTree(v, String(i)); }).join("");
    return "<details open><summary>" + keyHtml + "[" + value.length + "]</summary><div style='margin-left:16px'>" + arrItems + "</div></details>";
  }

  var keys = Object.keys(value || {});
  if (!keys.length) return "<div>" + keyHtml + "{}</div>";
  var objItems = keys.map(function (k) { return renderJsonTree(value[k], k); }).join("");
  return "<details open><summary>" + keyHtml + "{" + keys.length + "}</summary><div style='margin-left:16px'>" + objItems + "</div></details>";
}

function renderCleanDetail(d: any): string {
  var payload = buildCleanDetailPayload(d);
  var toolbar = "<div style='margin-bottom:8px'><button id='expandAllJson' type='button'>Expand all</button> <button id='collapseAllJson' type='button'>Collapse all</button></div>";
  var tree = "<div id='jsonTree' style='font-family:Consolas,monospace;font-size:12px;line-height:1.5'>" + renderJsonTree(payload) + "</div>";
  return toolbar + tree;
}

function renderAiAnalysisTable(ai: any): string {
  if (!ai || typeof ai !== "object") return "<div>Khong co AI analysis.</div>";
  var clean: any = {};
  Object.keys(ai).forEach(function (k) {
    if (k === "finding_snapshot") return;
    clean[k] = ai[k];
  });

  var viewFields: Record<string, boolean> = {
    analysis_text: true,
    root_cause_summary: true,
    tool_calls: true,
    top_actions: true
  };

  var rows = Object.keys(clean).map(function (k, idx) {
    var v = clean[k];
    var isViewField = !!viewFields[k];
    if (isViewField) {
      return "<tr><td class='no-cell'>" + String(idx + 1) + "</td><td>" + esc(k) + "</td><td><button type='button' class='btn-inline btn-ai-field' data-field='" + esc(k) + "'>Xem</button></td></tr>";
    }

    var display = (typeof v === "object" && v !== null) ? JSON.stringify(v) : String(v);
    return "<tr><td class='no-cell'>" + String(idx + 1) + "</td><td>" + esc(k) + "</td><td>" + esc(display) + "</td></tr>";
  }).join("");

  var payload = esc(JSON.stringify(clean));
  return "<div id='aiAnalysisBox' data-ai='" + payload + "'><table class='kv-table'><thead><tr><th class='no-cell'>No</th><th>Field</th><th>Value</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
}


function renderSlowSessionMetricsTable(metrics: any): string {
  var m = metrics || {};
  var sessionCols = [
    "session_id",
    "query_hash",
    "elapsed_seconds",
    "cpu_time_seconds",
    "logical_reads",
    "command",
    "host_name",
    "actual_plan_xml"
  ];
  var blockingCols = [
    "blocking_session_id",
    "wait_type",
    "wait_seconds",
    "blocker_login",
    "blocker_host",
    "blocker_status",
    "blocker_open_txn",
    "wait_resource"
  ];

  function renderMetricTable(title: string, cols: string[], emptyText?: string, planField?: string): string {
    var isSlowSessionHeader = title === "Slow session information";
    var titleHtml = "<div class='metric-section-title'>" + esc(title) + "</div>";
    if (isSlowSessionHeader) {
      titleHtml =
        "<div class='metric-section-title-wrap'>" +
        "<div class='metric-section-title'>" + esc(title) + "</div>" +
        "<div class='slow-analyze-wrap'>" +
        "<button type='button' class='slow-analyze-btn'>Analyze</button>" +
        "<div class='slow-analyze-menu'>" +
        "<button type='button' class='slow-analyze-option' data-plan-kind='compile'>Compile XML</button>" +
        "<button type='button' class='slow-analyze-option' data-plan-kind='actual'>Actual XML</button>" +
        "</div>" +
        "</div>" +
        "</div>";
    }
    if (!cols.length) return "";
    if (emptyText) {
      return "<div class='metric-section'>" +
        titleHtml +
        "<div class='metric-empty'>" + esc(emptyText) + "</div>" +
        "</div>";
    }
    var rowClass = planField ? "metric-row metric-row-clickable" : "metric-row";
    var rowAttr = planField ? (" data-plan-field='" + esc(planField) + "'") : "";
    var row = "<td class='no-cell'>1</td>" + cols.map(function (c) { return cellFor(c); }).join("");
    var head = cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("");
    return "<div class='metric-section'>" +
      titleHtml +
      "<table class='kv-table'><thead><tr><th class='no-cell'>No</th>" + head + "</tr></thead><tbody><tr class='" + rowClass + "'" + rowAttr + ">" + row + "</tr></tbody></table>" +
      "</div>";
  }

  function asText(v: any): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function cellFor(field: string): string {
    var val = asText(m[field]);
    if (field === "query_plan_xml" || field === "blocker_plan_xml" || field === "actual_plan_xml") {
      if (!val) return "<td></td>";
      return "<td class='clickable-cell' data-field='" + esc(field) + "'><span class='plan-open-chip'>Open Plan</span></td>";
    }
    return "<td><pre class='cell-pre'>" + esc(val) + "</pre></td>";
  }

  var blockingTable = "";
  if (hasBlockingSession(m)) {
    blockingTable = renderMetricTable("Blocking information", blockingCols, undefined, "blocker_plan_xml");
  } else {
    blockingTable = renderMetricTable("Blocking information", [], "Khong co blocking session.");
  }

  return "<div id='slowMetricsBox'>" +
    renderMetricTable("Slow session information", sessionCols, undefined, "query_plan_xml") +
    blockingTable +
    "<div id='slowMetricsDetail' class='metrics-detail'>" +
    "<div id='slowMetricsPlanSection' class='metrics-plan-section show'>" +
    //"<div class='metrics-plan-title'>Execution Plan</div>" +
    "<div id='slowMetricsPlanBox' class='plan-modal-box metrics-plan-box'></div>" +
    "</div></div>" +
    "</div>";
}

function bindSlowSessionMetricActions(metrics: any) {
  var box = document.getElementById("slowMetricsBox");
  if (!box) return;
  var payload = {
    sql_text: metrics && metrics.sql_text !== undefined && metrics.sql_text !== null ? String(metrics.sql_text) : "",
    query_plan_xml: metrics && metrics.query_plan_xml !== undefined && metrics.query_plan_xml !== null ? String(metrics.query_plan_xml) : "",
    actual_plan_xml: metrics && metrics.actual_plan_xml !== undefined && metrics.actual_plan_xml !== null ? String(metrics.actual_plan_xml) : "",
    blocker_sql_text: metrics && metrics.blocker_sql_text !== undefined && metrics.blocker_sql_text !== null ? String(metrics.blocker_sql_text) : "",
    blocker_plan_xml: metrics && metrics.blocker_plan_xml !== undefined && metrics.blocker_plan_xml !== null ? String(metrics.blocker_plan_xml) : ""
  };
  var cells = box.querySelectorAll(".clickable-cell");
  var rows = box.querySelectorAll(".metric-row-clickable");
  var detail = box.querySelector("#slowMetricsDetail") as HTMLElement | null;
  var planSection = box.querySelector("#slowMetricsPlanSection") as HTMLElement | null;
  var planBox = box.querySelector("#slowMetricsPlanBox") as HTMLElement | null;
  var analyzeBtn = box.querySelector(".slow-analyze-btn") as HTMLButtonElement | null;
  var analyzeMenu = box.querySelector(".slow-analyze-menu") as HTMLElement | null;
  var analyzeOptions = box.querySelectorAll(".slow-analyze-option");

  function setPlanField(field: string, xmlText: string) {
    if (!detail || !planSection || !planBox) return;
    detail.classList.add("show");
    planSection.classList.add("show");
    var hasBlockingSql = !!(payload.blocker_sql_text && payload.blocker_sql_text.trim());
    var shouldHideRuntimeHeader = field === "actual_plan_xml" ? false : true;
    if (field === "blocker_plan_xml" && hasBlockingSql) shouldHideRuntimeHeader = false;
    var sqlText = field === "blocker_plan_xml" ? payload.blocker_sql_text : payload.sql_text;
    var forceSqlFill = field === "actual_plan_xml";
    renderExecutionPlanToBox(planBox, xmlText, field, shouldHideRuntimeHeader, sqlText, forceSqlFill);
  }

  function resolveSlowSessionPlanSelection(): { field: string; xml: string } {
    if (payload.query_plan_xml && payload.query_plan_xml.trim()) {
      return { field: "query_plan_xml", xml: payload.query_plan_xml };
    }
    return { field: "actual_plan_xml", xml: payload.actual_plan_xml };
  }

  async function runAnalyzeByKind(kind: string) {
    var sourceField = kind === "actual" ? "actual_plan_xml" : "query_plan_xml";
    var xml = String(payload[sourceField] || "").trim();
    if (!xml) {
      openModal("Plan Analysis", "<div class='pa-error'>Khong co " + esc(kind === "actual" ? "Actual XML" : "Compile XML") + " de phan tich.</div>");
      return;
    }
    try {
      var result = await apiPost("/api/plan/analyze", { plan_xml: xml }) as PlanAnalysisResult;
      var mountId = "pa-root-" + String(Date.now());
      openModal("Plan Analysis", "<div id='" + mountId + "'></div>");
      var root = document.getElementById(mountId);
      if (!root) return;
      new PlanAnalysisComponent(root, result).render();
    } catch (e) {
      var status = e && e.status ? String(e.status) : "unknown";
      var payloadErr = e && e.payload ? JSON.stringify(e.payload, null, 2) : "";
      openModal(
        "Plan Analysis - Error",
        "<div class='pa-error'><p>Khong the phan tich plan. Kiem tra Layer 2.</p><div>Status: " + esc(status) + "</div>" +
        (payloadErr ? "<pre>" + esc(payloadErr) + "</pre>" : "") + "</div>"
      );
    }
  }

  for (var r = 0; r < rows.length; r++) {
    (function (row: Element) {
      row.addEventListener("click", function () {
        var field = (row as HTMLElement).getAttribute("data-plan-field") || "";
        if (field === "query_plan_xml") {
          var slowPlan = resolveSlowSessionPlanSelection();
          setPlanField(slowPlan.field, slowPlan.xml);
          return;
        }
        if (field === "blocker_plan_xml") {
          setPlanField(field, payload[field] || "");
        }
      });
    })(rows[r]);
  }

  for (var i = 0; i < cells.length; i++) {
    (function (cell: Element) {
      cell.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var field = (cell as HTMLElement).getAttribute("data-field") || "";
        if (field === "actual_plan_xml" || field === "query_plan_xml" || field === "blocker_plan_xml") {
          setPlanField(field, payload[field] || "");
        }
      });
    })(cells[i]);
  }

  var initialSlowPlan = resolveSlowSessionPlanSelection();
  setPlanField(initialSlowPlan.field, initialSlowPlan.xml);

  if (analyzeBtn && analyzeMenu) {
    var closeAnalyzeMenu = function () {
      analyzeMenu.classList.remove("is-open");
    };
    var openAnalyzeMenu = function () {
      var rect = analyzeBtn.getBoundingClientRect();
      analyzeMenu.style.left = String(Math.max(8, rect.right - 136)) + "px";
      analyzeMenu.style.top = String(rect.bottom + 6) + "px";
      analyzeMenu.classList.add("is-open");
    };
    analyzeBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (analyzeMenu.classList.contains("is-open")) {
        closeAnalyzeMenu();
        return;
      }
      openAnalyzeMenu();
    });
    document.addEventListener("click", function (ev) {
      var t = ev.target as HTMLElement | null;
      if (!t) return;
      if (!t.closest(".slow-analyze-wrap") && !t.closest(".slow-analyze-menu")) closeAnalyzeMenu();
    });
  }

  for (var o = 0; o < analyzeOptions.length; o++) {
    (function (el: Element) {
      el.addEventListener("click", async function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var btn = el as HTMLButtonElement;
        var kind = String(btn.getAttribute("data-plan-kind") || "compile");
        if (analyzeMenu) {
          analyzeMenu.classList.remove("is-open");
        }
        await withButtonLoading(btn, async function () {
          await runAnalyzeByKind(kind);
        }, "Analyzing...");
      });
    })(analyzeOptions[o]);
  }
}

function isRuntimeExecutionPlanXml(xmlText: string): boolean {
  var x = String(xmlText || "");
  if (!x.trim()) return false;
  var lower = x.toLowerCase();
  if (lower.indexOf("runtimeinformation") >= 0) return true;
  if (lower.indexOf("runtimecountersperthread") >= 0) return true;
  if (lower.indexOf("actualrows") >= 0) return true;
  if (lower.indexOf("actualelapsedms") >= 0) return true;
  if (lower.indexOf("actualexecutions") >= 0) return true;
  return false;
}

function renderExecutionPlanToBox(
  planBox: HTMLElement,
  xmlText: string,
  _sourceField?: string,
  hideRuntimeHeader = true,
  sqlTextFallback?: string,
  forceSqlFill = false
) {
  var normalized = String(xmlText || "");
  var isRuntimePlan = hideRuntimeHeader && isRuntimeExecutionPlanXml(normalized);
  if (isRuntimePlan) {
    planBox.classList.add("plan-source-actual");
  } else {
    planBox.classList.remove("plan-source-actual");
  }
  if (!normalized.trim()) {
    var sqlFallback = String(sqlTextFallback || "").trim();
    if (sqlFallback) {
      planBox.innerHTML =
        "<div class='metrics-plan-fallback'>" +
        "<div class='metrics-plan-fallback-title'>SQL Text</div>" +
        "<pre class='cell-pre metrics-plan-fallback-pre'>" + esc(sqlFallback) + "</pre>" +
        "</div>";
    } else {
      planBox.innerText = "Khong co execution plan.";
    }
    return;
  }
  ensureQpParserLoaded(function (ok) {
    if (!ok) {
      planBox.innerText = "Khong tai duoc QP parser.";
      return;
    }
    try {
      var qpObj = getQpGlobal();
      if (qpObj && typeof qpObj.showPlan === "function") {
        qpObj.showPlan(planBox, normalized);
        planBox.setAttribute("data-current-plan-xml", normalized);
        ensurePlanHeaderSqlText(planBox, sqlTextFallback || "", forceSqlFill);
        requestAnimationFrame(function () {
          redrawExecutionPlanConnectors(planBox);
          requestAnimationFrame(function () {
            redrawExecutionPlanConnectors(planBox);
            ensurePlanHeaderSqlText(planBox, sqlTextFallback || "", forceSqlFill);
          });
        });
        setTimeout(function () {
          ensurePlanHeaderSqlText(planBox, sqlTextFallback || "", forceSqlFill);
        }, 180);
        setTimeout(function () {
          ensurePlanHeaderSqlText(planBox, sqlTextFallback || "", forceSqlFill);
        }, 500);
        bindExecutionPlanActions(planBox);
      } else {
        planBox.innerText = "Khong tai duoc QP parser.";
      }
    } catch (_e) {
      planBox.innerHTML = "<pre>" + esc(normalized) + "</pre>";
    }
  });
}

function bindExecutionPlanActions(planBox: HTMLElement) {
  var qpObj = getQpGlobal();
  if (!qpObj || typeof qpObj.bindQueryActions !== "function") return;

  function getCurrentXml(): string {
    return String(planBox.getAttribute("data-current-plan-xml") || "");
  }

  if (planBox.getAttribute("data-qp-actions-bound") !== "1") {
    qpObj.bindQueryActions(planBox, {
      onOpenQueryPopup: function (ctx: any) {
        var txt = String((ctx && ctx.queryText) || "");
        openModal("SQL Text Detail", "<pre id='sqlDetailPre'>Formatting...</pre>");
        var pre = document.getElementById("sqlDetailPre");
        if (!pre) return;
        if (qpObj && typeof qpObj.beautifySqlWithFallback === "function") {
          qpObj.beautifySqlWithFallback(txt).then(function (formatted: string) {
            pre.textContent = formatted || "";
          }).catch(function () {
            pre.textContent = txt;
          });
          return;
        }
        pre.textContent = txt;
      },
      onShowPlanXml: function () {
        var xmlText = getCurrentXml();
        var treeHtml = (qpObj && typeof qpObj.buildXmlTreeHtml === "function")
          ? qpObj.buildXmlTreeHtml(String(xmlText || ""))
          : ("<div class='xml-text'>Cannot parse XML.</div>");
        openModal(
          "Show Plan XML",
          "<div style='margin-bottom:8px'><button id='expandAllXml' type='button'>Expand all</button> <button id='collapseAllXml' type='button'>Collapse all</button></div>" +
          "<div id='xmlViewerContent' class='xml-viewer-content tree'>" +
          treeHtml +
          "</div>"
        );
        bindXmlTreeToolbar();
      },
      onCopyPlanXml: function () {
        var xmlText = getCurrentXml();
        copyTextToClipboardWithFallback(String(xmlText || ""));
      },
      onBeautify: function (ctx: any) {
        if (qpObj && typeof qpObj.applyBeautifyToBlock === "function" && ctx && ctx.block) {
          qpObj.applyBeautifyToBlock(ctx.block);
        }
      }
    });
    planBox.setAttribute("data-qp-actions-bound", "1");
  }

  ensureAnalyzeButton(planBox, getCurrentXml);
}

function ensureAnalyzeButton(planBox: HTMLElement, getCurrentXml: () => string) {
  var tabs = planBox.querySelectorAll(".qp-query-tabs");
  for (var i = 0; i < tabs.length; i++) {
    var tabHost = tabs[i] as HTMLElement;
    if (tabHost.querySelector(".qp-open-plan-analyze")) continue;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "qp-query-tab qp-query-action qp-open-plan-analyze";
    btn.textContent = "Analyze";
    tabHost.appendChild(btn);
  }

  if (planBox.getAttribute("data-qp-analyze-bound") !== "1") {
    planBox.addEventListener("click", async function (event) {
      var t = event.target as HTMLElement | null;
      if (!t) return;
      var btn = t.closest(".qp-open-plan-analyze") as HTMLButtonElement | null;
      if (!btn) return;
      var xml = String(getCurrentXml() || "").trim();
      if (!xml) {
        openModal("Plan Analysis", "<div class='pa-error'>Plan XML is empty.</div>");
        return;
      }
      await withButtonLoading(btn, async function () {
        try {
          var result = await apiPost("/api/plan/analyze", { plan_xml: xml }) as PlanAnalysisResult;
          var mountId = "pa-root-" + String(Date.now());
          openModal("Plan Analysis", "<div id='" + mountId + "'></div>");
          var root = document.getElementById(mountId);
          if (!root) return;
          new PlanAnalysisComponent(root, result).render();
        } catch (e) {
          var status = e && e.status ? String(e.status) : "unknown";
          var payload = e && e.payload ? JSON.stringify(e.payload, null, 2) : "";
          openModal(
            "Plan Analysis - Error",
            "<div class='pa-error'><p>Khong the phan tich plan. Kiem tra Layer 2.</p><div>Status: " + esc(status) + "</div>" +
            (payload ? "<pre>" + esc(payload) + "</pre>" : "") + "</div>"
          );
        }
      }, "Analyzing...");
    });
    planBox.setAttribute("data-qp-analyze-bound", "1");
  }
}

function ensurePlanHeaderSqlText(planBox: HTMLElement, sqlTextFallback: string, forceFill?: boolean) {
  var sql = String(sqlTextFallback || "").trim();
  if (!sql) return;
  var targets = planBox.querySelectorAll(".qp-real-query, .qp-resolved-query");
  for (var i = 0; i < targets.length; i++) {
    var el = targets[i] as HTMLElement;
    var current = String(el.textContent || "").trim();
    if (!forceFill && current) continue;
    if ((el as any).value !== undefined) {
      try { (el as any).value = sql; } catch (_e) { }
    }
    el.textContent = sql;
  }
}

function redrawExecutionPlanConnectors(planBox: HTMLElement) {
  var qpObj = getQpGlobal();
  if (!qpObj || typeof qpObj.drawLines !== "function") return;
  var canvases = planBox.querySelectorAll(".qp-diagram-canvas");
  for (var i = 0; i < canvases.length; i++) {
    var oldSvgs = (canvases[i] as HTMLElement).querySelectorAll("svg");
    for (var j = 0; j < oldSvgs.length; j++) {
      if (oldSvgs[j].parentElement) oldSvgs[j].parentElement!.removeChild(oldSvgs[j]);
    }
  }
  qpObj.drawLines(planBox);
}

function bindXmlTreeToolbar() {
  var tree = document.getElementById("xmlViewerContent");
  var expand = document.getElementById("expandAllXml");
  var collapse = document.getElementById("collapseAllXml");
  if (!tree) return;
  if (expand) {
    expand.addEventListener("click", function () {
      var nodes = tree.querySelectorAll("details");
      for (var i = 0; i < nodes.length; i++) (nodes[i] as HTMLDetailsElement).open = true;
    });
  }
  if (collapse) {
    collapse.addEventListener("click", function () {
      var nodes = tree.querySelectorAll("details");
      for (var i = 0; i < nodes.length; i++) (nodes[i] as HTMLDetailsElement).open = false;
    });
  }
}

function getQpGlobal(): any {
  if (typeof QP !== "undefined" && QP) return QP;
  if (typeof window !== "undefined" && window) {
    if (window.QP) return window.QP;
  }
  return null;
}

function loadScript(src: string, done: (ok: boolean) => void) {
  var existing = document.querySelector("script[data-src='" + src + "']") as HTMLScriptElement | null;
  if (existing) {
    existing.addEventListener("load", function () { done(true); });
    existing.addEventListener("error", function () { done(false); });
    return;
  }
  var s = document.createElement("script");
  s.src = src;
  s.async = false;
  s.setAttribute("data-src", src);
  s.onload = function () { done(true); };
  s.onerror = function () { done(false); };
  document.head.appendChild(s);
}

function ensureQpParserLoaded(done: (ok: boolean) => void) {
  var qpObj = getQpGlobal();
  if (qpObj && typeof qpObj.showPlan === "function") {
    done(true);
    return;
  }
  loadScript("/dist/qp.js", function (okFirst) {
    var foundFirst = getQpGlobal();
    if (okFirst && foundFirst && typeof foundFirst.showPlan === "function") {
      done(true);
      return;
    }
    loadScript("/dist/qp.min.js", function (okSecond) {
      var foundSecond = getQpGlobal();
      done(!!(okSecond && foundSecond && typeof foundSecond.showPlan === "function"));
    });
  });
}

function bindAiAnalysisFieldButtons() {
  var box = document.getElementById("aiAnalysisBox");
  if (!box) return;
  var raw = box.getAttribute("data-ai");
  if (!raw) return;
  var ai = JSON.parse(raw);
  var btns = box.querySelectorAll(".btn-ai-field");
  for (var i = 0; i < btns.length; i++) {
    (function (btn: Element) {
      btn.addEventListener("click", function () {
        var field = (btn as HTMLElement).getAttribute("data-field") || "";
        var value = ai[field];
        if (field === "analysis_text" || field === "root_cause_summary") {
          openModal("AI Analysis - " + field, "<pre>" + esc(String(value || "")) + "</pre>");
          return;
        }
        openModal(
          "AI Analysis - " + field,
          "<div style='margin-bottom:8px'><button id='expandAllJson' type='button'>Expand all</button> <button id='collapseAllJson' type='button'>Collapse all</button></div>" +
          "<div id='jsonTree' style='font-family:Consolas,monospace;font-size:12px;line-height:1.5'>" + renderJsonTree(value) + "</div>"
        );
        bindJsonTreeToolbar();
      });
    })(btns[i]);
  }
}

function bindJsonTreeToolbar() {
  var expand = document.getElementById("expandAllJson");
  var collapse = document.getElementById("collapseAllJson");
  var tree = document.getElementById("jsonTree");
  if (!tree) return;

  if (expand) {
    expand.addEventListener("click", function () {
      var nodes = tree.querySelectorAll("details");
      for (var i = 0; i < nodes.length; i++) (nodes[i] as HTMLDetailsElement).open = true;
    });
  }
  if (collapse) {
    collapse.addEventListener("click", function () {
      var nodes = tree.querySelectorAll("details");
      for (var i = 0; i < nodes.length; i++) (nodes[i] as HTMLDetailsElement).open = false;
    });
  }
}

function renderTopicTabs() {
  var box = document.getElementById("topicTabs");
  if (!box) return;
  box.innerHTML = "";

  topics.forEach(function (t: any) {
    var id = String(t.topic_id || "");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "topic-tab" + (id === activeTopicId ? " active" : "");
    btn.textContent = t.name ? String(t.name) : id;
    btn.title = id;
    btn.addEventListener("click", function () {
      withButtonLoading(btn, async function () {
        activeTopicId = id;
        page = 0;
        renderTopicTabs();
        renderFindingsHeader();
        await loadFindings();
      }, "Loading...");
    });
    box.appendChild(btn);
  });
}

// Layout handlers từ registry — render logic per-topic nằm trong topics/layout-registry.ts.
// Function declarations hoisted → khởi tạo module-scope an toàn dù helpers định nghĩa phía dưới.
var layoutHandlers = createTopicLayoutHandlers({
  getPage: function () { return page; },
  getLimit: function () { return limit; },
  esc: esc,
  formatDetectedAtForUi: formatDetectedAtForUi,
  roleNodeCell: roleNodeCell,
  severityBadge: severityBadge,
  alertStatusBadge: alertStatusBadge,
  sessionIdBadge: sessionIdBadge,
  blockingBadge: blockingBadge,
  copyTextToClipboardWithFallback: copyTextToClipboardWithFallback,
  requestKillSession: requestKillSession,
  withGlobalLoading: withGlobalLoading,
  withButtonLoading: withButtonLoading,
  apiGet: apiGet,
  openModal: openModal,
  renderTabbedMetricsModal: renderTabbedMetricsModal,
  bindSlowSessionMetricActions: bindSlowSessionMetricActions,
  bindFindingModalTabs: bindFindingModalTabs,
  renderAiAnalysisTable: renderAiAnalysisTable,
  bindAiAnalysisFieldButtons: bindAiAnalysisFieldButtons,
  renderTabbedFindingModal: renderTabbedFindingModal,
  bindJsonTreeToolbar: bindJsonTreeToolbar,
  headBlockerCell: headBlockerCell,
  blockingStateBadge: blockingStateBadge,
  renderBlockingChainModal: renderBlockingChainModal,
  renderAgHealthModal: renderAgHealthModal,
  attachGlossaryTooltips: attachGlossaryTooltips
});

function renderFindingsHeader(forcedKey?: TopicLayoutKey) {
  var row = document.getElementById("findingsHeadRow");
  if (!row) return;
  var handler = layoutHandlers[forcedKey || activeLayoutKey()];
  row.innerHTML = handler.headerHtml;

  var blockingFilter = document.getElementById("blockingStatusFilter") as HTMLSelectElement | null;
  if (blockingFilter) {
    if (handler.showBlockingFilter) {
      blockingFilter.classList.remove("hidden");
      blockingFilter.disabled = false;
    } else {
      blockingFilter.classList.add("hidden");
      blockingFilter.disabled = true;
    }
  }
}

function buildFindingsQueryParams(
  findingId: string,
  severity: string,
  alertStatus: string,
  blockingStatus: string,
  detectedFrom: string,
  detectedTo: string
): Record<string, string | number | undefined> {
  if (findingId) {
    return {
      finding_id: findingId,
      limit: limit,
      page: page
    };
  }

  return {
    topic_id: activeTopicId,
    limit: limit,
    page: page,
    severity: severity,
    alert_status: alertStatus,
    blocking_status: blockingStatus,
    since: detectedFrom,
    until: detectedTo
  };
}

async function loadTopics() {
  var err = document.getElementById("findingsError");
  if (!err) return;
  await withGlobalLoading(async function () {
    try {
      topics = await apiGet("/api/topics");
      if (!topics || !topics.length) {
        err.textContent = "Chua co topic.";
        return;
      }
      if (!activeTopicId) {
        var defaultTopic = topics[0];
        for (var i = 0; i < topics.length; i++) {
          if (String(topics[i].topic_id || "").toLowerCase() === "slow_sessions") {
            defaultTopic = topics[i];
            break;
          }
        }
        activeTopicId = String(defaultTopic.topic_id || "");
      }
      renderTopicTabs();
    } catch (_e) {
      err.textContent = "Khong tai duoc topics.";
    }
  });
}

async function loadFindings(options?: { silent?: boolean; autoRefreshToken?: number }) {
  var body = document.getElementById("findingsBody");
  var err = document.getElementById("findingsError");
  if (!body || !err) return;
  err.textContent = "";
  var runner = async function () {
    if (options && options.autoRefreshToken !== undefined && options.autoRefreshToken !== autoRefreshTick) return;
    isLoadingFindings = true;
    try {
      syncDetectedAtInputsFromState();
      var findingId = (document.getElementById("findingIdFilter") as HTMLInputElement).value.trim();
      var severity = (document.getElementById("severityFilter") as HTMLSelectElement).value;
      var alertStatus = (document.getElementById("alertStatusFilter") as HTMLSelectElement).value;
      var blockingStatus = isSlowSessionTopic() ? (document.getElementById("blockingStatusFilter") as HTMLSelectElement).value : "";
      var detectedFromRaw = (document.getElementById("detectedFromFilter") as HTMLInputElement).value;
      var detectedToRaw = (document.getElementById("detectedToFilter") as HTMLInputElement).value;
      var detectedFrom = toLocalDateTimeFilterValue(detectedFromRaw);
      var detectedTo = toLocalDateTimeFilterValue(detectedToRaw);

      if (!findingId && detectedFrom && detectedTo && detectedFrom > detectedTo) {
        err.textContent = "Khoang thoi gian khong hop le: from > to.";
        body.innerHTML = "";
        renderFindingTimeline(null);
        return;
      }

      setTimelineCardVisible(!findingId);

      var requests: Promise<any>[] = [
        apiGet("/api/findings", buildFindingsQueryParams(
          findingId,
          severity,
          alertStatus,
          blockingStatus,
          detectedFrom,
          detectedTo
        ))
      ];

      if (!findingId) {
        requests.push(apiGet("/api/findings/timeline", buildTimelineQueryParams(
          severity,
          alertStatus,
          blockingStatus,
          detectedFrom,
          detectedTo
        )));
      }

      var results = await Promise.all(requests);
      var data = results[0];
      var timeline = !findingId ? (results[1] as TimelineResponse) : null;
      if (!findingId) renderFindingTimeline(timeline);
      else renderFindingTimeline(null);

      body.innerHTML = "";
      var c = 0, w = 0, i = 0;
      // Layout theo topic đang chọn; nếu filter theo finding_id cụ thể → theo topic của finding
      var layoutKey = activeLayoutKey();
      if (findingId && data.length === 1) layoutKey = layoutKeyForTopic(data[0].topic_id);
      renderFindingsHeader(layoutKey);
      var handler = layoutHandlers[layoutKey];

      data.forEach(function (x: any, idx: number) {
        if (x.severity === "CRITICAL") c++; else if (x.severity === "WARNING") w++; else i++;
        var tr = document.createElement("tr");
        tr.className = "clickable-finding-row";
        handler.renderRow(tr, x, idx);
        body.appendChild(tr);
      });

      (document.getElementById("criticalCount") as HTMLElement).textContent = String(c);
      (document.getElementById("warningCount") as HTMLElement).textContent = String(w);
      (document.getElementById("infoCount") as HTMLElement).textContent = String(i);
      (document.getElementById("pageInfo") as HTMLElement).textContent = "Page " + String(page + 1);
    } catch (_e) {
      err.textContent = "Khong tai duoc findings.";
      renderFindingTimeline(null);
    } finally {
      isLoadingFindings = false;
    }
  };
  if (options && options.silent) {
    await runner();
  } else {
    await withGlobalLoading(runner);
  }
}

function toLocalDateTimeFilterValue(v: string): string {
  if (!v) return "";
  // Keep wall-clock time selected by user and serialize as UTC-naive (Z),
  // matching current DB convention where local(+7) wall-clock is stored with +00 suffix.
  var base = v.length === 16 ? (v + ":00") : v;
  return base + "Z";
}

function copyTextToClipboardWithFallback(text: string) {
  var nav: any = navigator;
  if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
    nav.clipboard.writeText(text).catch(function () {
      fallbackCopyText(text);
    });
    return;
  }
  fallbackCopyText(text);
}

function fallbackCopyText(text: string) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "readonly");
  ta.style.position = "fixed";
  ta.style.top = "-10000px";
  ta.style.left = "-10000px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (_e) { }
  document.body.removeChild(ta);
}

function bindTimePickerEvents(): void {
  var timeBtn = document.getElementById("timeRangeBtn") as HTMLButtonElement | null;
  var quickApplyBtn = document.getElementById("applyQuickRangeBtn") as HTMLButtonElement | null;
  var customApplyBtn = document.getElementById("applyCustomRangeBtn") as HTMLButtonElement | null;
  var shiftBackBtn = document.getElementById("timeShiftBackBtn") as HTMLButtonElement | null;
  var shiftForwardBtn = document.getElementById("timeShiftForwardBtn") as HTMLButtonElement | null;
  var autoRefreshToggle = document.getElementById("autoRefreshToggle") as HTMLInputElement | null;
  var autoRefreshValue = document.getElementById("autoRefreshValue") as HTMLInputElement | null;
  var autoRefreshUnit = document.getElementById("autoRefreshUnit") as HTMLSelectElement | null;
  if (!timeBtn || !quickApplyBtn || !customApplyBtn || !autoRefreshToggle || !autoRefreshValue || !autoRefreshUnit) return;

  timeBtn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    var popover = document.getElementById("timePickerPopover");
    setTimePickerOpen(!!popover && popover.classList.contains("hidden"));
  });

  quickApplyBtn.addEventListener("click", async function () {
    var amountEl = document.getElementById("quickRangeAmount") as HTMLInputElement | null;
    var unitEl = document.getElementById("quickRangeUnit") as HTMLSelectElement | null;
    var amount = Math.max(1, Number(amountEl && amountEl.value) || 15);
    var unit = String(unitEl && unitEl.value || "minutes");
    applyTimeRangeState(buildRelativeTimeRange(amount, unit, "Last " + String(amount) + " " + unit));
    setTimePickerOpen(false);
    page = 0;
    await loadFindings();
  });

  customApplyBtn.addEventListener("click", async function () {
    var fromCustom = document.getElementById("detectedFromCustom") as HTMLInputElement | null;
    var toCustom = document.getElementById("detectedToCustom") as HTMLInputElement | null;
    var err = document.getElementById("findingsError");
    if (!fromCustom || !toCustom || !err) return;
    var from = readLocalDateTimeInput(fromCustom.value);
    var to = readLocalDateTimeInput(toCustom.value);
    if (!from || !to) {
      err.textContent = "Custom time range is incomplete.";
      return;
    }
    if (from.getTime() > to.getTime()) {
      err.textContent = "Custom time range is invalid: from > to.";
      return;
    }
    err.textContent = "";
    applyTimeRangeState(buildAbsoluteTimeRange(fromCustom.value, toCustom.value, "Custom range"));
    setTimePickerOpen(false);
    page = 0;
    await loadFindings();
  });

  if (shiftBackBtn) {
    shiftBackBtn.addEventListener("click", async function () {
      shiftActiveRange(-1);
      page = 0;
      await loadFindings();
    });
  }
  if (shiftForwardBtn) {
    shiftForwardBtn.addEventListener("click", async function () {
      shiftActiveRange(1);
      page = 0;
      await loadFindings();
    });
  }

  var presetBtns = document.querySelectorAll(".time-preset-link");
  for (var i = 0; i < presetBtns.length; i++) {
    presetBtns[i].addEventListener("click", async function (ev) {
      ev.preventDefault();
      var btn = ev.currentTarget as HTMLElement;
      var presetId = String(btn.getAttribute("data-preset") || "");
      var preset = presetTimeRange(presetId);
      applyTimeRangeState({ mode: "preset", presetId: presetId, label: preset.label });
      setTimePickerOpen(false);
      page = 0;
      await loadFindings();
    });
  }

  var recentHost = document.getElementById("recentRangesList");
  if (recentHost) {
    recentHost.addEventListener("click", async function (ev) {
      var target = ev.target as HTMLElement | null;
      if (!target) return;
      var btn = target.closest(".time-recent-link") as HTMLElement | null;
      if (!btn) return;
      ev.preventDefault();
      var idx = Number(btn.getAttribute("data-recent-idx"));
      var items = recentRangeItems();
      var item = items[idx];
      if (!item) return;
      applyTimeRangeState(item, false);
      setTimePickerOpen(false);
      page = 0;
      await loadFindings();
    });
  }

  autoRefreshToggle.addEventListener("change", function () {
    persistAutoRefreshSettings();
    scheduleAutoRefresh();
  });
  autoRefreshValue.addEventListener("change", function () {
    persistAutoRefreshSettings();
    scheduleAutoRefresh();
  });
  autoRefreshUnit.addEventListener("change", function () {
    persistAutoRefreshSettings();
    scheduleAutoRefresh();
  });

  document.addEventListener("click", function (ev) {
    var target = ev.target as HTMLElement | null;
    var popover = document.getElementById("timePickerPopover");
    var root = document.querySelector(".time-filter");
    if (!target || !popover || !root) return;
    if (popover.classList.contains("hidden")) return;
    if (root.contains(target)) return;
    setTimePickerOpen(false);
  });

  window.addEventListener("resize", positionTimePicker);
  window.addEventListener("scroll", positionTimePicker, true);

}

function bindEvents() {
  (document.getElementById("reloadBtn") as HTMLButtonElement).addEventListener("click", function (ev) {
    var btn = ev.currentTarget as HTMLButtonElement;
    withButtonLoading(btn, async function () {
      page = 0;
      await loadFindings();
    }, "Searching...");
  });
  (document.getElementById("clearFiltersBtn") as HTMLButtonElement).addEventListener("click", function (ev) {
    var btn = ev.currentTarget as HTMLButtonElement;
    withButtonLoading(btn, async function () {
      (document.getElementById("findingIdFilter") as HTMLInputElement).value = "";
      (document.getElementById("severityFilter") as HTMLSelectElement).value = "";
      (document.getElementById("alertStatusFilter") as HTMLSelectElement).value = "";
      (document.getElementById("blockingStatusFilter") as HTMLSelectElement).value = "";
      activeTimeRange = { mode: "preset", presetId: "last_1_hour", label: "Last 1 hour" };
      initDefaultDetectedAtRange();
      page = 0;
      await loadFindings();
    }, "Clearing...");
  });
  (document.getElementById("prevBtn") as HTMLButtonElement).addEventListener("click", function (ev) {
    if (page <= 0) return;
    var btn = ev.currentTarget as HTMLButtonElement;
    withButtonLoading(btn, async function () {
      page--;
      await loadFindings();
    }, "Loading...");
  });
  (document.getElementById("nextBtn") as HTMLButtonElement).addEventListener("click", function (ev) {
    var btn = ev.currentTarget as HTMLButtonElement;
    withButtonLoading(btn, async function () {
      page++;
      await loadFindings();
    }, "Loading...");
  });

  window.addEventListener("resize", function () {
    if (latestTimelineData) renderFindingTimeline(latestTimelineData);
  });
}

bindModalEvents();
bindTimePickerEvents();
bindEvents();
restoreAutoRefreshSettings();
initDefaultDetectedAtRange();
loadTopics().then(function () {
  renderFindingsHeader();
  scheduleAutoRefresh();
  return loadFindings();
});
