// blocking-detail.ts — Pure HTML-string renderers cho finding detail của topic `blocking`.
//
// Tách khỏi dashboard.ts để:
//   - Smoke-verify được bằng node (không cần browser/DOM — chỉ trả string)
//   - dashboard.ts chỉ inject vào layout registry, không phình thêm render logic
//
// Data contract (finding.metrics — từ layer1 BlockingChainDetector):
//   head_blocker_session_id, head_blocker_login, head_blocker_query, ...
//   blocked_sessions[]: {session_id, blocking_session_id?, wait_sec, wait_type,
//                        login_name, database_name, query_text}
//   held_locks[]: {resource_type, request_mode, object_name, lock_count}

function escapeHtml(s: any): string {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function victimLabelHtml(v: any): string {
  var parts: string[] = ["#" + escapeHtml(v.session_id)];
  if (v.login_name) parts.push(escapeHtml(v.login_name));
  if (v.database_name) parts.push("db=" + escapeHtml(v.database_name));
  if (v.wait_sec !== undefined && v.wait_sec !== null) parts.push("wait " + escapeHtml(v.wait_sec) + "s");
  if (v.wait_type) parts.push(escapeHtml(v.wait_type));
  var q = v.query_text ? "<pre class='chain-q'>" + escapeHtml(v.query_text) + "</pre>" : "";
  return "<span class='chain-victim-label'>" + parts.join(" &middot; ") + "</span>" + q;
}

export function buildBlockingTreeHtml(metrics: any): string {
  var m = metrics || {};
  var head = m.head_blocker_session_id;
  if (head === undefined || head === null || head === "") {
    return "<div class='metric-empty'>No head blocker info in finding.</div>";
  }
  var victims: any[] = m.blocked_sessions || [];

  // Index children theo parent session_id. Data cũ (trước khi detector thêm
  // blocking_session_id per victim) → fallback: flat list dưới head.
  var childrenByParent: Record<string, any[]> = {};
  var haveParentInfo = false;
  victims.forEach(function (v: any) {
    var p = v && v.blocking_session_id;
    if (p !== undefined && p !== null && p !== "") haveParentInfo = true;
    var key = (p === undefined || p === null || p === "") ? String(head) : String(p);
    if (!childrenByParent[key]) childrenByParent[key] = [];
    childrenByParent[key].push(v);
  });
  if (!haveParentInfo) {
    childrenByParent = {};
    childrenByParent[String(head)] = victims.slice();
  }

  // Cycle guard — DMV snapshot có thể chứa cycle (mirror chain_analysis.py)
  var seen: Record<string, boolean> = {};
  function renderNode(sid: any, labelHtml: string): string {
    var key = String(sid);
    if (seen[key]) return "<li class='chain-node chain-cycle'>" + labelHtml + " <em>(cycle)</em></li>";
    seen[key] = true;
    var kids = childrenByParent[key] || [];
    var kidsHtml = "";
    for (var i = 0; i < kids.length; i++) {
      kidsHtml += renderNode(kids[i].session_id, victimLabelHtml(kids[i]));
    }
    return "<li class='chain-node'>" + labelHtml +
      (kidsHtml ? "<ul class='chain-children'>" + kidsHtml + "</ul>" : "") +
      "</li>";
  }

  var headParts: string[] = ["HEAD #" + escapeHtml(head)];
  if (m.head_blocker_login) headParts.push(escapeHtml(m.head_blocker_login));
  if (m.head_blocker_program) headParts.push(escapeHtml(m.head_blocker_program));
  var headLabel = "<span class='chain-head-label'>" + headParts.join(" &middot; ") + "</span>" +
    (m.head_blocker_query ? "<pre class='chain-q'>" + escapeHtml(m.head_blocker_query) + "</pre>" : "");

  return "<ul class='chain-tree'>" + renderNode(head, headLabel) + "</ul>";
}

export function renderHeldLocksTable(metrics: any): string {
  var locks: any[] = (metrics && metrics.held_locks) || [];
  if (!locks.length) return "<div class='metric-empty'>No held locks captured.</div>";
  var rows = "";
  for (var i = 0; i < locks.length; i++) {
    var l = locks[i] || {};
    rows += "<tr>" +
      "<td class='no-cell'>" + String(i + 1) + "</td>" +
      "<td>" + escapeHtml(l.resource_type) + "</td>" +
      "<td>" + escapeHtml(l.request_mode) + "</td>" +
      "<td>" + escapeHtml(l.object_name) + "</td>" +
      "<td>" + escapeHtml(l.lock_count) + "</td>" +
      "</tr>";
  }
  return "<table class='kv-table'><thead><tr>" +
    "<th class='no-cell'>No</th><th>Resource</th><th>Mode</th><th>Object</th><th>Count</th>" +
    "</tr></thead><tbody>" + rows + "</tbody></table>";
}

export function renderBlockingDetailBody(finding: any): string {
  var m = (finding && finding.metrics) || {};
  return "<div class='blocking-detail'>" +
    "<div class='metric-section-title'>Blocking chain</div>" + buildBlockingTreeHtml(m) +
    "<div class='metric-section-title'>Held locks</div>" + renderHeldLocksTable(m) +
    "</div>";
}

// Tab shell markup phải match renderTabbedFindingModal trong dashboard.ts
// (#ftab-detail / #ftab-diag) để bindFindingModalTabs() hoạt động không sửa gì.
export function renderBlockingChainModal(finding: any): string {
  if (!finding || !finding.has_diagnostics) return renderBlockingDetailBody(finding);
  return "<div class='finding-modal-tabs'>" +
    "<div class='finding-tab-bar'>" +
    "<button type='button' class='finding-tab-btn active' data-tab='detail'>Detail</button>" +
    "<button type='button' class='finding-tab-btn' data-tab='diag'>Diagnostics</button>" +
    "</div>" +
    "<div class='finding-tab-pane' id='ftab-detail'>" + renderBlockingDetailBody(finding) + "</div>" +
    "<div class='finding-tab-pane hidden' id='ftab-diag'><div class='diag-loading'>Loading...</div></div>" +
    "</div>";
}
