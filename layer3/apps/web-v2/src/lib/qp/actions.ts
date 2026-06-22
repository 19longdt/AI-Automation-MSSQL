import "./types";

const OVERLAY_BACKDROP_CSS =
  "position:fixed;inset:0;z-index:200000;background:var(--color-overlay);" +
  "display:flex;align-items:center;justify-content:center;padding:16px;pointer-events:auto";

const OVERLAY_MODAL_CSS =
  "display:flex;flex-direction:column;background:var(--color-surface-2);" +
  "border:1px solid var(--color-border-2);border-radius:16px;" +
  "width:min(95vw,940px);max-height:88vh;overflow:hidden;color:var(--color-text);" +
  "box-shadow:0 24px 64px var(--color-shadow-lg);pointer-events:auto";

const OVERLAY_HEADER_CSS =
  "display:flex;align-items:center;justify-content:space-between;" +
  "padding:12px 16px;border-bottom:1px solid var(--color-border);flex-shrink:0;" +
  "background:var(--color-surface)";

const OVERLAY_TITLE_CSS =
  "font-size:13px;font-weight:600;color:var(--color-text);letter-spacing:.01em";

const OVERLAY_CLOSE_BTN_CSS =
  "background:var(--color-surface-2);border:1px solid var(--color-border);" +
  "font-size:14px;cursor:pointer;color:var(--color-muted);padding:4px 10px;" +
  "border-radius:8px;line-height:1;transition:background .12s,color .12s;" +
  "display:flex;align-items:center;justify-content:center";

const OVERLAY_BODY_CSS = "flex:1;overflow:auto;padding:16px;min-height:0";

const OVERLAY_ACTION_BTN_CSS =
  "background:var(--color-surface-2);border:1px solid var(--color-border-2);" +
  "padding:4px 12px;border-radius:8px;font-size:12px;cursor:pointer;" +
  "color:var(--color-text-2);font-family:system-ui,sans-serif;transition:background .12s,color .12s";

const OVERLAY_PRE_CSS =
  "font-family:var(--font-code);font-size:12px;white-space:pre-wrap;" +
  "word-break:break-word;margin:0;line-height:1.6;color:var(--color-text);" +
  "background:var(--color-surface);padding:12px;border-radius:10px;border:1px solid var(--color-border)";

const QP_OVERLAY_ATTR = "data-qp-overlay";

function createQpOverlay(title: string, bodyContent: HTMLElement) {
  document.querySelectorAll<HTMLElement>(`[${QP_OVERLAY_ATTR}="true"]`).forEach(existing => existing.remove());

  const backdrop = document.createElement("div");
  backdrop.setAttribute(QP_OVERLAY_ATTR, "true");
  backdrop.style.cssText = OVERLAY_BACKDROP_CSS;

  const modal = document.createElement("div");
  modal.style.cssText = OVERLAY_MODAL_CSS;

  const header = document.createElement("div");
  header.style.cssText = OVERLAY_HEADER_CSS;

  const titleEl = document.createElement("span");
  titleEl.style.cssText = OVERLAY_TITLE_CSS;
  titleEl.textContent = title;

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.style.cssText = OVERLAY_CLOSE_BTN_CSS;
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = "var(--color-surface-3)";
    closeBtn.style.color = "var(--color-text)";
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = "var(--color-surface-2)";
    closeBtn.style.color = "var(--color-muted)";
  };

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.style.cssText = OVERLAY_BODY_CSS;
  body.appendChild(bodyContent);

  modal.appendChild(header);
  modal.appendChild(body);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const keyHandlerRef = { fn: (_e: KeyboardEvent) => {} };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener("keydown", keyHandlerRef.fn, true);
  };

  const stopBubble = (e: Event) => {
    e.stopPropagation();
  };
  modal.addEventListener("pointerdown", stopBubble);
  modal.addEventListener("mousedown", stopBubble);
  modal.addEventListener("click", stopBubble);

  const handleClosePointerDown = (e: Event) => {
    e.stopPropagation();
    if ("preventDefault" in e) e.preventDefault();
  };
  const handleCloseClick = (e: Event) => {
    handleClosePointerDown(e);
    window.setTimeout(close, 0);
  };
  closeBtn.addEventListener("pointerdown", handleClosePointerDown);
  closeBtn.addEventListener("mousedown", handleClosePointerDown);
  closeBtn.addEventListener("click", handleCloseClick);

  backdrop.addEventListener("pointerdown", e => {
    e.stopPropagation();
    if (e.target === backdrop) {
      handleClosePointerDown(e);
    }
  });
  backdrop.addEventListener("mousedown", e => {
    e.stopPropagation();
    if (e.target === backdrop) {
      handleClosePointerDown(e);
    }
  });
  backdrop.addEventListener("click", e => {
    e.stopPropagation();
    if (e.target === backdrop) {
      handleClosePointerDown(e);
      window.setTimeout(close, 0);
    }
  });

  keyHandlerRef.fn = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", keyHandlerRef.fn, true);
}

function prettyPrintXml(raw: string) {
  try {
    const doc = new DOMParser().parseFromString(raw, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return raw;
    const flat = new XMLSerializer().serializeToString(doc);
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
      copyBtn.style.cssText = `${OVERLAY_ACTION_BTN_CSS};margin-bottom:10px;display:block`;
      copyBtn.addEventListener("pointerdown", e => e.stopPropagation());
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = "Copied";
          setTimeout(() => { copyBtn.textContent = "Copy SQL"; }, 1800);
        });
      });

      const pre = document.createElement("pre");
      pre.style.cssText = OVERLAY_PRE_CSS;
      pre.textContent = text;
      wrap.appendChild(copyBtn);
      wrap.appendChild(pre);
      createQpOverlay("Query Text", wrap);
    },

    onShowPlanXml() {
      if (!xml) return;

      const wrap = document.createElement("div");
      const toolbar = document.createElement("div");
      toolbar.style.cssText = "display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy XML";
      copyBtn.style.cssText = OVERLAY_ACTION_BTN_CSS;
      copyBtn.onmouseenter = () => {
        copyBtn.style.background = "var(--color-surface-3)";
        copyBtn.style.color = "var(--color-text)";
      };
      copyBtn.onmouseleave = () => {
        copyBtn.style.background = "var(--color-surface-2)";
        copyBtn.style.color = "var(--color-text-2)";
      };
      copyBtn.addEventListener("pointerdown", e => e.stopPropagation());
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(xml).then(() => {
          copyBtn.textContent = "Copied";
          setTimeout(() => { copyBtn.textContent = "Copy XML"; }, 1800);
        });
      });
      toolbar.appendChild(copyBtn);

      const content = document.createElement("div");
      if (typeof window.QP?.buildXmlTreeHtml === "function") {
        content.innerHTML = window.QP.buildXmlTreeHtml(xml);
      } else {
        const pre = document.createElement("pre");
        pre.style.cssText =
          "font-family:var(--font-code);font-size:11px;line-height:1.6;" +
          "white-space:pre-wrap;word-break:break-all;margin:0;color:var(--color-text);" +
          "background:var(--color-surface);padding:12px;border-radius:10px;border:1px solid var(--color-border)";
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
        const toast = document.createElement("div");
        toast.textContent = "Plan XML copied to clipboard";
        toast.style.cssText =
          "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
          "z-index:9999;background:var(--color-surface);color:var(--color-text);padding:8px 16px;" +
          "border:1px solid var(--color-border);border-radius:10px;font-size:13px;font-family:system-ui,sans-serif;" +
          "box-shadow:0 4px 12px var(--color-shadow-lg);pointer-events:none";
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
