import * as xml from "./xml";
import { drawLines } from "./lines";
import { initTooltip } from "./tooltip";
import { Node } from "./node";
import { buildXmlTreeHtml } from "./xml-tree";
import { extractParamMap, mergeParamMaps, resolveStatementQuery } from "@layer3/core";
declare function require(path: string) : any;
let qpXslt = require("raw-loader!./qp.xslt");

interface Options {
    jsTooltips?: boolean
}

interface QueryActionContext {
    block: HTMLElement
    queryText: string
}

interface QueryActionHandlers {
    onOpenQueryPopup?: (ctx: QueryActionContext) => void
    onShowPlanXml?: (ctx: QueryActionContext) => void
    onCopyPlanXml?: (ctx: QueryActionContext) => void
    onBeautify?: (ctx: QueryActionContext) => void
    onAiAssist?: (ctx: QueryActionContext) => void
}

function showPlan(container: Element, planXml: string, options?: Options) {
    options = setDefaults(options, {
        jsTooltips: true
    });

    xml.setContentsUsingXslt(container, planXml, qpXslt);
    container["xml"] = new DOMParser().parseFromString(planXml, "text/xml");
    initResolvedQueries(container, container["xml"]);
    adjustStatementLayout(container);
    initQueryTabs(container);
    initQueryCopyButtons(container);
    drawLines(container);
    initDiagramInteractions(container, hasRuntimeMetrics(container["xml"]));

    if (options.jsTooltips) {
        initTooltip(container);
    }
}

function hasRuntimeMetrics(xmlDoc: XMLDocument): boolean {
    if (xmlDoc == null) return false;
    return xmlDoc.getElementsByTagName("RunTimeCountersPerThread").length > 0;
}

function initQueryCopyButtons(container: Element) {
    let blocks = container.querySelectorAll(".qp-statement-block");
    for (let i = 0; i < blocks.length; i++) {
        let block = <HTMLElement>blocks[i];
        let tabs = block.querySelector(".qp-query-tabs") as HTMLElement;
        if (tabs == null) continue;
        if (tabs.querySelector(".qp-query-copy-btn") != null) continue;

        let oldActions = block.querySelectorAll(".qp-query-actions");
        for (let j = 0; j < oldActions.length; j++) {
            let n = oldActions[j];
            if (n.parentElement != null) n.parentElement.removeChild(n);
        }

        let copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "qp-query-tab qp-query-action qp-query-copy-btn";
        copyBtn.title = "Copy query text";
        copyBtn.setAttribute("aria-label", "Copy query text");
        copyBtn.textContent = "⧉";
        copyBtn.addEventListener("click", function (event: MouseEvent) {
            event.preventDefault();
            event.stopPropagation();
            let text = getActiveQueryText(block);
            if (!text) return;
            copyTextToClipboard(text);
            let prev = copyBtn.textContent;
            copyBtn.textContent = "✓";
            window.setTimeout(function () { copyBtn.textContent = prev || "⧉"; }, 900);
        });

        let expandBtn = document.createElement("button");
        expandBtn.type = "button";
        expandBtn.className = "qp-query-tab qp-query-action qp-query-expand-btn qp-open-query-popup";
        expandBtn.title = "Expand query";
        expandBtn.setAttribute("aria-label", "Expand query");
        expandBtn.textContent = "⤢";

        let queryTabs = tabs.querySelectorAll(".qp-query-tab[data-tab]");
        if (queryTabs.length > 0) {
            let anchor = queryTabs[queryTabs.length - 1];
            if (anchor.nextSibling != null) tabs.insertBefore(copyBtn, anchor.nextSibling);
            else tabs.appendChild(copyBtn);
            if (copyBtn.nextSibling != null) tabs.insertBefore(expandBtn, copyBtn.nextSibling);
            else tabs.appendChild(expandBtn);
        } else {
            tabs.appendChild(copyBtn);
            tabs.appendChild(expandBtn);
        }
    }
}

function copyTextToClipboard(text: string) {
    let nav: any = navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
        nav.clipboard.writeText(text).catch(function () {
            fallbackCopy(text);
        });
        return;
    }
    fallbackCopy(text);
}

function fallbackCopy(text: string) {
    let ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.top = "-10000px";
    ta.style.left = "-10000px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_e) {}
    document.body.removeChild(ta);
}

function adjustStatementLayout(container: Element) {
    let blocks = container.querySelectorAll(".qp-statement-block");
    for (let i = 0; i < blocks.length; i++) {
        let block = <HTMLElement>blocks[i];
        let missingPanel = <HTMLElement>block.querySelector(".qp-missing-index-panel");
        let queryPanel = <HTMLElement>block.querySelector(".qp-statement-query-panel");
        let hasMissingIndex = missingPanel != null && missingPanel.querySelector(".missing-index") != null;

        block.classList.remove("qp-no-missing-index");
        if (!hasMissingIndex) {
            block.classList.add("qp-no-missing-index");
            if (missingPanel != null) {
                missingPanel.innerHTML = "";
            }
        }

        if (queryPanel != null) {
            queryPanel.scrollTop = 0;
        }
        if (missingPanel != null) {
            missingPanel.scrollTop = 0;
        }
    }
}

function initQueryTabs(container: Element) {
    let blocks = container.querySelectorAll(".qp-statement-block");
    for (let i = 0; i < blocks.length; i++) {
        let block = <HTMLElement>blocks[i];
        let tabs = block.querySelectorAll(".qp-query-tab");
        for (let t = 0; t < tabs.length; t++) {
            let tab = <HTMLElement>tabs[t];
            if (tab.getAttribute("data-tab") == null) {
                continue;
            }
            tab.addEventListener("click", () => activateQueryTab(block, tab));
        }
    }
}

function activateQueryTab(block: HTMLElement, tab: HTMLElement) {
    let tabKey = tab.getAttribute("data-tab");
    if (tabKey == null) {
        return;
    }
    let tabs = block.querySelectorAll(".qp-query-tab");
    for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove("active");
    }
    tab.classList.add("active");

    let panes = block.querySelectorAll(".qp-query-pane");
    for (let i = 0; i < panes.length; i++) {
        let pane = <HTMLElement>panes[i];
        pane.classList.toggle("active", pane.getAttribute("data-pane") === tabKey);
    }
}

function initResolvedQueries(container: Element, xmlDoc: XMLDocument) {
    if (xmlDoc == null) return;

    let statements = getStatementNodes(xmlDoc);
    let globalParamMap = extractParamMap(xmlDoc.documentElement);
    let blocks = container.querySelectorAll(".qp-statement-block");
    let count = Math.min(statements.length, blocks.length);
    for (let i = 0; i < count; i++) {
        let resolvedContainer = <HTMLElement>blocks[i].querySelector(".qp-resolved-query");
        if (resolvedContainer == null) continue;

        let statementText = statements[i].getAttribute("StatementText") || "";
        let localMap = extractParamMap(statements[i]);
        let mergedMap = mergeParamMaps(globalParamMap, localMap);
        let resolved = resolveStatementQuery(statementText, mergedMap);
        resolvedContainer.textContent = resolved || statementText;
    }
}

function getStatementNodes(xmlDoc: XMLDocument): Element[] {
    let all = xmlDoc.getElementsByTagName("*");
    let result: Element[] = [];
    for (let i = 0; i < all.length; i++) {
        let el = all[i];
        if (el.hasAttribute != null && el.hasAttribute("StatementText")) {
            result.push(el);
        }
    }
    return result;
}

function initDiagramInteractions(container: Element, hasRuntime: boolean) {
    let diagramPanels = container.querySelectorAll(".qp-diagram-panel");
    for (let i = 0; i < diagramPanels.length; i++) {
        initDiagramPanel(<HTMLElement>diagramPanels[i], hasRuntime);
    }
}

function initDiagramPanel(panel: HTMLElement, hasRuntime: boolean) {
    let canvas = <HTMLElement>panel.querySelector(".qp-diagram-canvas");
    if (canvas == null) return;

    let zoom = 1;
    const minZoom = 0.4;
    const maxZoom = 2.5;
    const zoomStep = 0.1;

    let toolbar = document.createElement("div");
    toolbar.className = "qp-diagram-toolbar";
    const planModeClass = hasRuntime ? "runtime" : "compile";
    const planModeText = hasRuntime ? "Runtime" : "Compile-time";
    toolbar.innerHTML = `
        <button type="button" class="qp-zoom-out" title="Zoom out">-</button>
        <button type="button" class="qp-zoom-in" title="Zoom in">+</button>
        <button type="button" class="qp-zoom-reset" title="Reset zoom">100%</button>
        <span class="qp-zoom-level">100%</span>
        <span class="qp-plan-mode ${planModeClass}" title="Plan mode">${planModeText}</span>
    `;
    panel.insertBefore(toolbar, panel.firstChild);

    let zoomLevel = <HTMLElement>toolbar.querySelector(".qp-zoom-level");
    let zoomOut = <HTMLButtonElement>toolbar.querySelector(".qp-zoom-out");
    let zoomIn = <HTMLButtonElement>toolbar.querySelector(".qp-zoom-in");
    let zoomReset = <HTMLButtonElement>toolbar.querySelector(".qp-zoom-reset");

    function applyZoom(nextZoom: number) {
        zoom = Math.max(minZoom, Math.min(maxZoom, nextZoom));
        canvas.style.transform = `scale(${zoom})`;
        zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
    }

    zoomOut.addEventListener("click", () => applyZoom(zoom - zoomStep));
    zoomIn.addEventListener("click", () => applyZoom(zoom + zoomStep));
    zoomReset.addEventListener("click", () => applyZoom(1));

    // Hold left mouse button and drag to pan the diagram.
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;

    panel.addEventListener("mousedown", (event: MouseEvent) => {
        if (event.button !== 0) return;
        if (isInToolbar(<HTMLElement>event.target, panel)) return;
        isDragging = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        startScrollLeft = panel.scrollLeft;
        startScrollTop = panel.scrollTop;
        panel.classList.add("qp-dragging");
        event.preventDefault();
    });

    window.addEventListener("mousemove", (event: MouseEvent) => {
        if (!isDragging) return;
        panel.scrollLeft = startScrollLeft - (event.clientX - dragStartX);
        panel.scrollTop = startScrollTop - (event.clientY - dragStartY);
    });

    window.addEventListener("mouseup", () => {
        if (!isDragging) return;
        isDragging = false;
        panel.classList.remove("qp-dragging");
    });
}

function isInToolbar(element: HTMLElement, panel: HTMLElement): boolean {
    let current: HTMLElement = element;
    while (current != null && current !== panel) {
        if (current.classList != null && current.classList.contains("qp-diagram-toolbar")) {
            return true;
        }
        current = current.parentElement;
    }
    return false;
}

function setDefaults(options: Options, defaults: Options) {
    let ret = {};
    for (let attr in defaults) {
        if (defaults.hasOwnProperty(attr)) {
            ret[attr] = defaults[attr];
        }
    }
    for (let attr in options) {
        if (options.hasOwnProperty(attr)) {
            ret[attr] = options[attr];
        }
    }
    return ret;
}

function bindQueryActions(container: Element, handlers: QueryActionHandlers) {
    container.addEventListener("click", function (event: Event) {
        let target = event.target as HTMLElement;
        if (target == null) return;

        let block = target.closest(".qp-statement-block") as HTMLElement;
        if (block == null) return;

        let showXmlBtn = target.closest(".qp-open-xml-viewer");
        if (showXmlBtn != null) {
            if (handlers.onShowPlanXml != null) handlers.onShowPlanXml({ block: block, queryText: getActiveQueryText(block) });
            return;
        }
        let expandBtn = target.closest(".qp-open-query-popup");
        if (expandBtn != null) {
            if (handlers.onOpenQueryPopup != null) handlers.onOpenQueryPopup({ block: block, queryText: getActiveQueryText(block) });
            return;
        }
        let copyXmlBtn = target.closest(".qp-copy-plan-xml");
        if (copyXmlBtn != null) {
            if (handlers.onCopyPlanXml != null) handlers.onCopyPlanXml({ block: block, queryText: getActiveQueryText(block) });
            return;
        }

        let beautifyBtn = target.closest(".qp-open-beautify");
        if (beautifyBtn != null) {
            if (handlers.onBeautify != null) handlers.onBeautify({ block: block, queryText: getActiveQueryText(block) });
            return;
        }

        let aiAssistBtn = target.closest(".qp-open-ai-assist");
        if (aiAssistBtn != null) {
            if (handlers.onAiAssist != null) handlers.onAiAssist({ block: block, queryText: getActiveQueryText(block) });
            return;
        }
    });
}

function getActiveQueryText(block: HTMLElement): string {
    let activePane = block.querySelector(".qp-query-pane.active");
    if (activePane != null) return getPaneText(activePane as HTMLElement);
    let realPane = block.querySelector(".qp-query-pane[data-pane='real']");
    if (realPane != null) return getPaneText(realPane as HTMLElement);
    return "";
}

function getPaneText(pane: HTMLElement): string {
    let el = pane.querySelector(".qp-real-query, .qp-resolved-query") as HTMLElement;
    if (el == null) return "";
    return getQueryElementText(el);
}

function getQueryElementText(el: HTMLElement): string {
    let copyNode = el.cloneNode(true) as HTMLElement;
    let actionsNode = copyNode.querySelector(".qp-query-actions");
    if (actionsNode != null && actionsNode.parentElement != null) actionsNode.parentElement.removeChild(actionsNode);
    return (copyNode.textContent || "").replace(/\s+$/g, "");
}

async function applyBeautifyToBlock(block: HTMLElement): Promise<string> {
    let pane = block.querySelector(".qp-query-pane.active") as HTMLElement;
    if (pane == null) pane = block.querySelector(".qp-query-pane[data-pane='real']") as HTMLElement;
    if (pane == null) return "";

    let el = pane.querySelector(".qp-real-query, .qp-resolved-query") as HTMLElement;
    if (el == null) return "";

    let raw = getQueryElementText(el);
    let formatted = await formatSqlWithApiFallback(raw);
    if (!formatted) return raw;

    let actions = el.querySelector(".qp-query-actions");
    if (actions && actions.parentElement === el) el.removeChild(actions);
    el.textContent = formatted;
    if (actions) el.appendChild(actions);
    return formatted;
}

function formatSqlWithApiFallback(sqlText: string): Promise<string> {
    let sql = String(sqlText || "");
    if (!sql.trim()) return Promise.resolve("");
    return formatSqlByApi(sql).catch(function () {
        return beautifySql(sql);
    });
}

function beautifySqlWithFallback(sqlText: string): Promise<string> {
    return formatSqlWithApiFallback(sqlText);
}

function formatSqlByApi(sqlText: string): Promise<string> {
    let body =
        "sql=" + encodeURIComponent(sqlText) +
        "&reindent=1" +
        "&indent_width=2";

    let requestPromise = fetch("https://sqlformat.org/api/v1/format", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body
    }).then(function (res) {
        if (!res.ok) throw new Error("sqlformat api status " + String(res.status));
        return res.json();
    }).then(function (data: any) {
        if (!data || typeof data.result !== "string") throw new Error("sqlformat api invalid response");
        return data.result;
    });

    let timeoutPromise = new Promise<string>(function (_resolve, reject) {
        window.setTimeout(function () { reject(new Error("sqlformat api timeout")); }, 3000);
    });

    return Promise.race([requestPromise, timeoutPromise]) as Promise<string>;
}

function beautifySql(sqlText: string): string {
    let raw = String(sqlText || "").trim();
    if (!raw) return "";

    let normalized = raw.replace(/\r\n/g, "\n").replace(/\s+/g, " ");
    let tokens = normalized
        .replace(/([(),])/g, " $1 ")
        .trim()
        .split(/\s+/)
        .filter(x => x.length > 0);

    let out: string[] = [];
    let indent = 0;
    let listIndent: number = -1;
    let parenCtx: string[] = [];
    const indentUnit = "  ";
    let line = "";

    function up(s: string): string { return String(s || "").toUpperCase(); }
    function ind(level: number): string {
        let n = Math.max(0, level);
        let parts: string[] = [];
        for (let i = 0; i < n; i++) parts.push(indentUnit);
        return parts.join("");
    }
    function pushLine(force?: boolean) {
        if (line.trim().length > 0 || force) out.push(line.trim().length ? line : "");
        line = "";
    }
    function ensurePrefix() {
        if (!line) line = ind(indent);
    }
    function addWord(word: string) {
        ensurePrefix();
        if (line !== ind(indent) && line.charAt(line.length - 1) !== " ") line += " ";
        line += word;
    }
    function inCompactContext(): boolean {
        if (!parenCtx.length) return false;
        let top = parenCtx[parenCtx.length - 1];
        return top === "in" || top === "iif";
    }
    function startKeywordLine(word: string, extraIndent?: number) {
        pushLine();
        let lev = indent + (extraIndent || 0);
        line = ind(lev) + word;
    }
    function startClause(word: string, isListClause?: boolean) {
        startKeywordLine(word);
        listIndent = isListClause ? indent + 1 : -1;
    }

    const clauseStarts: Record<string, boolean> = {
        "SELECT": true, "FROM": true, "WHERE": true, "GROUP BY": true, "HAVING": true, "ORDER BY": true,
        "INSERT INTO": true, "VALUES": true, "UPDATE": true, "DELETE": true, "SET": true,
        "UNION": true, "UNION ALL": true, "EXCEPT": true, "INTERSECT": true, "WITH": true
    };
    const joinStarts: Record<string, boolean> = {
        "JOIN": true, "LEFT JOIN": true, "RIGHT JOIN": true, "INNER JOIN": true, "FULL JOIN": true, "CROSS JOIN": true
    };

    let i = 0;
    while (i < tokens.length) {
        let tk = tokens[i];
        let cur = up(tk);
        let next = i + 1 < tokens.length ? up(tokens[i + 1]) : "";
        let pair = cur + (next ? " " + next : "");

        if (tk === ",") {
            addWord(",");
            if (inCompactContext()) {
                addWord("");
            } else {
                pushLine();
                if (listIndent >= 0) line = ind(listIndent);
            }
            i++;
            continue;
        }
        if (tk === "(") {
            let prev = i > 0 ? up(tokens[i - 1]) : "";
            if (prev === "IN") parenCtx.push("in");
            else if (prev === "IIF") parenCtx.push("iif");
            else if (next === "SELECT" || next === "WITH") parenCtx.push("block");
            else parenCtx.push("normal");
            addWord("(");
            if (next === "SELECT" || next === "WITH") {
                indent++;
                pushLine();
            }
            i++;
            continue;
        }
        if (tk === ")") {
            let ctx = parenCtx.length ? parenCtx.pop() : "normal";
            if (ctx === "block") {
                pushLine();
                indent = Math.max(0, indent - 1);
                line = ind(indent) + ")";
            } else {
                addWord(")");
            }
            i++;
            continue;
        }

        if (pair === "UNION ALL" || pair === "GROUP BY" || pair === "ORDER BY" ||
            pair === "INSERT INTO" || pair === "LEFT JOIN" || pair === "RIGHT JOIN" ||
            pair === "INNER JOIN" || pair === "FULL JOIN" || pair === "CROSS JOIN") {
            if (pair === "GROUP BY" || pair === "ORDER BY") {
                startClause(pair, true);
            } else if (clauseStarts[pair] || joinStarts[pair]) {
                startClause(pair, false);
            }
            else addWord(pair);
            i += 2;
            continue;
        }

        if (clauseStarts[cur]) {
            startClause(cur, cur === "SELECT" || cur === "SET" || cur === "VALUES");
            i++;
            continue;
        }
        if (joinStarts[cur]) {
            startClause(cur, false);
            i++;
            continue;
        }
        if (cur === "ON") {
            listIndent = -1;
            startKeywordLine("ON", 1);
            i++;
            continue;
        }
        if (cur === "AND" || cur === "OR") {
            if (inCompactContext()) addWord(cur);
            else startKeywordLine(cur, 1);
            i++;
            continue;
        }

        if (cur === "CASE") {
            startKeywordLine("CASE");
            indent++;
            listIndent = -1;
            i++;
            continue;
        }
        if (cur === "WHEN" || cur === "THEN" || cur === "ELSE") {
            startKeywordLine(cur);
            i++;
            continue;
        }
        if (cur === "END") {
            pushLine();
            indent = Math.max(0, indent - 1);
            line = ind(indent) + "END";
            i++;
            continue;
        }

        if (cur === "OVER") {
            startKeywordLine("OVER");
            listIndent = -1;
            i++;
            continue;
        }
        if (pair === "PARTITION BY") {
            startKeywordLine("PARTITION BY", 1);
            listIndent = indent + 2;
            i += 2;
            continue;
        }
        if (pair === "ROWS BETWEEN") {
            startKeywordLine("ROWS BETWEEN", 1);
            listIndent = -1;
            i += 2;
            continue;
        }

        addWord(tk);
        i++;
    }

    pushLine();
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export { drawLines as drawLines, showPlan, Node, buildXmlTreeHtml, bindQueryActions, getActiveQueryText, beautifySql, beautifySqlWithFallback, applyBeautifyToBlock }
