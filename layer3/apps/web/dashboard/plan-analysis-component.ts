import { PlanAnalysisResult, PlanFinding, StatementResult } from "@layer3/core";

export class PlanAnalysisComponent {
  private _activeStatement = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly result: PlanAnalysisResult
  ) { }

  render(): void {
    this.root.innerHTML = this._buildHtml();
    this._bindEvents();
  }

  destroy(): void {
    this.root.innerHTML = "";
  }

  private _buildHtml(): string {
    if (!this.result.statements || this.result.statements.length === 0) {
      return "<div class='pa-empty'>No statement parsed from plan XML.</div>";
    }
    const stmt = this.result.statements[this._activeStatement];
    return (
      "<div class='pa-root'>" +
      this._buildSummaryBar() +
      this._buildStatementTabs() +
      this._buildTabBar(stmt) +
      this._buildPanels(stmt) +
      "</div>"
    );
  }

  private _buildSummaryBar(): string {
    const r = this.result;
    return (
      "<div class='pa-summary'>" +
      "<span class='pa-summary-item'>⏱ " + String(r.analysis_duration_ms) + "ms</span>" +
      "<span class='pa-summary-sep'>|</span>" +
      "<span class='pa-summary-item'>" + String(r.statements.length) + " statement" + (r.statements.length > 1 ? "s" : "") + "</span>" +
      "<span class='pa-summary-sep'>|</span>" +
      (r.critical_count > 0 ? "<span class='pa-sev critical'>Critical " + String(r.critical_count) + "</span>" : "") +
      (r.warning_count > 0 ? "<span class='pa-sev warning'>Warning " + String(r.warning_count) + "</span>" : "") +
      (r.has_actual_stats ? "<span class='pa-actual-badge'>Actual Plan</span>" : "<span class='pa-est-badge'>Estimated</span>") +
      "</div>"
    );
  }

  private _buildStatementTabs(): string {
    if (this.result.statements.length <= 1) return "";
    return (
      "<div class='pa-stmt-tabs'>" +
      this.result.statements.map((s, i) => {
        const active = i === this._activeStatement ? " active" : "";
        const label = this._esc((s.statement_type || "STMT") + " #" + String(i + 1));
        return "<button type='button' class='pa-stmt-tab" + active + "' data-stmt-index='" + String(i) + "'>" + label + "</button>";
      }).join("") +
      "</div>"
    );
  }

  private _buildTabBar(stmt: StatementResult): string {
    const tabs: Array<{ id: string; label: string; count?: number; hide?: boolean }> = [
      { id: "findings", label: "Findings", count: stmt.findings.length },
      { id: "operators", label: "Operators", count: stmt.top_operators.length },
      { id: "indexes", label: "Indexes", count: stmt.missing_indexes.length, hide: stmt.missing_indexes.length === 0 },
      { id: "memory", label: "Memory", hide: stmt.memory_grant === null },
      { id: "waits", label: "Waits", count: stmt.wait_stats.length, hide: stmt.wait_stats.length === 0 },
      { id: "params", label: "Parameters", count: stmt.parameters.length, hide: stmt.parameters.length === 0 }
    ];
    let first = true;
    return (
      "<div class='pa-tabs' role='tablist'>" +
      tabs.filter((t) => !t.hide).map((t) => {
        const active = first ? " active" : "";
        first = false;
        return "<button type='button' class='pa-tab" + active + "' data-tab='" + t.id + "'>" +
          t.label +
          (t.count !== undefined ? "<span class='pa-tab-badge'>" + String(t.count) + "</span>" : "") +
          "</button>";
      }).join("") +
      "</div>"
    );
  }

  private _buildPanels(stmt: StatementResult): string {
    return (
      this._panel("findings", this._buildFindings(stmt), false) +
      this._panel("operators", this._buildOperators(stmt), true) +
      this._panel("indexes", this._buildIndexes(stmt), true) +
      this._panel("memory", this._buildMemory(stmt), true) +
      this._panel("waits", this._buildWaits(stmt), true) +
      this._panel("params", this._buildParams(stmt), true)
    );
  }

  private _buildFindings(stmt: StatementResult): string {
    if (!stmt.findings.length) return "<div class='pa-empty'>No findings.</div>";
    const sorted = stmt.findings.slice().sort((a, b) => this._sevOrder(a) - this._sevOrder(b));
    return sorted.map((f) => this._findingCard(f)).join("");
  }

  private _findingCard(f: PlanFinding): string {
    const ddl = f.action && f.action.ddl ? f.action.ddl : "";
    return (
      "<div class='pa-finding-card'>" +
      "<div class='pa-finding-header'>" +
      "<span class='pa-badge " + this._esc(f.severity) + "'>" + this._esc(f.severity.toUpperCase()) + "</span>" +
      "<span class='pa-category-tag'>[" + this._esc(f.category) + "]</span>" +
      "<span>" + this._esc(f.type) + "</span>" +
      "</div>" +
      "<div class='pa-finding-body'>" +
      "<div>" + this._esc(f.description) + "</div>" +
      "<div class='pa-recommendation'>" + this._esc(f.recommendation) + "</div>" +
      (ddl ? (
        "<div class='pa-action-label'>" + this._esc(f.action ? f.action.type : "action") + "</div>" +
        "<div class='pa-ddl-wrap'><button type='button' class='pa-ddl-copy' data-copy-ddl='" + this._escAttr(ddl) + "'>Copy DDL</button>" +
        "<pre class='pa-ddl'>" + this._esc(ddl) + "</pre></div>"
      ) : "") +
      "</div>" +
      "</div>"
    );
  }

  private _buildOperators(stmt: StatementResult): string {
    if (!stmt.top_operators.length) return "<div class='pa-empty'>No operators.</div>";
    const rows = stmt.top_operators.map((o) => {
      const cls = o.cost_pct >= 30 ? "high" : (o.cost_pct >= 15 ? "mid" : "");
      return (
        "<tr>" +
        "<td class='num'>" + String(o.node_id) + "</td>" +
        "<td>" + this._esc(o.physical_op) + "</td>" +
        "<td>" + this._esc(o.logical_op || "") + "</td>" +
        "<td class='num " + cls + "'>" + this._num(o.cost_pct, 1) + "%</td>" +
        "<td class='num'>" + this._num(o.estimated_rows, 0) + "</td>" +
        "<td class='num'>" + this._nullableNum(o.actual_rows, 0) + "</td>" +
        "<td class='num'>" + this._nullableNum(o.actual_elapsed_ms, 0) + "</td>" +
        "<td class='num'>" + this._nullableNum(o.actual_logical_reads, 0) + "</td>" +
        "</tr>"
      );
    }).join("");
    return (
      "<table class='pa-table'><thead><tr>" +
      "<th>Node</th><th>Operator</th><th>Logical</th><th>Cost %</th><th>Est Rows</th><th>Act Rows</th><th>Elapsed ms</th><th>Logical Reads</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>"
    );
  }

  private _buildIndexes(stmt: StatementResult): string {
    if (!stmt.missing_indexes.length) return "<div class='pa-empty'>No missing index suggestion.</div>";
    return stmt.missing_indexes.map((x) => {
      const ddl = x.create_statement || "";
      return (
        "<div class='pa-index-card'>" +
        "<div class='pa-index-header'><strong>" + this._esc(x.table) + "</strong><span>Impact " + this._num(x.impact, 1) + "%</span></div>" +
        "<table class='pa-index-table'>" +
        "<tr><td>Key</td><td>" + this._esc(x.equality_columns.concat(x.inequality_columns).join(", ")) + "</td></tr>" +
        "<tr><td>Include</td><td>" + this._esc(x.include_columns.join(", ")) + "</td></tr>" +
        "</table>" +
        (ddl ? "<div class='pa-ddl-wrap'><button type='button' class='pa-ddl-copy' data-copy-ddl='" + this._escAttr(ddl) + "'>Copy DDL</button><pre class='pa-ddl'>" + this._esc(ddl) + "</pre></div>" : "") +
        "</div>"
      );
    }).join("");
  }

  private _buildMemory(stmt: StatementResult): string {
    if (!stmt.memory_grant) return "<div class='pa-empty'>No memory grant info.</div>";
    const mg = stmt.memory_grant;
    const used = mg.max_used_kb || 0;
    const granted = mg.granted_kb || 0;
    const ratio = granted > 0 ? Math.min(100, Math.round((used * 100) / granted)) : 0;
    const level = ratio >= 90 ? "danger" : (ratio >= 70 ? "warning" : "ok");
    return (
      "<div class='pa-memory-grid'>" +
      "<div class='pa-memory-label'>Requested</div><div>" + this._kbToMb(mg.requested_kb) + " MB</div>" +
      "<div class='pa-memory-label'>Granted</div><div>" + this._kbToMb(mg.granted_kb) + " MB</div>" +
      "<div class='pa-memory-label'>Max Used</div><div><div class='pa-bar-wrap'><div class='pa-bar " + level + "' style='width:" + String(ratio) + "%'></div></div> " + this._kbToMb(used) + " MB (" + String(ratio) + "%)</div>" +
      "<div class='pa-memory-label'>Grant Wait</div><div>" + String(mg.grant_wait_ms || 0) + " ms</div>" +
      "</div>"
    );
  }

  private _buildWaits(stmt: StatementResult): string {
    if (!stmt.wait_stats.length) return "<div class='pa-empty'>No wait stats.</div>";
    const rows = stmt.wait_stats.map((w) => "<tr><td>" + this._esc(w.type) + "</td><td class='num'>" + String(w.ms) + "</td><td class='num'>" + String(w.count) + "</td><td>" + this._esc(w.category) + "</td></tr>").join("");
    return "<table class='pa-table'><thead><tr><th>Wait Type</th><th>Ms</th><th>Count</th><th>Category</th></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  private _buildParams(stmt: StatementResult): string {
    if (!stmt.parameters.length) return "<div class='pa-empty'>No parameters.</div>";
    const rows = stmt.parameters.map((p) => {
      const sniffed = p.compiled_value && p.runtime_value && p.compiled_value !== p.runtime_value ? "⚠" : "";
      return "<tr><td>" + this._esc(p.name) + "</td><td>" + this._esc(p.data_type || "") + "</td><td>" + this._esc(p.compiled_value || "") + "</td><td>" + this._esc(p.runtime_value || "") + "</td><td>" + sniffed + "</td></tr>";
    }).join("");
    return "<table class='pa-table'><thead><tr><th>Name</th><th>Type</th><th>Compiled</th><th>Runtime</th><th>Sniffed</th></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  private _panel(id: string, inner: string, hidden: boolean): string {
    return "<div id='pa-panel-" + id + "' class='pa-panel" + (hidden ? " hidden" : "") + "'>" + inner + "</div>";
  }

  private _bindEvents(): void {
    const self = this;
    const stmtTabs = this.root.querySelectorAll(".pa-stmt-tab");
    for (let i = 0; i < stmtTabs.length; i++) {
      stmtTabs[i].addEventListener("click", function () {
        const idx = Number((this as HTMLElement).getAttribute("data-stmt-index") || "0");
        self._activeStatement = idx;
        self.render();
      });
    }

    const tabs = this.root.querySelectorAll(".pa-tab");
    const panels = this.root.querySelectorAll(".pa-panel");
    for (let i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        for (let j = 0; j < tabs.length; j++) tabs[j].classList.remove("active");
        for (let j = 0; j < panels.length; j++) panels[j].classList.add("hidden");
        (this as HTMLElement).classList.add("active");
        const id = (this as HTMLElement).getAttribute("data-tab");
        const panel = self.root.querySelector("#pa-panel-" + id);
        if (panel) panel.classList.remove("hidden");
      });
    }

    const copyBtns = this.root.querySelectorAll("[data-copy-ddl]");
    for (let i = 0; i < copyBtns.length; i++) {
      copyBtns[i].addEventListener("click", function () {
        const btn = this as HTMLElement;
        const txt = btn.getAttribute("data-copy-ddl") || "";
        navigator.clipboard.writeText(txt);
        const orig = btn.textContent || "Copy DDL";
        btn.textContent = "Copied!";
        setTimeout(function () { btn.textContent = orig; }, 1500);
      });
    }
  }

  private _sevOrder(f: PlanFinding): number {
    if (f.severity === "critical") return 0;
    if (f.severity === "warning") return 1;
    return 2;
  }

  private _kbToMb(v: number): string { return this._num(v / 1024, 1); }
  private _num(v: number, d: number): string { return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }); }
  private _nullableNum(v: number | null, d: number): string { return v === null || v === undefined ? "—" : this._num(v, d); }
  private _esc(s: string): string {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }
  private _escAttr(s: string): string { return this._esc(s).replace(/\n/g, "&#10;"); }
}

