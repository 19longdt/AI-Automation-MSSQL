function buildXmlTreeHtml(xmlText: string): string {
    try {
        let doc = new DOMParser().parseFromString(xmlText, "application/xml");
        if (doc.getElementsByTagName("parsererror").length > 0 || doc.documentElement == null) {
            return "<div class=\"xml-text\">Cannot parse XML.</div>";
        }
        return `<div class="xml-tree">${xmlNodeToTreeHtml(doc.documentElement)}</div>`;
    } catch (_e) {
        return "<div class=\"xml-text\">Cannot parse XML.</div>";
    }
}

function xmlNodeToTreeHtml(node: Element): string {
    let attrs = "";
    if (node.attributes != null && node.attributes.length > 0) {
        for (let i = 0; i < node.attributes.length; i++) {
            let a = node.attributes[i];
            attrs += ` <span class="xml-attr">${escapeHtml(a.name)}="${escapeHtml(a.value)}"</span>`;
        }
    }

    let children: Element[] = [];
    let textParts: string[] = [];
    for (let i = 0; i < node.childNodes.length; i++) {
        let child = node.childNodes[i];
        if (child.nodeType === 1) children.push(<Element>child);
        if (child.nodeType === 3) {
            let t = String(child.nodeValue || "").trim();
            if (t) textParts.push(t);
        }
    }

    let textHtml = textParts.length ? `<div class="xml-text">${escapeHtml(textParts.join(" "))}</div>` : "";
    if (!children.length && !textParts.length) {
        return `<div><span class="xml-tag">&lt;${escapeHtml(node.nodeName)}${attrs} /&gt;</span></div>`;
    }

    let inner = textHtml;
    for (let j = 0; j < children.length; j++) inner += xmlNodeToTreeHtml(children[j]);
    return `<details><summary><span class="xml-tag">&lt;${escapeHtml(node.nodeName)}${attrs}&gt;</span></summary>${inner}<div><span class="xml-tag">&lt;/${escapeHtml(node.nodeName)}&gt;</span></div></details>`;
}

function escapeHtml(text: string): string {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export { buildXmlTreeHtml }
