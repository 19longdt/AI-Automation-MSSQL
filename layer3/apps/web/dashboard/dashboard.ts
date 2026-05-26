import { apiGet, apiPost } from "./api-client";
import { withButtonLoading, withGlobalLoading } from "./loading-overlay";
import { bindModalEvents, openActionConfirmModal, openModal } from "./modal";
declare const QP: any;
declare const window: any;

var page = 0;
var limit = 15;
var activeTopicId = "";
var topics: any[] = [];

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

function initDefaultDetectedAtRange() {
  var fromEl = document.getElementById("detectedFromFilter") as HTMLInputElement | null;
  var toEl = document.getElementById("detectedToFilter") as HTMLInputElement | null;
  if (!fromEl || !toEl) return;
  if (fromEl.value || toEl.value) return;

  var now = new Date();
  var oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  fromEl.value = toDateTimeLocalValue(oneHourAgo);
  toEl.value = toDateTimeLocalValue(now);
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

function isSlowSessionFinding(finding: any): boolean {
  return String((finding && finding.topic_id) || "").toLowerCase() === "slow_sessions";
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
  var killButtonLabel = sourceLabel === "blocking_session_id" ? "KILL Blocking" : "KILL Session";
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
    tools: ["get_blocking_chain", "get_wait_stats", "get_memory_grant", "get_tempdb_usage",
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
          } catch (_e) {
            if (pp) pp.innerHTML = "<div class='diag-empty-msg'>Failed to load diagnostics.</div>";
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
    if (!cols.length) return "";
    if (emptyText) {
      return "<div class='metric-section'>" +
        "<div class='metric-section-title'>" + esc(title) + "</div>" +
        "<div class='metric-empty'>" + esc(emptyText) + "</div>" +
        "</div>";
    }
    var rowClass = planField ? "metric-row metric-row-clickable" : "metric-row";
    var rowAttr = planField ? (" data-plan-field='" + esc(planField) + "'") : "";
    var row = "<td class='no-cell'>1</td>" + cols.map(function (c) { return cellFor(c); }).join("");
    var head = cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("");
    return "<div class='metric-section'>" +
      "<div class='metric-section-title'>" + esc(title) + "</div>" +
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
    if (field === "sql_text" || field === "blocker_sql_text") {
      //var isLong = val.length > 180;
      //if (!isLong) return "<td><pre class='cell-pre'>" + esc(val) + "</pre></td>";
      return "<td class='clickable-cell' data-field='" + esc(field) + "'><div class='cell-preview'>" + esc(val.substring(0, 180)) + "...</div></td>";
    }
    if (field === "query_plan_xml" || field === "blocker_plan_xml" || field === "actual_plan_xml") {
      if (!val) return "<td></td>";
      return "<td class='clickable-cell' data-field='" + esc(field) + "'>View</td>";
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
    "<div id='slowMetricsPlanSection' class='metrics-plan-section'>" +
    // "<div class='metrics-plan-title'>Execution Plan</div>" +
    "<div id='slowMetricsPlanBox' class='plan-modal-box metrics-plan-box'></div>" +
    "</div></div>" +
    "</div>";
}

function bindSlowSessionMetricActions(metrics: any) {
  var box = document.getElementById("slowMetricsBox");
  if (!box) return;
  var payload = {
    query_plan_xml: metrics && metrics.query_plan_xml !== undefined && metrics.query_plan_xml !== null ? String(metrics.query_plan_xml) : "",
    actual_plan_xml: metrics && metrics.actual_plan_xml !== undefined && metrics.actual_plan_xml !== null ? String(metrics.actual_plan_xml) : "",
    blocker_plan_xml: metrics && metrics.blocker_plan_xml !== undefined && metrics.blocker_plan_xml !== null ? String(metrics.blocker_plan_xml) : ""
  };
  var cells = box.querySelectorAll(".clickable-cell");
  var rows = box.querySelectorAll(".metric-row-clickable");
  var detail = box.querySelector("#slowMetricsDetail") as HTMLElement | null;
  var planSection = box.querySelector("#slowMetricsPlanSection") as HTMLElement | null;
  var planBox = box.querySelector("#slowMetricsPlanBox") as HTMLElement | null;

  function setPlanField(field: string, xmlText: string) {
    if (!detail || !planSection || !planBox) return;
    detail.classList.add("show");
    planSection.classList.add("show");
    renderExecutionPlanToBox(planBox, xmlText, field);
  }
  for (var i = 0; i < rows.length; i++) {
    (function (row: Element) {
      row.addEventListener("click", function () {
        var field = (row as HTMLElement).getAttribute("data-plan-field") || "";
        if (field === "query_plan_xml" || field === "blocker_plan_xml") {
          setPlanField(field, payload[field] || "");
        }
      });
    })(rows[i]);
  }

  for (var j = 0; j < cells.length; j++) {
    (function (cell: Element) {
      cell.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var field = (cell as HTMLElement).getAttribute("data-field") || "";
        if (field === "actual_plan_xml" || field === "query_plan_xml" || field === "blocker_plan_xml") {
          setPlanField(field, payload[field] || "");
        }
      });
    })(cells[j]);
  }

  setPlanField("query_plan_xml", payload.query_plan_xml);
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

function renderExecutionPlanToBox(planBox: HTMLElement, xmlText: string, _sourceField?: string) {
  var normalized = String(xmlText || "");
  var isRuntimePlan = isRuntimeExecutionPlanXml(normalized);
  if (isRuntimePlan) {
    planBox.classList.add("plan-source-actual");
  } else {
    planBox.classList.remove("plan-source-actual");
  }
  if (!normalized.trim()) {
    planBox.innerText = "Khong co execution plan.";
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
        requestAnimationFrame(function () {
          redrawExecutionPlanConnectors(planBox);
          requestAnimationFrame(function () {
            redrawExecutionPlanConnectors(planBox);
          });
        });
        bindExecutionPlanActions(planBox, normalized);
      } else {
        planBox.innerText = "Khong tai duoc QP parser.";
      }
    } catch (_e) {
      planBox.innerHTML = "<pre>" + esc(normalized) + "</pre>";
    }
  });
}

function bindExecutionPlanActions(planBox: HTMLElement, xmlText: string) {
  var qpObj = getQpGlobal();
  if (!qpObj || typeof qpObj.bindQueryActions !== "function") return;
  qpObj.bindQueryActions(planBox, {
    onOpenQueryPopup: function (ctx: any) {
      var txt = String((ctx && ctx.queryText) || "");
      openModal("Query Detail", "<pre id='queryDetailPre'>Formatting...</pre>");
      var pre = document.getElementById("queryDetailPre");
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
      copyTextToClipboardWithFallback(String(xmlText || ""));
    },
    onBeautify: function (ctx: any) {
      if (qpObj && typeof qpObj.applyBeautifyToBlock === "function" && ctx && ctx.block) {
        qpObj.applyBeautifyToBlock(ctx.block);
      }
    }
  });
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

function renderFindingsHeader(useSlowSessionLayout?: boolean) {
  var row = document.getElementById("findingsHeadRow");
  if (!row) return;
  var blockingFilter = document.getElementById("blockingStatusFilter") as HTMLSelectElement | null;
  var slowLayout = useSlowSessionLayout === undefined ? isSlowSessionTopic() : useSlowSessionLayout;

  if (slowLayout) {
    row.innerHTML = "<th class='no-cell'>No</th><th>ID</th><th>Time</th><th>Role + Node</th><th>Severity</th><th>Alert Status</th><th>Elapsed(s)</th><th>CPU(s)</th><th>Login</th><th>Host</th><th>Session Id</th><th>Blocking</th><th>AI Analyses</th><th>Action</th>";
  } else {
    row.innerHTML = "<th class='no-cell'>No</th><th>Time</th><th>Issue</th><th>Status</th><th>Node</th><th>Severity</th><th></th>";
  }

  if (blockingFilter) {
    if (isSlowSessionTopic()) {
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

async function loadFindings() {
  var body = document.getElementById("findingsBody");
  var err = document.getElementById("findingsError");
  if (!body || !err) return;
  err.textContent = "";

  await withGlobalLoading(async function () {
    try {
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
        return;
      }

      var data = await apiGet("/api/findings", buildFindingsQueryParams(
        findingId,
        severity,
        alertStatus,
        blockingStatus,
        detectedFrom,
        detectedTo
      ));

      body.innerHTML = "";
      var c = 0, w = 0, i = 0;
      var useSlowSessionLayout = isSlowSessionTopic();
      if (findingId && data.length === 1) useSlowSessionLayout = isSlowSessionFinding(data[0]);
      renderFindingsHeader(useSlowSessionLayout);

      data.forEach(function (x: any, idx: number) {
        if (x.severity === "CRITICAL") c++; else if (x.severity === "WARNING") w++; else i++;
        var tr = document.createElement("tr");
        tr.className = "clickable-finding-row";
        var noCell = "<td class='no-cell'>" + String(page * limit + idx + 1) + "</td>";
        if (useSlowSessionLayout) {
          var metrics = x.metrics || {};
          var aiDone = !!x.ai_analyzed;
          var aiIcon = aiDone
            ? "<span class='badge badge-success' title='Da phan tich'>Done</span>"
            : "<span class='badge badge-warning' title='Chua phan tich'>Pending</span>";
          var aiBtnAttrs = aiDone ? "" : " disabled title='Pending'";
          tr.innerHTML =
            noCell +
            "<td><span class='finding-id-copy' title='Click to copy ID'>" + esc(x.finding_id || "") + "</span></td>" +
            "<td>" + esc(formatDetectedAtForUi(x.detected_at)) + "</td>" +
            "<td>" + roleNodeCell(x.role, x.node) + "</td>" +
            "<td>" + severityBadge(x.severity || "INFO") + "</td>" +
            "<td>" + alertStatusBadge(x.alert_status || "") + "</td>" +
            "<td>" + esc(metrics.elapsed_seconds === undefined || metrics.elapsed_seconds === null ? "" : String(metrics.elapsed_seconds)) + "</td>" +
            "<td>" + esc(metrics.cpu_time_seconds === undefined || metrics.cpu_time_seconds === null ? "" : String(metrics.cpu_time_seconds)) + "</td>" +
            "<td>" + esc(metrics.login_name || "") + "</td>" +
            "<td>" + esc(metrics.host_name || "") + "</td>" +
            "<td>" + sessionIdBadge(metrics) + "</td>" +
            "<td>" + blockingBadge(metrics) + "</td>" +
            "<td>" + aiIcon + "</td>" +
            "<td class='row-action-cell'><button type='button' class='btn-ai'" + aiBtnAttrs + ">AI Analysis</button></td>";
        } else {
          tr.innerHTML = noCell +
            "<td>" + esc(formatDetectedAtForUi(x.detected_at)) + "</td>" +
            "<td>" + esc(x.issue_type || "") + "</td>" +
            "<td>" + alertStatusBadge(x.alert_status || "") + "</td>" +
            "<td>" + esc(x.node || "") + "</td>" +
            "<td>" + severityBadge(x.severity || "INFO") + "</td>" +
            "<td>" + (x.has_diagnostics ? "<span class='diag-badge-indicator' title='Diagnostics captured'>D</span>" : "") + "</td>";
        }
        if (useSlowSessionLayout) {
          var aiBtn = tr.querySelector(".btn-ai") as HTMLButtonElement;
          var rowActionCell = tr.querySelector(".row-action-cell") as HTMLElement;
          var idCopyEl = tr.querySelector(".finding-id-copy") as HTMLElement | null;
          var blockingKillEl = tr.querySelector(".blocking-kill-btn") as HTMLElement | null;
          var sessionKillEl = tr.querySelector(".session-kill-btn") as HTMLElement | null;

          if (idCopyEl) {
            idCopyEl.addEventListener("click", function (ev) {
              ev.stopPropagation();
              copyTextToClipboardWithFallback(String(x.finding_id || ""));
            });
          }

          if (blockingKillEl) {
            blockingKillEl.addEventListener("click", async function (ev) {
              ev.stopPropagation();
              var sessionId = Number(metrics && metrics.blocking_session_id);
              if (!isFinite(sessionId) || sessionId <= 0) return;
            await requestKillSession(sessionId, "blocking_session_id", metrics, String(x.node || ""));
            });
          }

          if (sessionKillEl) {
            sessionKillEl.addEventListener("click", async function (ev) {
              ev.stopPropagation();
              var sessionId = Number(metrics && metrics.session_id);
              if (!isFinite(sessionId) || sessionId <= 0) return;
            await requestKillSession(sessionId, "session_id", metrics, String(x.node || ""));
            });
          }

          tr.addEventListener("click", async function () {
            await withGlobalLoading(async function () {
              var d = await apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
              var metrics = (d && d.metrics) || {};
              var hasDiag = !!(d && d.has_diagnostics);
              openModal("Finding Metrics", renderTabbedMetricsModal(metrics, hasDiag));
              bindSlowSessionMetricActions(metrics);
              if (hasDiag) bindFindingModalTabs(x.finding_id);
            });
          });

          if (rowActionCell) {
            rowActionCell.addEventListener("click", function (ev) {
              ev.stopPropagation();
            });
          }
          aiBtn.addEventListener("click", async function () {
            if (aiBtn.disabled) return;
            await withButtonLoading(aiBtn, async function () {
              var ai = x.ai_analysis;
              if (!ai) {
                await withGlobalLoading(async function () {
                  var d = await apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
                  ai = d && d.ai_analysis ? d.ai_analysis : null;
                });
              }
              openModal("AI Analysis", renderAiAnalysisTable(ai));
              bindAiAnalysisFieldButtons();
            }, "Loading...");
          });
        } else {
          tr.addEventListener("click", async function () {
            await withGlobalLoading(async function () {
              var d = await apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
              openModal("Finding Detail", renderTabbedFindingModal(d));
              bindJsonTreeToolbar();
              if (d && d.has_diagnostics) bindFindingModalTabs(x.finding_id);
            });
          });
        }
        body.appendChild(tr);
      });

      (document.getElementById("criticalCount") as HTMLElement).textContent = String(c);
      (document.getElementById("warningCount") as HTMLElement).textContent = String(w);
      (document.getElementById("infoCount") as HTMLElement).textContent = String(i);
      (document.getElementById("pageInfo") as HTMLElement).textContent = "Page " + String(page + 1);
    } catch (_e) {
      err.textContent = "Khong tai duoc findings.";
    }
  });
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
      (document.getElementById("detectedFromFilter") as HTMLInputElement).value = "";
      (document.getElementById("detectedToFilter") as HTMLInputElement).value = "";
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
}

bindModalEvents();
bindEvents();
initDefaultDetectedAtRange();
loadTopics().then(function () {
  renderFindingsHeader();
  return loadFindings();
});

