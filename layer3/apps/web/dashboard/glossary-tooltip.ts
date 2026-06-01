import { GLOSSARY, GlossaryEntry } from "./glossary";

let currentTooltip: HTMLElement | null = null;

export function attachGlossaryTooltips(root: HTMLElement): void {
  const items = root.querySelectorAll<HTMLElement>("[data-glossary]");
  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const key = el.getAttribute("data-glossary") || "";
    const entry = GLOSSARY[key];
    if (!entry) continue;
    const old = el.querySelector(".gl-tip-btn");
    if (old) continue;
    const btn = document.createElement("button");
    btn.className = "gl-tip-btn";
    btn.type = "button";
    btn.textContent = "?";
    btn.setAttribute("aria-label", "Giải thích: " + entry.term);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showTooltip(btn, entry);
    });
    el.appendChild(btn);
  }
}

export function removeTooltip(): void {
  if (!currentTooltip) return;
  if (currentTooltip.parentElement) currentTooltip.parentElement.removeChild(currentTooltip);
  currentTooltip = null;
}

function showTooltip(anchor: HTMLElement, entry: GlossaryEntry): void {
  removeTooltip();
  const tip = document.createElement("div");
  tip.className = "gl-tooltip";
  tip.innerHTML = buildTooltipHtml(entry);
  document.body.appendChild(tip);
  positionTooltip(tip, anchor);
  currentTooltip = tip;
  document.addEventListener("click", removeTooltip, { once: true });
}

function positionTooltip(tip: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const top = Math.min(window.innerHeight - tip.offsetHeight - 8, r.bottom + 8);
  const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left));
  tip.style.top = String(top) + "px";
  tip.style.left = String(left) + "px";
}

function buildTooltipHtml(entry: GlossaryEntry): string {
  const threshold = entry.threshold ? "<div class='gl-tooltip-row'><span class='gl-tooltip-label'>Threshold</span><span class='gl-tooltip-val'>" + esc(entry.threshold) + "</span></div>" : "";
  const formula = entry.formula ? "<div class='gl-tooltip-formula'>" + esc(entry.formula) + "</div>" : "";
  return "<div class='gl-tooltip-term'>" + esc(entry.term) + "</div><div class='gl-tooltip-def'>" + esc(entry.definition) + "</div>" +
    threshold + "<div class='gl-tooltip-row'><span class='gl-tooltip-label'>Impact</span><span class='gl-tooltip-val'>" + esc(entry.impact) + "</span></div>" + formula;
}

function esc(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}
