import "./types";
import { bindQpActions } from "./actions";
import { applyOperatorIcons } from "./icons";
import { ensureQpRuntime } from "./runtime";

function clearExistingConnectorSvgs(el: HTMLElement) {
  const canvases = el.querySelectorAll<HTMLElement>(".qp-diagram-canvas");
  canvases.forEach(canvas => {
    canvas.querySelectorAll("svg").forEach(svg => svg.remove());
  });
}

export function drawLines(el: HTMLElement) {
  if (typeof window.QP?.drawLines !== "function") return;
  clearExistingConnectorSvgs(el);
  window.QP.drawLines(el);
}

export function applyHeatColoring(el: HTMLElement) {
  const nodes = el.querySelectorAll<HTMLElement>(".qp-node[data-elapsed-ms]");
  let max = 0;
  nodes.forEach(node => {
    const ms = parseInt(node.getAttribute("data-elapsed-ms") ?? "0", 10) || 0;
    if (ms > max) max = ms;
  });
  if (!max) return;

  nodes.forEach(node => {
    const ms = parseInt(node.getAttribute("data-elapsed-ms") ?? "0", 10) || 0;
    const pct = ms / max;
    node.setAttribute("data-heat", pct >= 0.75 ? "critical" : pct >= 0.4 ? "high" : pct >= 0.15 ? "medium" : "low");
  });
}

export async function renderQueryPlan(container: HTMLElement, xml: string) {
  await ensureQpRuntime();

  if (!window.QP) {
    throw new Error("Failed to load diagram library");
  }

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Invalid XML parse error. Please check the plan XML.");
  }

  container.innerHTML = "";
  window.QP.showPlan(container, xml);
  await applyOperatorIcons(container);
  await new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        drawLines(container);
        resolve();
      });
    });
  });
  applyHeatColoring(container);
  bindQpActions(container, xml);
}
