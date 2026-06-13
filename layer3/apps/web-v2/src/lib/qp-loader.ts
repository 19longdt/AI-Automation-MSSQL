/**
 * QP diagram library loader.
 *
 * qp.css uses relative url('qp_icons.png'). When injected via JS <link>,
 * some environments resolve it relative to the document URL instead of the
 * CSS file URL. To be safe we fetch the CSS text, patch to absolute path,
 * then inject as a <style> tag — this guarantees icon resolution.
 */

declare global {
  interface Window {
    QP?: {
      showPlan(el: HTMLElement, xml: string): void;
      drawLines(el: HTMLElement): void;
      bindQueryActions(el: HTMLElement, cbs: {
        onOpenQueryPopup?(ctx: { queryText?: string }): void;
        onShowPlanXml?(): void;
        onCopyPlanXml?(): void;
        onBeautify?(ctx: { block?: HTMLElement }): void;
      }): void;
      buildXmlTreeHtml?(xml: string): string;
      beautifySqlWithFallback?(sql: string): Promise<string>;
      applyBeautifyToBlock?(block: HTMLElement): void;
    };
  }
}

let _promise: Promise<void> | null = null;

export function ensureQp(): Promise<void> {
  if (window.QP) return Promise.resolve();
  if (_promise) return _promise;

  _promise = (async () => {
    // 1. Fetch qp.css, patch icon URLs, inject as <style>
    //
    // qp.css has two icon systems that conflict:
    //   A) Old sprite: `.qp-icon-X { background: url('qp_icons.png') -Xpx -Ypx }` (lines 282-697)
    //   B) New individual PNGs at ../assets/ssms-icons-ver17/ (lines 926-1326)
    //      — these files do NOT exist on disk, AND a high-specificity rule
    //        `.qp-root div[class|='qp-icon'] { background-position: center center }`
    //        overrides the sprite offsets, breaking the sprite system too.
    //
    // Fix: patch sprite URL, rewrite the problematic container rule, remove missing-PNG refs.
    if (!document.getElementById("qp-css-patched")) {
      try {
        const res = await fetch("/css/qp.css");
        const raw = await res.text();
        const patched = raw
          // 1a. Patch sprite sheet URL → absolute path
          .replace(/url\(\s*['"]?qp_icons\.png['"]?\s*\)/g, "url('/css/qp_icons.png')")
          // 1b. Rewrite the high-specificity container rule — ONLY keep no-repeat.
          //     Must NOT set background-size: the sprite is used at native dimensions;
          //     scaling it (e.g. 20px or 28px) makes the offset -Xpx -Ypx point
          //     outside the tiny scaled image → icons invisible.
          .replace(
            /\.qp-root\s+div\[class\|='qp-icon'\]\s*\{[\s\S]*?\}/,
            ".qp-root div[class|='qp-icon'] { background-repeat: no-repeat; }"
          )
          // 1c. Remove individual ssms-icons-ver17 refs (files don't exist → would 404
          //     and override the sprite background-image for each operator)
          .replace(/background-image\s*:\s*url\s*\(\s*['"]?\.\.\/assets\/[^'")\s]+['"]?\s*\)/g, "/* icon-removed */");
        const style = document.createElement("style");
        style.id = "qp-css-patched";
        style.textContent = patched;
        document.head.appendChild(style);
      } catch {
        // Fallback: inject link tag and hope browser resolves path correctly
        if (!document.querySelector('link[href="/css/qp.css"]')) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = "/css/qp.css";
          document.head.appendChild(link);
        }
      }
    }

    // 2. Load qp.js
    if (!window.QP) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector('script[src="/dist/qp.js"]');
        if (existing) {
          // Script tag exists — might still be loading
          if (window.QP) { resolve(); return; }
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("qp.js load failed")));
          return;
        }
        const s = document.createElement("script");
        s.src = "/dist/qp.js";
        s.onload = () => resolve();
        s.onerror = () => { _promise = null; reject(new Error("qp.js load failed")); };
        document.head.appendChild(s);
      });
    }
  })();

  return _promise;
}

function clearExistingConnectorSvgs(el: HTMLElement) {
  const canvases = el.querySelectorAll<HTMLElement>(".qp-diagram-canvas");
  canvases.forEach(canvas => {
    canvas.querySelectorAll("svg").forEach(svg => svg.remove());
  });
}

/**
 * Draw SVG connector lines between operator nodes.
 * Must be called after layout settles. We clear old connector SVGs first
 * because `QP.showPlan()` already draws once synchronously.
 */
export function drawLines(el: HTMLElement) {
  if (typeof window.QP?.drawLines === "function") {
    clearExistingConnectorSvgs(el);
    window.QP.drawLines(el);
  }
}

export function applyHeatColoring(el: HTMLElement) {
  const nodes = el.querySelectorAll<HTMLElement>(".qp-node[data-elapsed-ms]");
  let max = 0;
  nodes.forEach(n => {
    const ms = parseInt(n.getAttribute("data-elapsed-ms") ?? "0") || 0;
    if (ms > max) max = ms;
  });
  if (!max) return;
  nodes.forEach(n => {
    const pct = (parseInt(n.getAttribute("data-elapsed-ms") ?? "0") || 0) / max;
    n.setAttribute("data-heat", pct >= 0.75 ? "critical" : pct >= 0.4 ? "high" : pct >= 0.15 ? "medium" : "low");
  });
}

/**
 * Create a vanilla-DOM overlay modal on top of everything (incl. Radix Dialog).
 *
 * Critical: Radix Dialog uses document-level capture-phase listeners to detect
 * outside-clicks. We must stopPropagation on pointerdown/mousedown events from
 * inside the modal so Radix doesn't close the underlying dialog when the user
 * clicks our close button.
 */
function createQpOverlay(title: string, bodyContent: HTMLElement): void {
  const backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,.6);" +
    "display:flex;align-items:center;justify-content:center;padding:16px";

  const modal = document.createElement("div");
  modal.style.cssText =
    "display:flex;flex-direction:column;background:#fff;border-radius:12px;" +
    "width:min(95vw,940px);max-height:88vh;overflow:hidden;color:#0f172a;" +
    "box-shadow:0 24px 64px rgba(0,0,0,.4)";

  // Block Radix capture-phase outside-click detection on ALL pointer events
  // inside the modal. Without this, clicking anywhere in our overlay triggers
  // Radix's onPointerDownOutside and closes the underlying Dialog.
  modal.addEventListener("pointerdown", e => e.stopPropagation(), true);
  modal.addEventListener("mousedown",   e => e.stopPropagation(), true);
  modal.addEventListener("click",       e => e.stopPropagation(), true);

  // Sticky header — always visible, never scrolls away
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;" +
    "padding:12px 16px;border-bottom:1px solid #e2e8f0;flex-shrink:0;" +
    "background:#f8fafc;border-radius:12px 12px 0 0";

  const titleEl = document.createElement("span");
  titleEl.style.cssText = "font-size:13px;font-weight:600;color:#0f172a;letter-spacing:.01em";
  titleEl.textContent = title;

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&#x2715;"; // ✕
  closeBtn.style.cssText =
    "background:#f1f5f9;border:1px solid #e2e8f0;font-size:14px;cursor:pointer;" +
    "color:#475569;padding:4px 10px;border-radius:6px;line-height:1;" +
    "transition:background .12s;display:flex;align-items:center;justify-content:center";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.onmouseenter = () => { closeBtn.style.background = "#e2e8f0"; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = "#f1f5f9"; };

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // Scrollable body
  const body = document.createElement("div");
  body.style.cssText = "flex:1;overflow:auto;padding:16px;min-height:0";
  body.appendChild(bodyContent);

  modal.appendChild(header);
  modal.appendChild(body);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const keyHandlerRef = { fn: (_e: KeyboardEvent) => {} };

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", keyHandlerRef.fn, true);
  };

  // Close on close button (pointerdown fires before Radix's handler)
  closeBtn.addEventListener("pointerdown", e => {
    e.stopPropagation(); // prevent Radix from seeing this
    close();
  });

  // Close on backdrop click (outside modal box)
  backdrop.addEventListener("pointerdown", e => {
    if (e.target === backdrop) close();
    // Don't stopPropagation here — let Radix also close the dialog if user
    // clicked the very outer backdrop (outside-all is an intentional dismiss)
  });

  // Escape key — capture phase, stop propagation so Radix doesn't also close
  keyHandlerRef.fn = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", keyHandlerRef.fn, true);
}

/** Basic XML pretty-printer — indent nested elements */
function prettyPrintXml(raw: string): string {
  try {
    const doc = new DOMParser().parseFromString(raw, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return raw;
    const xs = new XMLSerializer();
    // Re-serialize to normalize, then indent manually
    const flat = xs.serializeToString(doc);
    let indent = 0;
    return flat
      .replace(/>\s*</g, ">\n<")
      .split("\n")
      .map(line => {
        const trimmed = line.trim();
        if (!trimmed) return "";
        if (trimmed.startsWith("</")) indent = Math.max(0, indent - 1);
        const out = "  ".repeat(indent) + trimmed;
        if (!trimmed.startsWith("</") && !trimmed.endsWith("/>") && !trimmed.startsWith("<?")) {
          if (/<[^/][^>]*[^/]>$/.test(trimmed)) indent++;
        }
        return out;
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return raw;
  }
}

export function bindQpActions(container: HTMLElement, xml?: string) {
  if (typeof window.QP?.bindQueryActions !== "function") return;
  window.QP.bindQueryActions(container, {
    onOpenQueryPopup(ctx) {
      const text = (ctx?.queryText ?? "").trim();
      if (!text) return;
      const wrap = document.createElement("div");

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy SQL";
      copyBtn.style.cssText =
        "background:#f1f5f9;border:1px solid #e2e8f0;padding:4px 12px;" +
        "border-radius:6px;font-size:12px;cursor:pointer;color:#475569;" +
        "font-family:system-ui,sans-serif;margin-bottom:10px;display:block";
      copyBtn.addEventListener("pointerdown", e => e.stopPropagation());
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = "✓ Copied";
          setTimeout(() => { copyBtn.textContent = "Copy SQL"; }, 1800);
        });
      });

      const pre = document.createElement("pre");
      pre.style.cssText =
        "font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap;" +
        "word-break:break-word;margin:0;line-height:1.6;color:#0f172a;" +
        "background:#f8fafc;padding:12px;border-radius:6px;border:1px solid #e2e8f0";
      pre.textContent = text;

      wrap.appendChild(copyBtn);
      wrap.appendChild(pre);
      createQpOverlay("Query Text", wrap);
    },

    onShowPlanXml() {
      if (!xml) return;
      const wrap = document.createElement("div");

      // ── Toolbar: Copy + raw/tree toggle ─────────────────────────
      const toolbar = document.createElement("div");
      toolbar.style.cssText =
        "display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center";

      const makeTbBtn = (label: string) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.cssText =
          "background:#f1f5f9;border:1px solid #e2e8f0;padding:4px 12px;" +
          "border-radius:6px;font-size:12px;cursor:pointer;color:#475569;" +
          "font-family:system-ui,sans-serif;transition:background .12s";
        b.onmouseenter = () => { b.style.background = "#e2e8f0"; };
        b.onmouseleave = () => { b.style.background = "#f1f5f9"; };
        return b;
      };

      const copyBtn = makeTbBtn("Copy XML");
      copyBtn.addEventListener("pointerdown", e => e.stopPropagation());
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(xml!).then(() => {
          copyBtn.textContent = "✓ Copied";
          setTimeout(() => { copyBtn.textContent = "Copy XML"; }, 1800);
        });
      });

      toolbar.appendChild(copyBtn);

      // ── Content area ─────────────────────────────────────────────
      const content = document.createElement("div");

      // Try QP's own tree renderer first (has expand/collapse if qp.js handles
      // it via document-level delegation); fallback to pretty-printed raw XML
      if (typeof window.QP?.buildXmlTreeHtml === "function") {
        content.innerHTML = window.QP.buildXmlTreeHtml(xml);
        // Attach delegated expand/collapse handler for common toggle patterns
        content.addEventListener("click", e => {
          const t = e.target as HTMLElement;
          // qp.js XML tree usually toggles on elements with data-toggle or
          // a ▶/▼ text node — handle the generic case
          const toggleEl = t.closest<HTMLElement>("[data-toggle],[class*='toggle'],[class*='collapse'],[class*='expand']");
          if (toggleEl) {
            const parent = toggleEl.parentElement;
            if (!parent) return;
            const children = parent.querySelectorAll<HTMLElement>(":scope > *:not(:first-child)");
            const isCollapsed = toggleEl.getAttribute("data-collapsed") === "1";
            children.forEach(c => { c.style.display = isCollapsed ? "" : "none"; });
            toggleEl.setAttribute("data-collapsed", isCollapsed ? "0" : "1");
            toggleEl.textContent = isCollapsed
              ? (toggleEl.textContent ?? "").replace("▶", "▼")
              : (toggleEl.textContent ?? "").replace("▼", "▶");
          }
        });
      } else {
        // Fallback: pretty-printed raw XML
        const pre = document.createElement("pre");
        pre.style.cssText =
          "font-family:Consolas,monospace;font-size:11px;line-height:1.6;" +
          "white-space:pre-wrap;word-break:break-all;margin:0;color:#0f172a;" +
          "background:#f8fafc;padding:12px;border-radius:6px;border:1px solid #e2e8f0";
        pre.textContent = prettyPrintXml(xml);
        content.appendChild(pre);
      }

      wrap.appendChild(toolbar);
      wrap.appendChild(content);
      createQpOverlay("Plan XML", wrap);
    },

    onCopyPlanXml() {
      if (!xml) return;
      navigator.clipboard.writeText(xml).then(() => {
        // Brief toast-like indicator — no dependency on React/sonner
        const toast = document.createElement("div");
        toast.textContent = "Plan XML copied to clipboard";
        toast.style.cssText =
          "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
          "z-index:9999;background:#1e293b;color:#f8fafc;padding:8px 16px;" +
          "border-radius:8px;font-size:13px;font-family:system-ui,sans-serif;" +
          "box-shadow:0 4px 12px rgba(0,0,0,.3);pointer-events:none";
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
      });
    },

    onBeautify(ctx) {
      if (!ctx?.block || typeof window.QP?.applyBeautifyToBlock !== "function") return;
      window.QP.applyBeautifyToBlock(ctx.block);
    },
  });
}
