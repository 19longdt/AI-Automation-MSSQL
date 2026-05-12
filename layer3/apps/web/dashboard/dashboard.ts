import { apiGet } from "./api-client";
import { withButtonLoading, withGlobalLoading } from "./loading-overlay";
import { bindModalEvents, openModal } from "./modal";
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
  if (sev === "CRITICAL") return '<span class="badge-critical">CRITICAL</span>';
  if (sev === "WARNING") return '<span class="badge-warning">WARNING</span>';
  return '<span class="badge-info">INFO</span>';
}

function alertStatusBadge(v: string): string {
  var x = String(v || "").toLowerCase();
  if (x === "sent") return '<span class="badge-alert-sent">sent</span>';
  if (x === "suppressed") return '<span class="badge-alert-suppressed">suppressed</span>';
  return esc(String(v || ""));
}

function hasBlockingSession(metrics: any): boolean {
  var id = Number(metrics && metrics.blocking_session_id);
  return isFinite(id) && id > 0;
}

function blockingBadge(metrics: any): string {
  if (!hasBlockingSession(metrics)) return '<span class="blocking-badge blocking-no">No</span>';
  return '<span class="blocking-badge blocking-yes" title="blocking_session_id ' + esc(String(metrics.blocking_session_id)) + '">Yes #' + esc(String(metrics.blocking_session_id)) + '</span>';
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
  var keyHtml = key ? "<span style='color:#003b8e'>\"" + esc(key) + "\"</span>: " : "";
  if (value === null) return "<div>" + keyHtml + "<span style='color:#666'>null</span></div>";

  var t = typeof value;
  if (t === "string") return "<div>" + keyHtml + "<span style='color:#8a2b06'>\"" + esc(value) + "\"</span></div>";
  if (t === "number" || t === "boolean") return "<div>" + keyHtml + "<span style='color:#1f1f1f'>" + esc(String(value)) + "</span></div>";

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
    "elapsed_seconds",
    "cpu_time_seconds",
    "logical_reads",
    "alert_status",
    "command",
    "login_name",
    "host_name",
    "sql_text",
    "query_plan_xml"
  ];
  var blockingCols = [
    "blocking_session_id",
    "wait_type",
    "wait_seconds",
    "wait_resource",
    "blocker_login",
    "blocker_host",
    "blocker_status",
    "blocker_open_txn",
    "blocker_sql_text",
    "blocker_plan_xml"
  ];

  function renderMetricTable(title: string, cols: string[], emptyText?: string): string {
    if (!cols.length) return "";
    if (emptyText) {
      return "<div class='metric-section'>" +
        "<div class='metric-section-title'>" + esc(title) + "</div>" +
        "<div class='metric-empty'>" + esc(emptyText) + "</div>" +
        "</div>";
    }
    var row = "<td class='no-cell'>1</td>" + cols.map(function (c) { return cellFor(c); }).join("");
    var head = cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("");
    return "<div class='metric-section'>" +
      "<div class='metric-section-title'>" + esc(title) + "</div>" +
      "<table class='kv-table'><thead><tr><th class='no-cell'>No</th>" + head + "</tr></thead><tbody><tr>" + row + "</tr></tbody></table>" +
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
      var isLong = val.length > 180;
      if (!isLong) return "<td><pre class='cell-pre'>" + esc(val) + "</pre></td>";
      return "<td class='clickable-cell' data-field='" + esc(field) + "'><div class='cell-preview'>" + esc(val.substring(0, 180)) + "...</div></td>";
    }
    if (field === "query_plan_xml" || field === "blocker_plan_xml") {
      if (!val) return "<td></td>";
      return "<td class='clickable-cell' data-field='" + esc(field) + "'>Click to view</td>";
    }
    return "<td><pre class='cell-pre'>" + esc(val) + "</pre></td>";
  }

  var blockingTable = "";
  if (hasBlockingSession(m)) {
    blockingTable = renderMetricTable("Blocking information", blockingCols);
  } else {
    blockingTable = renderMetricTable("Blocking information", [], "Khong co blocking session.");
  }

  return "<div id='slowMetricsBox'>" +
    renderMetricTable("Slow session information", sessionCols) +
    blockingTable +
    "<div id='slowMetricsDetail' class='metrics-detail'>" +
    "<div class='metrics-detail-head'><div class='metrics-detail-title'>Detail</div><button id='slowMetricsBeautifyBtn' type='button' class='btn-inline'>Beautify</button></div>" +
    "<pre id='slowMetricsDetailContent' class='cell-pre'></pre></div>" +
    "</div>";
}

function bindSlowSessionMetricActions(metrics: any) {
  var box = document.getElementById("slowMetricsBox");
  if (!box) return;
  var payload = {
    sql_text: metrics && metrics.sql_text !== undefined && metrics.sql_text !== null ? String(metrics.sql_text) : "",
    query_plan_xml: metrics && metrics.query_plan_xml !== undefined && metrics.query_plan_xml !== null ? String(metrics.query_plan_xml) : "",
    blocker_sql_text: metrics && metrics.blocker_sql_text !== undefined && metrics.blocker_sql_text !== null ? String(metrics.blocker_sql_text) : "",
    blocker_plan_xml: metrics && metrics.blocker_plan_xml !== undefined && metrics.blocker_plan_xml !== null ? String(metrics.blocker_plan_xml) : ""
  };
  var cells = box.querySelectorAll(".clickable-cell");
  var detail = box.querySelector("#slowMetricsDetail") as HTMLElement | null;
  var detailContent = box.querySelector("#slowMetricsDetailContent") as HTMLElement | null;
  var beautifyBtn = box.querySelector("#slowMetricsBeautifyBtn") as HTMLButtonElement | null;
  var activeDetailField = "";

  function isSqlField(field: string): boolean {
    return field === "sql_text" || field === "blocker_sql_text";
  }

  function setDetailField(field: string, value: string, autoBeautify?: boolean) {
    if (!detail || !detailContent) return;
    activeDetailField = field;
    detail.classList.add("show");
    detailContent.textContent = String(value || "");
    if (beautifyBtn) beautifyBtn.style.display = isSqlField(field) ? "inline-block" : "none";
    if (autoBeautify && isSqlField(field) && String(value || "").trim()) {
      beautifyActiveSql();
    }
  }

  function beautifyActiveSql() {
    if (!isSqlField(activeDetailField)) activeDetailField = "sql_text";
    var raw = activeDetailField === "blocker_sql_text" ? payload.blocker_sql_text : payload.sql_text;
    if (!raw.trim()) return;
    if (detail) detail.classList.add("show");
    if (detailContent) detailContent.textContent = raw;
    var oldText = beautifyBtn ? beautifyBtn.textContent : "Beautify";
    if (beautifyBtn) {
      beautifyBtn.textContent = "Formatting...";
      beautifyBtn.disabled = true;
    }
    ensureQpParserLoaded(function (_ok) {
      var qpObj = getQpGlobal();
      function done(text: string) {
        if (detailContent) detailContent.textContent = text;
        if (beautifyBtn) {
          beautifyBtn.disabled = false;
          beautifyBtn.textContent = oldText || "Beautify";
        }
      }
      if (qpObj && typeof qpObj.beautifySqlWithFallback === "function") {
        qpObj.beautifySqlWithFallback(String(raw)).then(function (formatted: string) {
          done(formatted);
        }).catch(function () {
          done(String(raw));
        });
        return;
      }
      if (qpObj && typeof qpObj.beautifySql === "function") {
        done(qpObj.beautifySql(String(raw)));
      } else {
        done(String(raw));
      }
    });
  }

  if (beautifyBtn) {
    beautifyBtn.addEventListener("click", function () {
      beautifyActiveSql();
    });
  }
  for (var i = 0; i < cells.length; i++) {
    (function (cell: Element) {
      cell.addEventListener("click", function () {
        var field = (cell as HTMLElement).getAttribute("data-field") || "";
        var value = payload[field] || "";
        if (detail && detailContent) {
          detail.classList.add("show");
          activeDetailField = field;
          if (beautifyBtn) beautifyBtn.style.display = (field === "sql_text" || field === "blocker_sql_text") ? "inline-block" : "none";
          if (field === "query_plan_xml" || field === "blocker_plan_xml") {
            var xmlText = String(value || "");
            if (!xmlText.trim()) {
              detailContent.textContent = "";
              detailContent.innerHTML = "Khong co " + esc(field) + ".";
              return;
            }
            openModal(
              "Execution Plan",
              "<div class='plan-modal-body'>" +
              "<div id='planRenderBox' class='plan-modal-box'></div>" +
              "</div>"
            );
            var planBox = document.getElementById("planRenderBox");
            if (!planBox) return;
            ensureQpParserLoaded(function (ok) {
              if (!ok) {
                planBox.innerText = "Khong tai duoc QP parser.";
                return;
              }
              try {
                var qpObj = getQpGlobal();
                if (qpObj && typeof qpObj.showPlan === "function") {
                  qpObj.showPlan(planBox, xmlText);
                  requestAnimationFrame(function () {
                    redrawExecutionPlanConnectors(planBox);
                    requestAnimationFrame(function () {
                      redrawExecutionPlanConnectors(planBox);
                    });
                  });
                  bindExecutionPlanActions(planBox, xmlText);
                } else {
                  planBox.innerText = "Khong tai duoc QP parser.";
                }
              } catch (_e) {
                planBox.innerHTML = "<pre>" + esc(xmlText) + "</pre>";
              }
            });
            return;
          }
          setDetailField(field, String(value), isSqlField(field));
        }
      });
    })(cells[i]);
  }

  if (payload.sql_text.trim()) {
    setDetailField("sql_text", payload.sql_text, true);
  }
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
    row.innerHTML = "<th class='no-cell'>No</th><th>ID</th><th>Time</th><th>Role + Node</th><th>Severity</th><th>Alert Status</th><th>Elapsed(s)</th><th>CPU(s)</th><th>Login</th><th>Host</th><th>Blocking</th><th>AI Analyses</th><th>Action</th>";
  } else {
    row.innerHTML = "<th class='no-cell'>No</th><th>Time</th><th>Issue</th><th>Status</th><th>Node</th><th>Severity</th>";
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
          ? "<span class='ai-badge ai-done' title='Da phan tich'>Done</span>"
          : "<span class='ai-badge ai-pending' title='Chua phan tich'>Pending</span>";
        var aiBtnAttrs = aiDone ? "" : " disabled title='Pending'";
        tr.innerHTML =
          noCell +
          "<td>" + esc(x.finding_id || "") + "</td>" +
          "<td>" + esc(formatDetectedAtForUi(x.detected_at)) + "</td>" +
          "<td>" + esc((x.role || "") + " | " + (x.node || "")) + "</td>" +
          "<td>" + severityBadge(x.severity || "INFO") + "</td>" +
          "<td>" + alertStatusBadge(x.alert_status || "") + "</td>" +
          "<td>" + esc(metrics.elapsed_seconds === undefined || metrics.elapsed_seconds === null ? "" : String(metrics.elapsed_seconds)) + "</td>" +
          "<td>" + esc(metrics.cpu_time_seconds === undefined || metrics.cpu_time_seconds === null ? "" : String(metrics.cpu_time_seconds)) + "</td>" +
          "<td>" + esc(metrics.login_name || "") + "</td>" +
          "<td>" + esc(metrics.host_name || "") + "</td>" +
          "<td>" + blockingBadge(metrics) + "</td>" +
          "<td>" + aiIcon + "</td>" +
          "<td class='row-action-cell'><button type='button' class='btn-ai'" + aiBtnAttrs + ">AI Analysis</button></td>";
      } else {
        tr.innerHTML = noCell + "<td>" + esc(formatDetectedAtForUi(x.detected_at)) + "</td><td>" + esc(x.issue_type || "") + "</td><td>" + alertStatusBadge(x.alert_status || "") + "</td><td>" + esc(x.node || "") + "</td><td>" + severityBadge(x.severity || "INFO") + "</td>";
      }
      if (useSlowSessionLayout) {
        var aiBtn = tr.querySelector(".btn-ai") as HTMLButtonElement;
        var rowActionCell = tr.querySelector(".row-action-cell") as HTMLElement;

        tr.addEventListener("click", async function () {
          await withGlobalLoading(async function () {
            var d = await apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
            var metrics = (d && d.metrics) || {};
            openModal("Finding Metrics", renderSlowSessionMetricsTable(metrics));
            bindSlowSessionMetricActions(metrics);
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
            openModal("Finding Detail", renderCleanDetail(d));
            bindJsonTreeToolbar();
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
