export type TopicLayoutKey = "slow_sessions" | "blocking" | "ag_health" | "default";

export interface TopicLayoutHandler {
  key: TopicLayoutKey;
  headerHtml: string;
  showBlockingFilter: boolean;
  renderRow: (tr: HTMLTableRowElement, x: any, idx: number) => void;
}

interface TopicLayoutDeps {
  getPage: () => number;
  getLimit: () => number;
  esc: (s: string) => string;
  formatDetectedAtForUi: (v: any) => string;
  roleNodeCell: (role: any, node: any) => string;
  severityBadge: (sev: string) => string;
  alertStatusBadge: (v: string) => string;
  sessionIdBadge: (metrics: any) => string;
  blockingBadge: (metrics: any) => string;
  copyTextToClipboardWithFallback: (text: string) => void;
  requestKillSession: (sessionId: number, sourceLabel: string, metrics: any, node: string) => Promise<void>;
  withGlobalLoading: (fn: () => Promise<void>) => Promise<void>;
  withButtonLoading: (btn: HTMLButtonElement, fn: () => Promise<void>, text: string) => Promise<void>;
  apiGet: (path: string, params?: Record<string, string | number | undefined>) => Promise<any>;
  openModal: (title: string, contentHtml: string) => void;
  renderTabbedMetricsModal: (metrics: any, hasDiag: boolean) => string;
  bindSlowSessionMetricActions: (metrics: any) => void;
  bindFindingModalTabs: (findingId: string) => void;
  renderAiAnalysisTable: (obj: any) => string;
  bindAiAnalysisFieldButtons: () => void;
  renderTabbedFindingModal: (finding: any) => string;
  bindJsonTreeToolbar: () => void;
  // Topic `blocking` (head-blocker-centric)
  headBlockerCell: (metrics: any) => string;
  blockingStateBadge: (metrics: any) => string;
  renderBlockingChainModal: (finding: any) => string;
  renderAgHealthModal: (finding: any) => string;
  attachGlossaryTooltips: (root: HTMLElement) => void;
}

export function createTopicLayoutHandlers(deps: TopicLayoutDeps): Record<TopicLayoutKey, TopicLayoutHandler> {
  function renderSlowSessionFindingRow(tr: HTMLTableRowElement, x: any, idx: number) {
    var metrics = x.metrics || {};
    var aiDone = !!x.ai_analyzed;
    var aiIcon = aiDone
      ? "<span class='badge badge-success' title='Da phan tich'>Done</span>"
      : "<span class='badge badge-warning' title='Chua phan tich'>Pending</span>";
    var aiBtnAttrs = aiDone ? "" : " disabled title='Pending'";
    var noCell = "<td class='no-cell'>" + String(deps.getPage() * deps.getLimit() + idx + 1) + "</td>";
    tr.innerHTML =
      noCell +
      "<td><span class='finding-id-copy' title='Click to copy ID'>" + deps.esc(x.finding_id || "") + "</span></td>" +
      "<td>" + deps.esc(deps.formatDetectedAtForUi(x.detected_at)) + "</td>" +
      "<td>" + deps.roleNodeCell(x.role, x.node) + "</td>" +
      "<td>" + deps.severityBadge(x.severity || "INFO") + "</td>" +
      "<td>" + deps.alertStatusBadge(x.alert_status || "") + "</td>" +
      "<td>" + deps.esc(metrics.elapsed_seconds === undefined || metrics.elapsed_seconds === null ? "" : String(metrics.elapsed_seconds)) + "</td>" +
      "<td>" + deps.esc(metrics.cpu_time_seconds === undefined || metrics.cpu_time_seconds === null ? "" : String(metrics.cpu_time_seconds)) + "</td>" +
      "<td>" + deps.esc(metrics.login_name || "") + "</td>" +
      "<td>" + deps.esc(metrics.host_name || "") + "</td>" +
      "<td>" + deps.sessionIdBadge(metrics) + "</td>" +
      "<td>" + deps.blockingBadge(metrics) + "</td>" +
      "<td>" + aiIcon + "</td>" +
      "<td class='row-action-cell'><button type='button' class='btn-ai'" + aiBtnAttrs + ">AI Analysis</button></td>";

    var aiBtn = tr.querySelector(".btn-ai") as HTMLButtonElement;
    var rowActionCell = tr.querySelector(".row-action-cell") as HTMLElement;
    var idCopyEl = tr.querySelector(".finding-id-copy") as HTMLElement | null;
    var blockingKillEl = tr.querySelector(".blocking-kill-btn") as HTMLElement | null;
    var sessionKillEl = tr.querySelector(".session-kill-btn") as HTMLElement | null;

    if (idCopyEl) {
      idCopyEl.addEventListener("click", function (ev) {
        ev.stopPropagation();
        deps.copyTextToClipboardWithFallback(String(x.finding_id || ""));
      });
    }

    if (blockingKillEl) {
      blockingKillEl.addEventListener("click", async function (ev) {
        ev.stopPropagation();
        var sessionId = Number(metrics && metrics.blocking_session_id);
        if (!isFinite(sessionId) || sessionId <= 0) return;
        await deps.requestKillSession(sessionId, "blocking_session_id", metrics, String(x.node || ""));
      });
    }

    if (sessionKillEl) {
      sessionKillEl.addEventListener("click", async function (ev) {
        ev.stopPropagation();
        var sessionId = Number(metrics && metrics.session_id);
        if (!isFinite(sessionId) || sessionId <= 0) return;
        await deps.requestKillSession(sessionId, "session_id", metrics, String(x.node || ""));
      });
    }

    tr.addEventListener("click", async function () {
      await deps.withGlobalLoading(async function () {
        var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
        var detailMetrics = (d && d.metrics) || {};
        var hasDiag = !!(d && d.has_diagnostics);
        deps.openModal("Finding Metrics", deps.renderTabbedMetricsModal(detailMetrics, hasDiag));
        deps.bindSlowSessionMetricActions(detailMetrics);
        if (hasDiag) deps.bindFindingModalTabs(x.finding_id);
      });
    });

    if (rowActionCell) {
      rowActionCell.addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
    }
    aiBtn.addEventListener("click", async function () {
      if (aiBtn.disabled) return;
      await deps.withButtonLoading(aiBtn, async function () {
        var ai = x.ai_analysis;
        if (!ai) {
          await deps.withGlobalLoading(async function () {
            var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
            ai = d && d.ai_analysis ? d.ai_analysis : null;
          });
        }
        deps.openModal("AI Analysis", deps.renderAiAnalysisTable(ai));
        deps.bindAiAnalysisFieldButtons();
      }, "Loading...");
    });
  }

  function renderBlockingFindingRow(tr: HTMLTableRowElement, x: any, idx: number) {
    var metrics = x.metrics || {};
    var aiDone = !!x.ai_analyzed;
    var aiIcon = aiDone
      ? "<span class='badge badge-success' title='Da phan tich'>Done</span>"
      : "<span class='badge badge-warning' title='Chua phan tich'>Pending</span>";
    var aiBtnAttrs = aiDone ? "" : " disabled title='Pending'";
    var headSid = Number(metrics.head_blocker_session_id);
    var killAttrs = (isFinite(headSid) && headSid > 0) ? "" : " disabled title='No head blocker session'";
    var noCell = "<td class='no-cell'>" + String(deps.getPage() * deps.getLimit() + idx + 1) + "</td>";
    tr.innerHTML =
      noCell +
      "<td><span class='finding-id-copy' title='Click to copy ID'>" + deps.esc(x.finding_id || "") + "</span></td>" +
      "<td>" + deps.esc(deps.formatDetectedAtForUi(x.detected_at)) + "</td>" +
      "<td>" + deps.roleNodeCell(x.role, x.node) + "</td>" +
      "<td>" + deps.severityBadge(x.severity || "INFO") + "</td>" +
      "<td>" + deps.headBlockerCell(metrics) + "</td>" +
      "<td>" + deps.blockingStateBadge(metrics) + "</td>" +
      "<td>" + deps.esc(metrics.chain_depth === undefined || metrics.chain_depth === null ? "" : String(metrics.chain_depth)) + "</td>" +
      "<td>" + deps.esc(metrics.blocked_session_count === undefined || metrics.blocked_session_count === null ? "" : String(metrics.blocked_session_count)) + "</td>" +
      "<td>" + deps.esc(metrics.max_wait_sec === undefined || metrics.max_wait_sec === null ? "" : String(metrics.max_wait_sec)) + "</td>" +
      "<td>" + deps.esc(metrics.wait_type || "") + "</td>" +
      "<td>" + aiIcon + "</td>" +
      "<td class='row-action-cell'>" +
        "<button type='button' class='btn-kill-head'" + killAttrs + ">Kill</button> " +
        "<button type='button' class='btn-ai'" + aiBtnAttrs + ">AI Analysis</button>" +
      "</td>";

    var aiBtn = tr.querySelector(".btn-ai") as HTMLButtonElement;
    var rowActionCell = tr.querySelector(".row-action-cell") as HTMLElement;
    var idCopyEl = tr.querySelector(".finding-id-copy") as HTMLElement | null;
    var killBtn = tr.querySelector(".btn-kill-head") as HTMLButtonElement | null;

    if (idCopyEl) {
      idCopyEl.addEventListener("click", function (ev) {
        ev.stopPropagation();
        deps.copyTextToClipboardWithFallback(String(x.finding_id || ""));
      });
    }

    // Kill HEAD BLOCKER (session gây ra blocking) — khác slow_sessions (kill victim)
    if (killBtn) {
      killBtn.addEventListener("click", async function (ev) {
        ev.stopPropagation();
        if (killBtn.disabled) return;
        var sessionId = Number(metrics.head_blocker_session_id);
        if (!isFinite(sessionId) || sessionId <= 0) return;
        await deps.requestKillSession(sessionId, "head_blocker_session_id", metrics, String(x.node || ""));
      });
    }

    // Row click → chain tree + held locks modal (+ Diagnostics tab nếu có)
    tr.addEventListener("click", async function () {
      await deps.withGlobalLoading(async function () {
        var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
        var hasDiag = !!(d && d.has_diagnostics);
        deps.openModal("Blocking Chain", deps.renderBlockingChainModal(d));
        if (hasDiag) deps.bindFindingModalTabs(x.finding_id);
      });
    });

    if (rowActionCell) {
      rowActionCell.addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
    }
    aiBtn.addEventListener("click", async function () {
      if (aiBtn.disabled) return;
      await deps.withButtonLoading(aiBtn, async function () {
        var ai = x.ai_analysis;
        if (!ai) {
          await deps.withGlobalLoading(async function () {
            var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
            ai = d && d.ai_analysis ? d.ai_analysis : null;
          });
        }
        deps.openModal("AI Analysis", deps.renderAiAnalysisTable(ai));
        deps.bindAiAnalysisFieldButtons();
      }, "Loading...");
    });
  }

  function renderDefaultFindingRow(tr: HTMLTableRowElement, x: any, idx: number) {
    var noCell = "<td class='no-cell'>" + String(deps.getPage() * deps.getLimit() + idx + 1) + "</td>";
    tr.innerHTML = noCell +
      "<td>" + deps.esc(deps.formatDetectedAtForUi(x.detected_at)) + "</td>" +
      "<td>" + deps.esc(x.issue_type || "") + "</td>" +
      "<td>" + deps.alertStatusBadge(x.alert_status || "") + "</td>" +
      "<td>" + deps.esc(x.node || "") + "</td>" +
      "<td>" + deps.severityBadge(x.severity || "INFO") + "</td>" +
      "<td>" + (x.has_diagnostics ? "<span class='diag-badge-indicator' title='Diagnostics captured'>D</span>" : "") + "</td>";

    tr.addEventListener("click", async function () {
      await deps.withGlobalLoading(async function () {
        var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
        deps.openModal("Finding Detail", deps.renderTabbedFindingModal(d));
        deps.bindJsonTreeToolbar();
        if (d && d.has_diagnostics) deps.bindFindingModalTabs(x.finding_id);
      });
    });
  }

  function renderAgHealthFindingRow(tr: HTMLTableRowElement, x: any, idx: number) {
    var metrics = x.metrics || {};
    var aiDone = !!x.ai_analyzed;
    var aiIcon = aiDone
      ? "<span class='badge badge-success' title='Da phan tich'>Done</span>"
      : "<span class='badge badge-warning' title='Chua phan tich'>Pending</span>";
    var aiBtnAttrs = aiDone ? "" : " disabled title='Pending'";
    var syncState = String(metrics.synchronization_state_desc || "");
    var health = String(metrics.synchronization_health_desc || "").toUpperCase();
    var syncBadge = metrics.job_name
      ? "<span class='badge " + (Number(metrics.run_status) === 1 ? "badge-success" : "badge-critical") + "'>" +
        deps.esc(Number(metrics.run_status) === 1 ? "CDC OK" : "CDC FAIL") + "</span>"
      : "<span class='badge " +
        ((health === "NOT_HEALTHY" || Number(metrics.is_suspended) === 1)
          ? "badge-critical"
          : (health === "PARTIALLY_HEALTHY" ? "badge-warning" : "badge-success")) +
        "'>" + deps.esc(syncState || "-") + "</span>";
    var lag = metrics.secondary_lag_seconds !== undefined && metrics.secondary_lag_seconds !== null
      ? String(metrics.secondary_lag_seconds) + " s"
      : metrics.redo_queue_size !== undefined && metrics.redo_queue_size !== null
        ? String(metrics.redo_queue_size) + " KB"
        : metrics.log_send_queue_size !== undefined && metrics.log_send_queue_size !== null
          ? String(metrics.log_send_queue_size) + " KB"
          : "";
    var noCell = "<td class='no-cell'>" + String(deps.getPage() * deps.getLimit() + idx + 1) + "</td>";
    tr.innerHTML =
      noCell +
      "<td><span class='finding-id-copy' title='Click to copy ID'>" + deps.esc(x.finding_id || "") + "</span></td>" +
      "<td>" + deps.esc(deps.formatDetectedAtForUi(x.detected_at)) + "</td>" +
      "<td>" + deps.roleNodeCell(x.role, x.node) + "</td>" +
      "<td>" + deps.severityBadge(x.severity || "INFO") + "</td>" +
      "<td>" + syncBadge + "</td>" +
      "<td>" + deps.esc(lag) + "</td>" +
      "<td>" + aiIcon + "</td>" +
      "<td class='row-action-cell'><button type='button' class='btn-ai'" + aiBtnAttrs + ">AI Analysis</button></td>";

    var aiBtn = tr.querySelector(".btn-ai") as HTMLButtonElement;
    var rowActionCell = tr.querySelector(".row-action-cell") as HTMLElement;
    var idCopyEl = tr.querySelector(".finding-id-copy") as HTMLElement | null;

    if (idCopyEl) {
      idCopyEl.addEventListener("click", function (ev) {
        ev.stopPropagation();
        deps.copyTextToClipboardWithFallback(String(x.finding_id || ""));
      });
    }

    tr.addEventListener("click", async function () {
      await deps.withGlobalLoading(async function () {
        var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
        var hasDiag = !!(d && d.has_diagnostics);
        deps.openModal("AG Health", deps.renderAgHealthModal(d));
        var bodies = document.querySelectorAll(".modal .modal-body");
        var body = bodies[bodies.length - 1] as HTMLElement | undefined;
        if (body) deps.attachGlossaryTooltips(body);
        if (hasDiag) deps.bindFindingModalTabs(x.finding_id);
      });
    });

    if (rowActionCell) {
      rowActionCell.addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
    }
    aiBtn.addEventListener("click", async function () {
      if (aiBtn.disabled) return;
      await deps.withButtonLoading(aiBtn, async function () {
        var ai = x.ai_analysis;
        if (!ai) {
          await deps.withGlobalLoading(async function () {
            var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
            ai = d && d.ai_analysis ? d.ai_analysis : null;
          });
        }
        deps.openModal("AI Analysis", deps.renderAiAnalysisTable(ai));
        deps.bindAiAnalysisFieldButtons();
      }, "Loading...");
    });
  }

  return {
    slow_sessions: {
      key: "slow_sessions",
      headerHtml: "<th class='no-cell'>No</th><th>ID</th><th>Time</th><th>Role + Node</th><th>Severity</th><th>Alert Status</th><th>Elapsed(s)</th><th>CPU(s)</th><th>Login</th><th>Host</th><th>Session Id</th><th>Blocking</th><th>AI Analyses</th><th>Action</th>",
      showBlockingFilter: true,
      renderRow: renderSlowSessionFindingRow
    },
    blocking: {
      key: "blocking",
      headerHtml: "<th class='no-cell'>No</th><th>ID</th><th>Time</th><th>Role + Node</th><th>Severity</th><th>Head Blocker</th><th>State</th><th>Depth</th><th>Blocked</th><th>Max Wait(s)</th><th>Wait Type</th><th>AI Analyses</th><th>Action</th>",
      showBlockingFilter: false,
      renderRow: renderBlockingFindingRow
    },
    ag_health: {
      key: "ag_health",
      headerHtml: "<th class='no-cell'>No</th><th>ID</th><th>Time</th><th>Role + Node</th><th>Severity</th><th>Sync State</th><th>Lag</th><th>AI Analyses</th><th>Action</th>",
      showBlockingFilter: false,
      renderRow: renderAgHealthFindingRow
    },
    default: {
      key: "default",
      headerHtml: "<th class='no-cell'>No</th><th>Time</th><th>Issue</th><th>Status</th><th>Node</th><th>Severity</th><th></th>",
      showBlockingFilter: false,
      renderRow: renderDefaultFindingRow
    }
  };
}
