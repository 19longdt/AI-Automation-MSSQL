import {
    FindingGroup,
    IOStatSummary,
    JoinTypeSummary,
    OperatorSummary,
    PlanAnalysisResult,
    PlanFinding,
    StatementResult
} from "@layer3/core";
import {attachGlossaryTooltips, removeTooltip} from "./glossary-tooltip";

export class PlanAnalysisComponent {
    private _activeStatement = 0;

    constructor(private readonly root: HTMLElement, private readonly result: PlanAnalysisResult) {
    }

    render(): void {
        this.root.innerHTML = this._buildHtml();
        this._bindEvents();
        attachGlossaryTooltips(this.root);
    }

    destroy(): void {
        removeTooltip();
        this.root.innerHTML = "";
    }

    private _buildHtml(): string {
        if (!this.result.statements || this.result.statements.length === 0) return "<div class='pa-empty'>No statement parsed from plan XML.</div>";
        var s = this.result.statements[this._activeStatement];
        var hasWarnings = !!(s.finding_groups && s.finding_groups.length);
        var hasTopOps = !!(s.top_operators && s.top_operators.length);
        var hasEstActual = (s.top_operators || []).some((o) => o.has_row_est_off);
        var hasIo = !!(s.io_stats && s.io_stats.length);
        var hasMissing = !!(s.missing_indexes && s.missing_indexes.length);
        var hasStats = !!(s.statistics && s.statistics.length);
        var hasParams = !!(s.parameters && s.parameters.length);
        var hasIndexesUsed = !!(s.indexes_used && s.indexes_used.length);
        var hasJoin = !!(s.join_types && s.join_types.length);
        var hasMemory = !!s.memory_grant;
        var hasWait = !!(s.wait_stats && s.wait_stats.length);
        var hasCompilation = !!s.compilation;
        var hasLookupQueries = !!(s.compilation && s.compilation.lookup_queries);

        var orientation = this._group("orientation", "ORIENTATION", "Query text & plan warnings", [
            this._section("Query Text", "<pre class='pa-ddl'>" + this._esc(this._formatQueryText(s)) + "</pre>", false, "blue", undefined, true),
            this._section("Warnings", this._buildWarningsSection(s), false, this._dotForWarnings(s), (s.finding_groups || []).reduce((acc: number, g: FindingGroup) => acc + g.count, 0), hasWarnings),
        ], 1 + (hasWarnings ? 1 : 0), true);

        var cost = this._group("cost", "COST ANALYSIS", "Operators, row estimates & I/O", [
            this._section("Top Expensive Operations", this._buildTopExpensiveSection(s), false, this._dotForTopOps(s), (s.top_operators || []).length, hasTopOps),
            this._section("Est vs Actual Rows", this._buildEstActualSection(s), false, this._dotForEstActual(s), undefined, hasEstActual),
            this._section("I/O Statistics", this._buildIoSection(s), false, hasIo ? "yellow" : "green", (s.io_stats || []).length, hasIo),
        ], (hasTopOps ? 1 : 0) + (hasEstActual ? 1 : 0) + (hasIo ? 1 : 0));

        var actionable = this._group("actionable", "ACTIONABLE", "Missing indexes, stale stats & parameters", [
            this._section("Missing Indexes", this._buildIndexesSection(s), hasMissing, hasMissing ? "red" : "green", (s.missing_indexes || []).length, hasMissing),
            this._section("Statistics Used", this._buildStatsSection(s), false, this._dotForStats(s), (s.statistics || []).length, hasStats),
            this._section("Parameters", this._buildParametersSection(s), false, hasParams ? "blue" : "green", (s.parameters || []).length, hasParams),
        ], (hasMissing ? 1 : 0) + (hasStats ? 1 : 0) + (hasParams ? 1 : 0));

        var context = this._group("context", "CONTEXT", "Index usage, join algorithms & memory", [
            this._section("Indexes Used", this._buildIndexesUsedSection(s), false, hasIndexesUsed ? "blue" : "green", (s.indexes_used || []).length, hasIndexesUsed),
            this._section("Join Types & Operations", this._buildJoinTypesSection(s), false, this._dotForJoinTypes(s), undefined, hasJoin),
            this._section("Memory Grant", this._buildMemorySection(s), false, this._dotForMemory(s), undefined, hasMemory),
            this._section("Wait Statistics", this._buildWaitsSection(s), false, hasWait ? "yellow" : "green", (s.wait_stats || []).length, hasWait),
        ], (hasIndexesUsed ? 1 : 0) + (hasJoin ? 1 : 0) + (hasMemory ? 1 : 0) + (hasWait ? 1 : 0));

        var deepDive = this._group("deepdive", "DEEP DIVE", "Compilation settings & plan lookup queries", [
            this._section("Compilation & Settings", this._buildCompilationSection(s), false, this._dotForCompilation(s), undefined, hasCompilation),
            this._section("Lookup Queries", this._buildLookupQueriesSection(s), false, hasLookupQueries ? "yellow" : "green", undefined, hasLookupQueries),
        ], (hasCompilation ? 1 : 0) + (hasLookupQueries ? 1 : 0));

        return "<div class='pa-root'>" + this._buildSummaryBar() + this._buildStatementTabs() +
            orientation + cost + actionable + context + deepDive + "</div>";
    }

    private _buildSummaryBar(): string {
        var s = this.result.statements[this._activeStatement];
        var totalCost = this._num(s.total_cost || 0, 4);
        var stmtType = s.statement_type || "-";
        var optm = (s.compilation && s.compilation.optm_level) || "-";
        var missing = String((s.missing_indexes || []).length);
        var warnings = String((s.finding_groups || []).reduce(function (acc: number, g: FindingGroup) {
            return acc + g.count;
        }, 0));
        var parallel = s.dop > 1 ? ("DOP " + String(s.dop)) : (s.dop === 1 ? "None" : ((s.compilation && s.compilation.non_parallel_reason) ? "No" : "-"));
        var mem = s.memory_grant && s.memory_grant.max_used_kb !== null && s.memory_grant.max_used_kb !== undefined
            ? this._fmtKbOrMb(s.memory_grant.max_used_kb)
            : "-";
        var missingCls = (s.missing_indexes || []).length > 0 ? "sum-orange" : "sum-neutral";
        var warningCls = (s.critical_count || 0) > 0 ? "sum-red" : ((s.warning_count || 0) > 0 ? "sum-orange" : ((s.info_count || 0) > 0 ? "sum-neutral" : "sum-green"));
        var parallelCls = s.dop > 1 ? "sum-blue" : "sum-neutral";
        var memCls = "sum-neutral";
        if (s.memory_grant && s.memory_grant.granted_kb > 0 && s.memory_grant.max_used_kb !== null && s.memory_grant.max_used_kb !== undefined) {
            var ratio = (s.memory_grant.max_used_kb * 100) / s.memory_grant.granted_kb;
            memCls = ratio >= 90 ? "sum-red" : (ratio >= 50 ? "sum-orange" : "sum-green");
        }

        // Actual elapsed / cpu
        var elapsedVal = (s.elapsed_ms !== null && s.elapsed_ms !== undefined) ? this._fmtMs(s.elapsed_ms) : "-";
        var cpuVal = (s.cpu_ms !== null && s.cpu_ms !== undefined) ? this._fmtMs(s.cpu_ms) : "-";
        var elapsedCls = (s.elapsed_ms !== null && s.elapsed_ms !== undefined)
            ? (s.elapsed_ms >= 10000 ? "sum-red" : (s.elapsed_ms >= 1000 ? "sum-orange" : "sum-green")) : "sum-neutral";
        var cpuCls = (s.cpu_ms !== null && s.cpu_ms !== undefined)
            ? (s.cpu_ms >= 10000 ? "sum-red" : (s.cpu_ms >= 1000 ? "sum-orange" : "sum-green")) : "sum-neutral";

        // Wait statistics summary
        var waits = s.wait_stats || [];
        var topWait = waits.length ? waits.reduce((a, b) => a.ms >= b.ms ? a : b) : null;
        var totalWaitMs = waits.reduce((acc, w) => acc + w.ms, 0);
        var topWaitVal = topWait ? topWait.type : "-";
        var topWaitGlKey = topWait ? topWait.type.toLowerCase() : "wait_stat";
        var topWaitCls = topWait ? this._waitCls(topWait.type) : "sum-neutral";
        var waitTimeVal = totalWaitMs > 0 ? this._fmtMs(totalWaitMs) : "-";
        var waitTimeCls = totalWaitMs >= 10000 ? "sum-red" : (totalWaitMs >= 1000 ? "sum-orange" : "sum-neutral");

        var row1 = "<div class='pa-sum-row'>" +
            "<span class='pa-sum-item'><span class='pa-sum-val sum-neutral'>" + this._esc(stmtType) + "</span><span class='pa-sum-label' data-glossary='statement_type'>STMT TYPE</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val sum-purple'>" + this._esc(optm) + "</span><span class='pa-sum-label' data-glossary='optm_level'>OPTIMIZATION</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val " + warningCls + "'>" + this._esc(warnings) + "</span><span class='pa-sum-label' data-glossary='warnings_count'>WARNINGS</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val " + missingCls + "'>" + this._esc(missing) + "</span><span class='pa-sum-label' data-glossary='missing_index_impact'>MISSING IDX</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val " + parallelCls + "'>" + this._esc(parallel) + "</span><span class='pa-sum-label' data-glossary='dop'>PARALLELISM</span></span>" +
            "</div>";

        var row2 = "<div class='pa-sum-row pa-sum-row-2'>" +
            "<span class='pa-sum-item'><span class='pa-sum-val sum-blue'>" + this._esc(totalCost) + "</span><span class='pa-sum-label' data-glossary='total_cost'>EST. COST</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val " + elapsedCls + "'>" + this._esc(elapsedVal) + "</span><span class='pa-sum-label' data-glossary='actual_elapsed'>ELAPSED</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val " + cpuCls + "'>" + this._esc(cpuVal) + "</span><span class='pa-sum-label' data-glossary='cpu_time'>CPU TIME</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val " + memCls + "'>" + this._esc(mem) + "</span><span class='pa-sum-label' data-glossary='mem_used'>MEM USED</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val " + topWaitCls + "'>" + this._esc(topWaitVal) + "</span><span class='pa-sum-label' data-glossary='" + this._esc(topWaitGlKey) + "'>TOP WAIT</span></span>" +
            "<span class='pa-sum-sep'>|</span>" +
            "<span class='pa-sum-item'><span class='pa-sum-val " + waitTimeCls + "'>" + this._esc(waitTimeVal) + "</span><span class='pa-sum-label' data-glossary='wait_stat'>WAIT TIME</span></span>" +
            "</div>";

        return "<div class='pa-summary'>" + row1 + "<div class='pa-sum-divider'></div>" + row2 + "</div>";
    }

    private _buildStatementTabs(): string {
        if (this.result.statements.length <= 1) return "";
        return "<div class='pa-stmt-tabs'>" + this.result.statements.map((s, i) =>
            "<button type='button' class='pa-stmt-tab" + (i === this._activeStatement ? " active" : "") + "' data-stmt-index='" + String(i) + "'>" +
            this._esc((s.statement_type || "STMT") + " #" + String(i + 1)) + "</button>").join("") + "</div>";
    }

    private _section(title: string, body: string, open: boolean, dotColor: string = "blue", count?: number, hasDetail: boolean = true): string {
        var cntHtml = (count !== undefined && count > 0) ? "<span class='pa-count-badge'>" + String(count) + "</span>" : "";
        if (!hasDetail) {
            return "<div class='pa-section pa-section-static'><div class='pa-section-header'><span class='pa-section-dot " + this._esc(dotColor) + "'></span>" +
                this._esc(title) + cntHtml + "</div></div>";
        }
        return "<details class='pa-section'" + (open ? " open" : "") + "><summary class='pa-section-header'><span class='pa-section-dot " + this._esc(dotColor) + "'></span>" +
            this._esc(title) + cntHtml + "</summary><div class='pa-section-body'>" + body + "</div></details>";
    }

    private _group(id: string, label: string, desc: string, sections: string[], badge?: number, expanded: boolean = false): string {
        var badgeHtml = badge !== undefined ? "<span class='pa-group-badge'>" + String(badge) + "</span>" : "";
        return "<div class='pa-group" + (expanded ? "" : " collapsed") + "' data-group='" + this._escAttr(id) + "'>" +
            "<div class='pa-group-header' role='button'>" +
            "<span class='pa-group-dot " + this._esc(id) + "'></span>" +
            "<span class='pa-group-label'>" + this._esc(label) + "</span>" +
            "<span class='pa-group-desc' data-glossary='group_" + this._esc(id) + "'>&#183; " + this._esc(desc) + "</span>" +
            "<span class='pa-group-line'></span>" +
            badgeHtml +
            "<span class='pa-group-chevron'>&#9662;</span>" +
            "</div>" +
            "<div class='pa-group-body'>" + sections.join("") + "</div>" +
            "</div>";
    }

    private _buildIoSection(s: StatementResult): string {
        if (!s.io_stats || !s.io_stats.length) return "<div class='pa-empty'>No I/O stats.</div>";
        var max = this._maxIo(s.io_stats);
        var rows = s.io_stats.slice(0, 12).map((x, idx) => {
            var pct = max > 0 ? Math.round((x.logical_reads * 100) / max) : 0;
            var cls = pct >= 75 ? "danger" : (pct >= 40 ? "warning" : (pct >= 15 ? "seek" : "muted"));
            var metricParts: string[] = [];
            metricParts.push("<strong>" + this._fmtReads(x.logical_reads) + "</strong><span class='pa-io-unit' data-glossary='logical_reads'> log</span>");
            if (x.physical_reads > 0) metricParts.push("<strong>" + this._fmtReads(x.physical_reads) + "</strong><span class='pa-io-unit' data-glossary='physical_reads'> phys</span>");
            if (x.read_ahead_reads > 0) metricParts.push("<strong>" + this._fmtReads(x.read_ahead_reads) + "</strong><span class='pa-io-unit' data-glossary='read_ahead'> RA</span>");
            if (x.scan_count > 0) metricParts.push("<strong>" + this._fmtReads(x.scan_count) + "</strong><span class='pa-io-unit' data-glossary='scan_count'> scans</span>");
            return "<div class='pa-io-row'><div class='pa-io-head'>" +
                "<div class='pa-io-name'><span class='pa-op-tag'>" + this._esc(x.op_type_tag || "OTHER") + "</span> " +
                "<strong>" + this._esc(this._opDisplayNameFromIo(x)) + "</strong>" +
                (idx === 0 ? " <span class='pa-badge warning'>Highest</span>" : "") + "</div>" +
                "<div class='pa-io-metrics'>" + metricParts.join("&emsp;") + "</div></div>" +
                "<div class='pa-bar-wrap'><div class='pa-bar " + cls + "' style='width:" + String(pct) + "%'></div></div></div>";
        }).join("");
        return rows + "<div class='pa-recommendation'>Logical reads = buffer pool 8KB page reads.</div>";
    }

    private _buildTopExpensiveSection(s: StatementResult): string {
        if (!s.top_operators || !s.top_operators.length) return "<div class='pa-empty'>No operators.</div>";
        return s.top_operators.slice(0, 10).map((o, idx) => {
            var pct = Math.max(0, Math.min(100, Math.round(o.cost_pct || 0)));
            var pctCls = pct >= 70 ? "high" : (pct >= 30 ? "mid" : "");
            var badges = (o.has_row_est_off ? "<span class='pa-badge warning' data-glossary='estimated_rows'>Row Est Off</span>" : "") + (o.has_spill ? "<span class='pa-badge critical' data-glossary='spill_to_tempdb'>Spill</span>" : "");
            var glKey = this._opGlossaryKey(o.physical_op, o.logical_op);
            var glAttr = glKey ? " data-glossary='" + glKey + "'" : "";
            return "<div class='pa-teo-item'>" +
                "<div class='pa-teo-head'>" +
                "<span class='pa-teo-op-name'" + glAttr + ">" + this._esc(this._opDisplayName(o)) + "</span>" +
                "<span class='pa-op-tag'>" + this._esc(o.op_type_tag || "OTHER") + "</span>" +
                badges +
                "<span class='pa-teo-num'>#" + String(idx + 1) + "</span>" +
                "</div>" +
                "<div class='pa-teo-metrics'>Cost: <strong>" + this._num(o.cost, 2) + "</strong>" +
                "&emsp;% total: <span class='val " + pctCls + "'>" + this._num(o.cost_pct, 1) + "%</span>" +
                "&emsp;Est rows: " + this._num(o.estimated_rows, 0) +
                "&emsp;Act rows: " + this._nullableNum(o.actual_rows, 0) + "</div>" +
                "<div class='pa-bar-wrap'><div class='pa-teo-bar " + this._opTagClass(o.op_type_tag || "") + "' style='width:" + String(pct) + "%'></div></div>" +
                "</div>";
        }).join("");
    }

    private _opGlossaryKey(physicalOp: string, logicalOp: string): string {
        var op = (physicalOp || "").toLowerCase();
        var lop = (logicalOp || "").toLowerCase();
        if (op === "sort" || op === "distinct sort") return "op_sort";
        if (op === "filter") return "op_filter";
        if (op === "top") return "op_top";
        if (op === "compute scalar") return "op_compute_scalar";
        if (op === "stream aggregate") return "op_stream_aggregate";
        if (op === "hash match" && lop.indexOf("aggregate") >= 0) return "op_hash_match";
        if (op === "hash match") return "op_hash_match";
        if (op === "nested loops") return "op_nested_loops";
        if (op === "merge join") return "op_merge_join";
        if (op === "index seek" || op === "clustered index seek") return "op_index_seek";
        if (op === "index scan") return "op_index_scan";
        if (op === "clustered index scan") return "op_clustered_index_scan";
        if (op === "table scan") return "op_table_scan";
        if (op === "key lookup") return "op_key_lookup";
        if (op === "rid lookup") return "op_rid_lookup";
        if (op === "parallelism") return "op_parallelism";
        if (op === "bitmap") return "op_bitmap";
        if (op === "window spool") return "op_window_spool";
        if (op === "lazy spool" || op === "eager spool" || op === "table spool" || op === "index spool") return "op_spool";
        if (op === "concatenation") return "op_concatenation";
        if (op === "assert") return "op_assert";
        if (op === "remote query" || op === "remote scan") return "op_remote";
        return "";
    }

    private _buildWarningsSection(s: StatementResult): string {
        var groups = s.finding_groups;
        if (!groups || !groups.length) return "<div class='pa-empty'>No warnings.</div>";
        return groups.map((g: FindingGroup) => {
            var sev = g.severity || "info";
            var cat = this._warnCat(g.type);
            var catTag = (g.category || cat || "info").toUpperCase();
            var countBadge = g.count > 1
                ? "<span class='pa-finding-count'>&times;" + String(g.count) + "</span>"
                : "";
            // description: chỉ hiện khi count=1
            var descHtml = g.count === 1 && g.instances.length
                ? "<div class='pa-finding-desc'>" + this._renderText(g.instances[0].description) + "</div>"
                : "";
            // DDL: shared (count>1, tất cả cùng DDL) hoặc instance đơn
            var ddlSource = g.count === 1 && g.instances.length ? g.instances[0].action
                : (g.shared_action || null);
            var sharedDdlHtml = ddlSource && ddlSource.ddl
                ? "<div class='pa-ddl-wrap'><button type='button' class='pa-ddl-copy' data-copy-ddl='" + this._escAttr(ddlSource.ddl) + "'>Copy DDL</button><pre class='pa-ddl'>" + this._esc(ddlSource.ddl) + "</pre></div>"
                : "";
            // Instances list (chỉ khi count>1)
            var instancesHtml = "";
            if (g.count > 1) {
                instancesHtml = "<div class='pa-finding-instances'>" +
                    g.instances.map((inst) => {
                        var instDdlHtml = inst.action && inst.action.ddl && (!g.shared_action || inst.action.ddl !== g.shared_action.ddl)
                            ? "<div class='pa-ddl-wrap'><button type='button' class='pa-ddl-copy' data-copy-ddl='" + this._escAttr(inst.action.ddl) + "'>Copy DDL</button><pre class='pa-ddl'>" + this._esc(inst.action.ddl) + "</pre></div>"
                            : "";
                        return "<div class='pa-finding-inst'>" +
                            "<span class='pa-finding-inst-bullet'>&#8226;</span>" +
                            "<span class='pa-finding-inst-desc'>" + this._renderText(inst.description) + "</span>" +
                            instDdlHtml +
                            "</div>";
                    }).join("") +
                    "</div>";
            }
            return "<div class='pa-finding-card " + this._esc(sev) + "'>" +
                "<div class='pa-finding-header'>" +
                "<span class='pa-badge " + this._esc(sev) + "'>" + sev.toUpperCase() + "</span>" +
                "<span class='pa-op-tag'>" + this._esc(catTag) + "</span>" +
                "<span class='pa-finding-type'>" + this._esc(g.type) + "</span>" +
                countBadge +
                "</div>" +
                "<div class='pa-warn-accent " + this._esc(cat || "perf") + "'></div>" +
                "<div class='pa-finding-body'>" +
                (cat ? "<div class='pa-warning-category " + this._esc(cat) + "' data-glossary='" + this._esc(g.type) + "'>" + this._esc(this._warnLabel(g.type)) + "</div>" : "") +
                descHtml +
                "<div class='pa-recommendation'>" + this._renderText(g.recommendation) + "</div>" +
                sharedDdlHtml +
                instancesHtml +
                "</div>" +
                "</div>";
        }).join("");
    }

    private _buildEstActualSection(s: StatementResult): string {
        var mismatches = (s.top_operators || []).filter((o) => o.has_row_est_off);
        if (!mismatches.length) return "<div class='pa-empty'>No significant estimate mismatch.</div>";
        mismatches = mismatches.slice().sort((a, b) => {
            var ra = (a.actual_rows !== null && a.actual_rows !== undefined && a.estimated_rows > 0) ? a.actual_rows / a.estimated_rows : 0;
            var rb = (b.actual_rows !== null && b.actual_rows !== undefined && b.estimated_rows > 0) ? b.actual_rows / b.estimated_rows : 0;
            var sa = ra > 1 ? ra : (ra > 0 ? 1 / ra : 0);
            var sb = rb > 1 ? rb : (rb > 0 ? 1 / rb : 0);
            return sb - sa;
        });
        var rows = mismatches.map((o) => {
            var ratio = (o.actual_rows !== null && o.actual_rows !== undefined && o.estimated_rows > 0)
                ? o.actual_rows / o.estimated_rows : null;
            var ratioStr = ratio === null ? "-" : (ratio >= 1 ? ("+" + this._num(ratio, 1) + "×") : ("÷" + this._num(1 / ratio, 1) + "×"));
            var ratioCls = ratio === null ? "" : (ratio >= 100 || ratio <= 0.01 ? " class='high'" : " class='mid'");
            return "<tr><td>" + this._esc(o.physical_op) + " #" + String(o.node_id) + "</td>" +
                "<td class='num'>" + this._num(o.estimated_rows, 0) + "</td>" +
                "<td class='num'>" + this._nullableNum(o.actual_rows, 0) + "</td>" +
                "<td class='num'><span" + ratioCls + ">" + ratioStr + "</span></td></tr>";
        }).join("");
        return "<table class='pa-table'><thead><tr><th>Operator</th><th><span data-glossary='estimated_rows'>Est Rows</span></th><th><span data-glossary='actual_rows'>Act Rows</span></th><th><span data-glossary='row_est_ratio'>Ratio</span></th></tr></thead><tbody>" + rows + "</tbody></table>";
    }

    private _buildJoinTypesSection(s: StatementResult): string {
        if (!s.join_types || !s.join_types.length) return "<div class='pa-empty'>No join operations.</div>";
        var chips = s.join_types.map((j: JoinTypeSummary) => {
            if (j.join_type === "__spill__") return "<span class='pa-jchip spill' data-glossary='spill_to_tempdb'>Spill to TempDB x" + String(j.count) + "</span>";
            var cls = j.join_type === "Sort" ? "sort" : (j.join_type === "Parallelism" ? "parallel" : "join");
            var glKey = j.join_type === "Sort" ? "sort_op" : (j.join_type === "Parallelism" ? "parallelism_op" : (j.join_type === "Hash Match" ? "hash_match" : (j.join_type === "Nested Loops" ? "nested_loops" : (j.join_type === "Merge Join" ? "merge_join" : ""))));
            var glAttr = glKey ? " data-glossary='" + glKey + "'" : "";
            return "<span class='pa-jchip " + cls + "'" + glAttr + ">" + this._esc(j.join_type) + " x" + String(j.count) + "</span>";
        }).join("");
        var hasSpill = s.join_types.some((j) => j.join_type === "__spill__");
        var hasHash = s.join_types.some((j) => j.join_type === "Hash Match");
        var note = (hasSpill ? "<div class='pa-section-note' data-glossary='spill_to_tempdb'>Spills detected: operations exceeded memory grant and wrote to disk.</div>" : "") +
            (hasHash ? "<div class='pa-section-note' data-glossary='hash_match'>Hash Match hiện diện: kiểm tra index trên cột join để giảm chi phí hash khi phù hợp.</div>" : "");
        return "<div class='pa-join-chips'>" + chips + "</div>" + note;
    }

    private _buildStatsSection(s: StatementResult): string {
        if (!s.statistics || !s.statistics.length) return "<div class='pa-empty'>No statistics usage.</div>";
        var rows = s.statistics.map((x) => {
            var staleRow = x.is_stale ? " class='stale'" : "";
            return "<tr" + staleRow + "><td>" + this._esc(x.table) + "</td><td>" + this._esc(x.statistic) + "</td><td class='num'>" + this._nullableNum(x.modification_count, 0) +
                "</td><td class='num'>" + this._nullableNum(x.sampling_percent, 0) + "%</td><td>" + this._esc(x.last_update || "") + "</td></tr>";
        }).join("");
        return "<table class='pa-table pa-stats-table'><thead><tr><th>Table</th><th>Statistic</th><th><span data-glossary='statistics_modification_count'>Modification</span></th><th><span data-glossary='sampling_percent'>Sampling</span></th><th>Last Update</th></tr></thead><tbody>" + rows + "</tbody></table>";
    }

    private _buildParametersSection(s: StatementResult): string {
        if (!s.parameters || !s.parameters.length) return "<div class='pa-empty'>No parameters.</div>";
        var declareLines = s.parameters.map((p) => {
            var dtype = p.data_type || "sql_variant";
            var val = p.runtime_value || p.compiled_value || "NULL";
            return "DECLARE " + p.name + " " + dtype + " = " + val + ";";
        }).join("\n");
        var rows = s.parameters.map((p) => {
            var sniff = (p.compiled_value && p.runtime_value && p.compiled_value !== p.runtime_value)
                ? " <span class='pa-badge warning'>Sniffing</span>" : "";
            return "<tr><td>" + this._esc(p.name) + sniff + "</td><td>" + this._esc(p.data_type || "") + "</td><td>" + this._esc(p.compiled_value || "") +
                "</td><td>" + this._esc(p.runtime_value || "") + "</td></tr>";
        }).join("");
        return "<pre class='pa-ddl'>" + this._esc(declareLines) + "</pre>" +
            "<table class='pa-table'><thead><tr><th>Name</th><th>Type</th><th><span data-glossary='parameter_sniffing'>Compiled</span></th><th><span data-glossary='parameter_sniffing'>Runtime</span></th></tr></thead><tbody>" + rows + "</tbody></table>";
    }

    private _buildIndexesUsedSection(s: StatementResult): string {
        if (!s.indexes_used || !s.indexes_used.length) return "<div class='pa-empty'>No indexes used.</div>";
        var rows = s.indexes_used.map((x) => {
            var lookup = x.op_type === "Lookup" ? " <span class='pa-badge warning' data-glossary='key_lookup'>Lookup</span>" : "";
            var part = x.is_partitioned ? " (partitioned)" : "";
            return "<tr><td>" + this._esc(x.table) + "</td><td>" + this._esc(x.index) + "</td><td>" + this._esc(x.index_kind) +
                "</td><td>" + this._esc(x.op_type) + lookup + "</td><td>" + this._esc(part) + "</td></tr>";
        }).join("");
        return "<table class='pa-table'><thead><tr><th>Table</th><th>Index</th><th>Kind</th><th>Op</th><th>Partition</th></tr></thead><tbody>" + rows + "</tbody></table>";
    }

    private _buildLookupQueriesSection(s: StatementResult): string {
        var q = s.compilation && s.compilation.lookup_queries ? s.compilation.lookup_queries : null;
        if (!q) return "<div class='pa-empty'>No query hash available.</div>";
        return "<div class='pa-ddl-wrap'><button type='button' class='pa-ddl-copy' data-copy-ddl='" + this._escAttr(q.plan_cache_sql) +
            "'>Copy Plan Cache SQL</button><pre class='pa-ddl'>" + this._esc(q.plan_cache_sql) + "</pre></div>" +
            "<div class='pa-ddl-wrap'><button type='button' class='pa-ddl-copy' data-copy-ddl='" + this._escAttr(q.query_store_sql) +
            "'>Copy Query Store SQL</button><pre class='pa-ddl'>" + this._esc(q.query_store_sql) + "</pre></div>";
    }

    private _buildMemorySection(s: StatementResult): string {
        if (!s.memory_grant) return "<div class='pa-empty'>No memory grant info.</div>";
        var mg = s.memory_grant;
        var used = mg.max_used_kb || 0;
        var granted = mg.granted_kb || 0;
        var ratio = granted > 0 ? Math.min(100, Math.round((used * 100) / granted)) : 0;
        var level = ratio >= 90 ? "danger" : (ratio >= 50 ? "warning" : "ok");
        return "<div class='pa-memory-grid'><div class='pa-memory-label' data-glossary='memory_grant'>Granted</div><div>" + this._kbToMb(granted) +
            " MB</div><div class='pa-memory-label' data-glossary='memory_grant'>Used</div><div><div class='pa-memory-bar-container'><div class='pa-bar-wrap'><div class='pa-bar " + level +
            "' style='width:" + String(ratio) + "%'></div></div><span class='pa-memory-threshold-line low'></span><span class='pa-memory-threshold-line high'></span></div>" +
            this._kbToMb(used) + " MB (" + String(ratio) + "%)</div><div class='pa-memory-label' data-glossary='resource_semaphore'>Wait</div><div>" + String(mg.grant_wait_ms || 0) + " ms</div></div>";
    }

    private _buildWaitsSection(s: StatementResult): string {
        if (!s.wait_stats || !s.wait_stats.length) return "<div class='pa-empty'>No wait stats.</div>";
        var max = 1;
        for (var i = 0; i < s.wait_stats.length; i++) if (s.wait_stats[i].ms > max) max = s.wait_stats[i].ms;
        return s.wait_stats.map((w) => {
            var pct = Math.round((w.ms * 100) / max);
            var cls = pct >= 75 ? "danger" : (pct >= 40 ? "warning" : "ok");
            return "<div class='pa-wait-row'><div class='pa-wait-head'>" +
                "<span class='pa-wait-type' data-glossary='" + this._esc(w.type.toLowerCase()) + "'>" + this._esc(w.type) + "</span>" +
                "<span class='pa-wait-stats'><strong>" + this._num(w.ms, 0) + "</strong><span class='pa-io-unit'> ms</span>" +
                "&emsp;<span class='pa-wait-count'>" + this._num(w.count, 0) + "&times;</span></span>" +
                "</div><div class='pa-bar-wrap'><div class='pa-bar " + cls + "' style='width:" + String(pct) + "%'></div></div></div>";
        }).join("");
    }

    private _buildCompilationSection(s: StatementResult): string {
        var c = s.compilation;
        if (!c) return "<div class='pa-empty'>No compilation info.</div>";
        return "<div class='pa-memory-grid'><div class='pa-memory-label' data-glossary='cardinality_estimation'>CE Model</div><div>" + String(c.ce_model_version) +
            (c.ce_model_version === 70 ? " <span class='pa-badge warning'>Legacy SQL 2012</span>" : "") +
            "</div><div class='pa-memory-label' data-glossary='dop'>DOP</div><div>" + String(c.dop) +
            "</div><div class='pa-memory-label' data-glossary='compile_cpu'>Compile CPU</div><div>" + String(c.compile_cpu_ms) + " ms" +
            "</div><div class='pa-memory-label' data-glossary='compile_memory'>Compile Memory</div><div>" + this._kbToMb(c.compile_memory_kb) + " MB" +
            "</div><div class='pa-memory-label'>Plan Size</div><div>" + this._num(c.cached_plan_size_kb || 0, 0) + " KB" +
            "</div><div class='pa-memory-label' data-glossary='optm_level'>Optm level</div><div>" + this._esc(c.optm_level || "") +
            "</div><div class='pa-memory-label'>Early abort</div><div>" + this._esc(c.early_abort_reason || "") +
            "</div><div class='pa-memory-label' data-glossary='non_parallel_reason'>Non-parallel reason</div><div>" + this._esc(c.non_parallel_reason || "") +
            "</div><div class='pa-memory-label' data-glossary='query_hash'>Query hash</div><div>" + this._esc(c.query_hash || "") +
            "</div><div class='pa-memory-label' data-glossary='plan_hash'>Plan hash</div><div>" + this._esc(c.query_plan_hash || "") + "</div></div>";
    }

    private _buildIndexesSection(s: StatementResult): string {
        if (!s.missing_indexes || !s.missing_indexes.length) return "<div class='pa-empty'>No missing index suggestion.</div>";
        return s.missing_indexes.map((x) => "<div class='pa-index-card'><span class='pa-impact-badge' data-glossary='missing_index_impact'>IMPACT " + this._num(x.impact, 1) + "%</span><div><strong>" + this._esc(x.table) +
            "</strong></div><div class='pa-index-cols'><div class='pa-index-cols-label' data-glossary='idx_equality_col'>Equality</div><div class='pa-index-col-value'>" + this._esc(x.equality_columns.join(", ")) +
            "</div><div class='pa-index-cols-label' data-glossary='idx_inequality_col'>Inequality</div><div class='pa-index-col-value'>" + this._esc(x.inequality_columns.join(", ")) +
            "</div><div class='pa-index-cols-label' data-glossary='idx_include_col'>Include</div><div class='pa-index-col-value'>" + this._esc(x.include_columns.join(", ")) + "</div></div>" +
            (x.create_statement ? "<div class='pa-ddl-wrap'><button type='button' class='pa-ddl-copy' data-copy-ddl='" + this._escAttr(x.create_statement) +
                "'>Copy DDL</button><pre class='pa-ddl'>" + this._esc(x.create_statement) + "</pre></div>" : "") + "</div>").join("");
    }

    private _renderDdl(f: PlanFinding): string {
        var ddl = f.action && f.action.ddl ? f.action.ddl : "";
        return ddl ? "<div class='pa-ddl-wrap'><button type='button' class='pa-ddl-copy' data-copy-ddl='" + this._escAttr(ddl) + "'>Copy DDL</button><pre class='pa-ddl'>" + this._esc(ddl) + "</pre></div>" : "";
    }

    private _bindEvents(): void {
        var self = this;
        var tabs = this.root.querySelectorAll(".pa-stmt-tab");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener("click", function () {
                var idx = Number((this as HTMLElement).getAttribute("data-stmt-index") || "0");
                self._activeStatement = idx;
                self.render();
            });
        }
        var copyBtns = this.root.querySelectorAll("[data-copy-ddl]");
        for (var j = 0; j < copyBtns.length; j++) {
            copyBtns[j].addEventListener("click", function () {
                self._copyDdl(this as HTMLElement);
            });
        }
        var groupHeaders = this.root.querySelectorAll(".pa-group-header");
        for (var k = 0; k < groupHeaders.length; k++) {
            groupHeaders[k].addEventListener("click", function () {
                var grp = (this as HTMLElement).closest(".pa-group");
                if (grp) grp.classList.toggle("collapsed");
            });
        }
    }

    private _copyDdl(btn: HTMLElement): void {
        var txt = btn.getAttribute("data-copy-ddl") || "";
        var nav: any = navigator;
        if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") nav.clipboard.writeText(txt).catch(function () {
            fallbackCopyText(txt);
        });
        else fallbackCopyText(txt);
        var old = btn.textContent || "Copy DDL";
        btn.textContent = "Copied!";
        setTimeout(function () {
            btn.textContent = old;
        }, 1200);
    }

    private _maxIo(items: IOStatSummary[]): number {
        var max = 1;
        for (var i = 0; i < items.length; i++) if (items[i].logical_reads > max) max = items[i].logical_reads;
        return max;
    }

    private _fmtReads(n: number): string {
        if (n >= 1000000) return this._num(n / 1000000, 1) + "M";
        if (n >= 1000) return this._num(n / 1000, 1) + "K";
        return this._num(n, 0);
    }

    private _fmtMs(ms: number): string {
        if (ms >= 60000) return this._num(ms / 60000, 1) + " m";
        if (ms >= 1000) return this._num(ms / 1000, 1) + " s";
        return this._num(ms, 0) + " ms";
    }

    private _waitCls(type: string): string {
        var t = (type || "").toUpperCase();
        if (t === "CXPACKET" || t === "CXCONSUMER") return "sum-blue";
        if (t.indexOf("PAGEIOLATCH") >= 0 || t === "IO_COMPLETION" || t === "WRITELOG") return "sum-orange";
        if (t === "RESOURCE_SEMAPHORE" || t === "RESOURCE_SEMAPHORE_QUERY_COMPILE") return "sum-red";
        if (t === "SOS_SCHEDULER_YIELD" || t === "THREADPOOL") return "sum-orange";
        if (t.indexOf("LATCH") >= 0) return "sum-orange";
        if (t === "ASYNC_NETWORK_IO") return "sum-neutral";
        return "sum-neutral";
    }

    private _fmtKbOrMb(kb: number): string {
        return kb >= 1024 ? (this._num(kb / 1024, 1) + " MB") : (this._num(kb, 0) + " KB");
    }

    private _opDisplayName(o: OperatorSummary): string {
        if ((o.op_type_tag === "SEEK" || o.op_type_tag === "LOOKUP" || o.op_type_tag === "SCAN") && o.table_name) {
            var label = o.table_name;
            if (o.index_name) label += " -> " + o.index_name;
            return o.physical_op + ": [" + label + "]";
        }
        return o.physical_op;
    }

    private _opDisplayNameFromIo(x: IOStatSummary): string {
        if ((x.op_type_tag === "SEEK" || x.op_type_tag === "LOOKUP" || x.op_type_tag === "SCAN") && x.table_name) {
            var label = x.table_name;
            if (x.index_name) label += " -> " + x.index_name;
            return x.physical_op + ": [" + label + "]";
        }
        return x.physical_op + " #" + String(x.node_id);
    }

    private _opTagClass(tag: string): string {
        var map: Record<string, string> = {
            SORT: "teo-sort", PARALLEL: "teo-parallel", JOIN: "teo-join",
            SEEK: "teo-seek", AGG: "teo-agg", HASH: "teo-hash",
            SCAN: "teo-scan", LOOKUP: "teo-seek",
        };
        return map[tag] || "teo-other";
    }

    private _warnLabel(type: string): string {
        var labels: Record<string, string> = {
            spill_to_tempdb: "SPILL TO TEMPDB",
            memory_spill_risk: "SPILL RISK: MEMORY NEAR LIMIT",
            sort_expensive: "PERFORMANCE: EXPENSIVE SORT",
            ineffective_parallelism: "PARALLEL: LOW EFFICIENCY",
            key_lookup: "INDEX: KEY LOOKUP",
            rid_lookup: "INDEX: RID LOOKUP",
            scan_with_predicate: "INDEX: SCAN WITH PREDICATE",
            non_sargable_implicit: "INDEX: IMPLICIT CONVERSION",
            row_estimate_mismatch: "STATS: ROW ESTIMATE MISMATCH",
            row_underestimate: "STATS: ROW UNDER-ESTIMATE → SPILL RISK",
            row_overestimate: "STATS: ROW OVER-ESTIMATE → MEMORY WASTE",
            stale_statistics: "STATS: STALE STATISTICS",
            high_compile_cpu: "COMPILE: HIGH CPU",
            compile_memory_exceeded: "COMPILE: MEMORY EXCEEDED",
            ce_model_legacy: "CE MODEL: LEGACY (SQL 2012)",
            memory_grant_wait: "MEMORY: GRANT WAIT",
            memory_large_grant: "MEMORY: LARGE GRANT",
            serial_plan_actionable: "PARALLEL: SERIAL PLAN (FIXABLE)",
            scalar_udf: "CODE: SCALAR UDF",
            missing_index: "INDEX: MISSING INDEX",
        };
        return labels[type] || type.toUpperCase().replace(/_/g, " ");
    }

    private _warnCat(type: string): string {
        if (type.indexOf("spill") >= 0 || type === "memory_spill_risk") return "spill";
        if (type.indexOf("sort") >= 0 || type.indexOf("scan") >= 0 || type.indexOf("compile") >= 0) return "perf";
        if (type.indexOf("parallel") >= 0 || type.indexOf("serial") >= 0) return "parallel";
        if (type.indexOf("key_lookup") >= 0 || type.indexOf("rid_lookup") >= 0 || type.indexOf("index") >= 0 || type.indexOf("sargable") >= 0) return "index";
        if (type.indexOf("statistic") >= 0 || type === "row_estimate_mismatch" || type === "row_underestimate" || type === "row_overestimate") return "stats";
        if (type.indexOf("memory") >= 0 || type === "ce_model_legacy" || type === "scalar_udf") return "perf";
        return "perf";
    }

    private _dotForTopOps(s: StatementResult): string {
        if (!s.top_operators || !s.top_operators.length) return "green";
        return s.top_operators.some((o) => o.has_spill) ? "red" : "yellow";
    }

    private _dotForWarnings(s: StatementResult): string {
        if ((s.critical_count || 0) > 0) return "red";
        if ((s.warning_count || 0) > 0) return "yellow";
        return "green";
    }

    private _dotForEstActual(s: StatementResult): string {
        return (s.top_operators || []).some((o) => o.has_row_est_off) ? "yellow" : "green";
    }

    private _dotForJoinTypes(s: StatementResult): string {
        if ((s.join_types || []).some((j) => j.join_type === "__spill__")) return "red";
        return (s.join_types || []).length ? "blue" : "green";
    }

    private _dotForStats(s: StatementResult): string {
        return (s.statistics || []).some((x) => x.is_stale) ? "yellow" : "green";
    }

    private _dotForMemory(s: StatementResult): string {
        if (!s.memory_grant) return "green";
        var used = s.memory_grant.max_used_kb || 0;
        var granted = s.memory_grant.granted_kb || 0;
        var ratio = granted > 0 ? Math.round((used * 100) / granted) : 0;
        if (ratio >= 90) return "red";
        if (ratio >= 50) return "yellow";
        return "green";
    }

    private _dotForCompilation(s: StatementResult): string {
        var c = s.compilation;
        if (!c) return "green";
        if (c.ce_model_version === 70 || c.compile_cpu_ms > 1000) return "yellow";
        return "blue";
    }

    private _sevOrder(f: PlanFinding): number {
        return f.severity === "critical" ? 0 : (f.severity === "warning" ? 1 : 2);
    }

    private _kbToMb(v: number): string {
        return this._num((v || 0) / 1024, 1);
    }

    private _num(v: number, d: number): string {
        return Number(v || 0).toLocaleString(undefined, {maximumFractionDigits: d, minimumFractionDigits: d});
    }

    private _nullableNum(v: number | null, d: number): string {
        return v === null || v === undefined ? "-" : this._num(v, d);
    }

    private _esc(s: string): string {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
    }

    private _escAttr(s: string): string {
        return this._esc(s).replace(/\n/g, "&#10;");
    }

    private _renderText(s: string): string {
        var escaped = this._esc(s || "");
        return escaped.replace(/`([^`]+)`/g, "<code class='pa-kw'>$1</code>");
    }

    private _formatQueryText(s: StatementResult): string {
        var text = (s.statement_text || "").trim();
        var declare = (s.parameters || []).map((p) => {
            var dtype = p.data_type || "sql_variant";
            var val = p.runtime_value || p.compiled_value || "NULL";
            return "DECLARE " + p.name + " " + dtype + " = " + val + ";";
        }).join("\n");
        var sql = text
            .replace(/\bSELECT\b/gi, "\nSELECT")
            .replace(/\bFROM\b/gi, "\nFROM")
            .replace(/\bJOIN\b/gi, "\nJOIN")
            .replace(/\bWHERE\b/gi, "\nWHERE")
            .replace(/\bAND\b/gi, "\n  AND")
            .replace(/\bOR\b/gi, "\n  OR")
            .trim();
        return (declare ? (declare + "\n\n") : "") + sql;
    }
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
    try {
        document.execCommand("copy");
    } catch (_e) {
    }
    document.body.removeChild(ta);
}
