function escapeHtml(s: any): string {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function metricValue(v: any, fallback = "-"): string {
  return v === undefined || v === null || v === "" ? fallback : escapeHtml(String(v));
}

function section(title: string, bodyHtml: string): string {
  return "<div class='metric-section'><div class='metric-section-title'>" + escapeHtml(title) + "</div>" +
    bodyHtml + "</div>";
}

function kvRow(label: string, valueHtml: string): string {
  return "<tr><td class='deadlock-label'>" + escapeHtml(label) + "</td><td>" + valueHtml + "</td></tr>";
}

function previewQuery(q: any): string {
  var text = String(q || "");
  if (!text) return "";
  return text.length > 160 ? text.slice(0, 157) + "..." : text;
}

function renderSummary(finding: any): string {
  var m = (finding && finding.metrics) || {};
  return section("Summary",
    "<table class='kv-table'><tbody>" +
    kvRow("Detected", metricValue(finding && finding.detected_at)) +
    kvRow("Deadlock time", metricValue(m.deadlock_time)) +
    kvRow("Node", metricValue(finding && finding.node)) +
    kvRow("Role", metricValue(finding && finding.role)) +
    kvRow("Severity", metricValue(finding && finding.severity)) +
    kvRow("Victim ID", metricValue(m.victim_id)) +
    "</tbody></table>"
  );
}

function renderVictimQuery(finding: any): string {
  var m = (finding && finding.metrics) || {};
  var query = String(m.victim_query || finding.query_text || "");
  if (!query) return section("Victim Query", "<div class='metric-empty'>No victim query captured.</div>");
  return section("Victim Query",
    "<div class='deadlock-query-wrap'>" +
    "<button type='button' class='btn-inline deadlock-copy-btn' data-copy-query='" + escapeHtml(query) + "'>Copy SQL</button>" +
    "<pre class='chain-q deadlock-query'>" + escapeHtml(query) + "</pre>" +
    "</div>"
  );
}

function renderAiSummary(finding: any): string {
  var ai = finding && finding.ai_analysis;
  if (!ai) return "";
  var summary = String(ai.root_cause_summary || ai.analysis_text || "");
  var actions = Array.isArray(ai.top_actions) ? ai.top_actions : [];
  var actionsHtml = actions.length
    ? "<ol class='deadlock-actions'>" + actions.map(function (x: any) {
      return "<li>" + escapeHtml(String(x || "")) + "</li>";
    }).join("") + "</ol>"
    : "<div class='metric-empty'>No recommended actions.</div>";
  return section("AI Summary",
    (summary ? "<div class='deadlock-ai-summary'>" + escapeHtml(summary) + "</div>" : "<div class='metric-empty'>No AI summary.</div>") +
    "<div class='deadlock-actions-title'>Top actions</div>" + actionsHtml
  );
}

function renderRawPayload(finding: any): string {
  var m = (finding && finding.metrics) || {};
  var payload = {
    finding_id: finding && finding.finding_id,
    topic_id: finding && finding.topic_id,
    issue_type: finding && finding.issue_type,
    detected_at: finding && finding.detected_at,
    node: finding && finding.node,
    role: finding && finding.role,
    severity: finding && finding.severity,
    metrics: m
  };
  return "<details class='deadlock-raw'><summary>Raw payload</summary><pre class='deadlock-raw-pre'>" +
    escapeHtml(JSON.stringify(payload, null, 2)) + "</pre></details>";
}

export function bindDeadlockDetailActions(copyTextToClipboardWithFallback: (text: string) => void): void {
  var btns = document.querySelectorAll(".deadlock-copy-btn");
  for (var i = 0; i < btns.length; i++) {
    (function (btn: Element) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var text = (btn as HTMLElement).getAttribute("data-copy-query") || "";
        copyTextToClipboardWithFallback(text);
      });
    })(btns[i]);
  }
}

export function renderDeadlockDetailBody(finding: any): string {
  var m = (finding && finding.metrics) || {};
  var header = "<div class='deadlock-header'>" +
    "<div class='deadlock-header-title'>DEADLOCK" +
    (m.victim_id ? " - victim " + escapeHtml(String(m.victim_id)) : "") +
    "</div>" +
    "<div class='deadlock-header-sub'>" + escapeHtml(previewQuery(m.victim_query || finding.query_text || "")) + "</div>" +
    "</div>";
  return "<div class='deadlock-detail'>" +
    header +
    renderSummary(finding) +
    renderVictimQuery(finding) +
    renderAiSummary(finding) +
    renderRawPayload(finding) +
    "</div>";
}

export function renderDeadlockModal(finding: any): string {
  if (!finding || !finding.has_diagnostics) return renderDeadlockDetailBody(finding);
  return "<div class='finding-modal-tabs'><div class='finding-tab-bar'>" +
    "<button type='button' class='finding-tab-btn active' data-tab='detail'>Detail</button>" +
    "<button type='button' class='finding-tab-btn' data-tab='diag'>Diagnostics</button></div>" +
    "<div class='finding-tab-pane' id='ftab-detail'>" + renderDeadlockDetailBody(finding) + "</div>" +
    "<div class='finding-tab-pane hidden' id='ftab-diag'><div class='diag-loading'>Loading...</div></div></div>";
}
