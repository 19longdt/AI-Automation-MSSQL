export type TopicLayoutKey = "slow_sessions" | "default";

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

  return {
    slow_sessions: {
      key: "slow_sessions",
      headerHtml: "<th class='no-cell'>No</th><th>ID</th><th>Time</th><th>Role + Node</th><th>Severity</th><th>Alert Status</th><th>Elapsed(s)</th><th>CPU(s)</th><th>Login</th><th>Host</th><th>Session Id</th><th>Blocking</th><th>AI Analyses</th><th>Action</th>",
      showBlockingFilter: true,
      renderRow: renderSlowSessionFindingRow
    },
    default: {
      key: "default",
      headerHtml: "<th class='no-cell'>No</th><th>Time</th><th>Issue</th><th>Status</th><th>Node</th><th>Severity</th><th></th>",
      showBlockingFilter: false,
      renderRow: renderDefaultFindingRow
    }
  };
}
