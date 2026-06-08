function escapeHtml(s: any): string {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function has(m: any, k: string): boolean {
  return !!(m && m[k] !== undefined && m[k] !== null && m[k] !== "");
}

function sevClass(higherIsWorse: boolean, val: number, warn?: number, crit?: number): "ok" | "warning" | "critical" {
  if (warn === undefined || !isFinite(val)) return "ok";
  if (!higherIsWorse) return "ok";
  if (crit !== undefined && val >= crit) return "critical";
  if (val >= warn) return "warning";
  return "ok";
}

function fieldRow(label: string, glossaryKey: string, valueHtml: string, flagHtml = ""): string {
  return "<tr><td class='ag-label' data-glossary='" + escapeHtml(glossaryKey) + "'>" + escapeHtml(label) + "</td>" +
    "<td>" + valueHtml + flagHtml + "</td></tr>";
}

function flag(text: string, cls: string): string {
  return " <span class='ag-flag " + escapeHtml(cls) + "'>" + escapeHtml(text) + "</span>";
}

function pill(text: string, cls: string): string {
  return "<span class='ag-pill " + escapeHtml(cls) + "'>" + escapeHtml(text) + "</span>";
}

function kpi(label: string, key: string, valueHtml: string, cls: string, flagHtml = ""): string {
  return "<div class='ag-kpi'>" +
    "<div class='ag-kpi-label' data-glossary='" + escapeHtml(key) + "'>" + escapeHtml(label) + "</div>" +
    "<div class='ag-kpi-val " + escapeHtml(cls) + "'>" + valueHtml + flagHtml + "</div></div>";
}

function fmtKb(v: any): string {
  if (v === undefined || v === null || v === "") return "-";
  var n = Number(v);
  return isFinite(n) ? n.toLocaleString() + " KB" : escapeHtml(String(v));
}

function fmtSec(v: any): string {
  if (v === undefined || v === null || v === "") return "-";
  var n = Number(v);
  return isFinite(n) ? n.toLocaleString() + " s" : escapeHtml(String(v));
}

function healthClass(m: any): "ok" | "warning" | "critical" {
  if (Number(m && m.is_suspended) === 1) return "critical";
  var h = String((m && m.synchronization_health_desc) || "").toUpperCase();
  if (h === "NOT_HEALTHY") return "critical";
  if (h === "PARTIALLY_HEALTHY") return "warning";
  return "ok";
}

function section(title: string, rowsHtml: string): string {
  return "<div class='metric-section'><div class='metric-section-title'>" + escapeHtml(title) + "</div>" +
    "<table class='kv-table'><tbody>" + rowsHtml + "</tbody></table></div>";
}

function syncSection(m: any): string {
  return section("Sync status",
    fieldRow("Replica", "synchronization_state_desc", escapeHtml(m.replica_server_name || "-")) +
    fieldRow("Database", "synchronization_state_desc", escapeHtml(m.database_name || "-")) +
    fieldRow("Role", "synchronization_state_desc", escapeHtml(m.role_desc || "-")) +
    fieldRow("Sync state", "synchronization_state_desc", escapeHtml(m.synchronization_state_desc || "-")) +
    fieldRow("Sync health", "synchronization_health_desc", escapeHtml(m.synchronization_health_desc || "-")) +
    fieldRow("Connected", "connected_state_desc", escapeHtml(m.connected_state_desc || "-")) +
    fieldRow("Operational", "operational_state_desc", escapeHtml(m.operational_state_desc || "-"))
  );
}

function lagSection(m: any): string {
  var logSendWarn = Number(m && m.threshold_warning);
  var logSendCrit = Number(m && m.threshold_critical);
  var logSendFlag = has(m, "log_send_queue_size") && isFinite(logSendWarn) && Number(m.log_send_queue_size) >= logSendWarn
    ? flag("vuot nguong", sevClass(true, Number(m.log_send_queue_size), logSendWarn, logSendCrit))
    : "";
  var redoFlag = has(m, "secondary_lag_seconds") && Number(m.secondary_lag_seconds) >= 30
    ? flag("vuot nguong", sevClass(true, Number(m.secondary_lag_seconds), 30, 120))
    : "";
  return section("Lag & throughput",
    fieldRow("Log send queue", "log_send_queue_size", fmtKb(m.log_send_queue_size), logSendFlag) +
    fieldRow("Log send rate", "log_send_rate", fmtKb(m.log_send_rate)) +
    fieldRow("Redo queue", "redo_queue_size", fmtKb(m.redo_queue_size)) +
    fieldRow("Redo rate", "redo_rate", fmtKb(m.redo_rate)) +
    fieldRow("Secondary lag", "secondary_lag_seconds", fmtSec(m.secondary_lag_seconds), redoFlag) +
    fieldRow("Last commit", "secondary_lag_seconds", escapeHtml(m.last_commit_time || "-")) +
    fieldRow("Last redone", "secondary_lag_seconds", escapeHtml(m.last_redone_time || "-"))
  );
}

function suspendSection(m: any): string {
  return section("Suspend & failover",
    fieldRow("Suspended", "is_suspended", Number(m.is_suspended) === 1 ? "Yes" : "No",
      Number(m.is_suspended) === 1 ? flag("critical", "critical") : "") +
    fieldRow("Suspend reason", "suspend_reason_desc", escapeHtml(m.suspend_reason_desc || "-")) +
    fieldRow("Failover ready", "is_failover_ready",
      has(m, "is_failover_ready") ? (Number(m.is_failover_ready) === 1 ? "Yes" : "No") : "-",
      has(m, "is_failover_ready") && Number(m.is_failover_ready) !== 1 ? flag("not ready", "warning") : "")
  );
}

function cdcSection(m: any): string {
  return section("CDC job",
    fieldRow("Job", "run_status", escapeHtml(m.job_name || "-")) +
    fieldRow("Run status", "run_status", Number(m.run_status) === 1 ? "Succeeded" : "Failed",
      Number(m.run_status) === 1 ? "" : flag("critical", "critical")) +
    fieldRow("Run duration", "run_status", escapeHtml(String(m.run_duration || "-"))) +
    fieldRow("Message", "run_status", escapeHtml(m.message || "-"))
  );
}

function renderAgHealthDetailBody(finding: any): string {
  var m = (finding && finding.metrics) || {};
  var isCdc = String((finding && finding.issue_type) || "") === "cdc_failure" || has(m, "job_name");
  var header = "<div class='ag-header'>" +
    "<div class='ag-header-title'>AG HEALTH - " + escapeHtml(m.replica_server_name || finding.node || "") +
    (m.role_desc ? " · " + escapeHtml(m.role_desc) : "") + "</div>" +
    "<div class='ag-pills'>" +
    (has(m, "synchronization_health_desc") ? pill(m.synchronization_health_desc, healthClass(m)) : "") +
    (has(m, "synchronization_state_desc") ? pill(m.synchronization_state_desc, "ok") : "") +
    (has(m, "connected_state_desc") ? pill(m.connected_state_desc,
      String(m.connected_state_desc).toUpperCase() === "CONNECTED" ? "ok" : "critical") : "") +
    "</div></div>";

  var kpis = isCdc
    ? "<div class='ag-kpis'>" +
      kpi("CDC JOB", "run_status", escapeHtml(m.job_name || "-"), "ok") +
      kpi("RUN STATUS", "run_status", Number(m.run_status) === 1 ? "Succeeded" : "Failed", Number(m.run_status) === 1 ? "ok" : "critical") +
      kpi("DURATION", "run_status", escapeHtml(String(m.run_duration || "-")), "ok") +
      kpi("NODE", "run_status", escapeHtml(finding.node || "-"), "ok") +
      "</div>"
    : "<div class='ag-kpis'>" +
      kpi("SYNC HEALTH", "synchronization_health_desc", escapeHtml(m.synchronization_health_desc || "-"), healthClass(m)) +
      kpi("LOG SEND Q", "log_send_queue_size", fmtKb(m.log_send_queue_size),
        sevClass(true, Number(m.log_send_queue_size), Number(m.threshold_warning), Number(m.threshold_critical))) +
      kpi("REDO Q", "redo_queue_size", fmtKb(m.redo_queue_size),
        sevClass(true, Number(m.redo_queue_size), Number(m.threshold_warning), Number(m.threshold_critical))) +
      kpi("LAG", "secondary_lag_seconds", has(m, "secondary_lag_seconds") ? fmtSec(m.secondary_lag_seconds) : "-",
        sevClass(true, Number(m.secondary_lag_seconds), 30, 120)) +
      "</div>";

  var body = isCdc ? cdcSection(m) : (syncSection(m) + lagSection(m) + suspendSection(m));
  return "<div class='ag-detail'>" + header + kpis + body + "</div>";
}

export function renderAgHealthModal(finding: any): string {
  if (!finding || !finding.has_diagnostics) return renderAgHealthDetailBody(finding);
  return "<div class='finding-modal-tabs'><div class='finding-tab-bar'>" +
    "<button type='button' class='finding-tab-btn active' data-tab='detail'>Detail</button>" +
    "<button type='button' class='finding-tab-btn' data-tab='diag'>Diagnostics</button></div>" +
    "<div class='finding-tab-pane' id='ftab-detail'>" + renderAgHealthDetailBody(finding) + "</div>" +
    "<div class='finding-tab-pane hidden' id='ftab-diag'><div class='diag-loading'>Loading...</div></div></div>";
}
