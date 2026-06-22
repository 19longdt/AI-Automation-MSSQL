/// <reference types="vite/client" />

import qpModernIconsCss from "../../../../../css/qp-modern-icons.css?raw";
import { qpBundledIconUrls } from "./asset-manifest";

const operatorIconMap = new Map<string, string>();
const operatorIconPattern = /\.qp-icon-([A-Za-z0-9_]+)\s*\{\s*background-image:\s*url\((['"]?)([^'")]+)\2\)/g;

let operatorMatch: RegExpExecArray | null;
while ((operatorMatch = operatorIconPattern.exec(qpModernIconsCss)) !== null) {
  const iconName = operatorMatch[1];
  const iconFile = operatorMatch[3].split("/").pop() ?? "";
  const bundledUrl = qpBundledIconUrls.get(iconFile);
  if (bundledUrl) {
    operatorIconMap.set(iconName, bundledUrl);
  }
}

export async function applyOperatorIcons(root: HTMLElement) {
  if (!operatorIconMap.size) return;

  const iconNodes = root.querySelectorAll<HTMLElement>("[class^='qp-icon-'], [class*=' qp-icon-']");
  iconNodes.forEach(node => {
    const iconClass = Array.from(node.classList).find(cls => cls.startsWith("qp-icon-"));
    if (!iconClass) return;

    const iconName = iconClass.slice("qp-icon-".length);
    const iconUrl = operatorIconMap.get(iconName);
    if (!iconUrl) return;

    node.style.setProperty("background-image", `url("${iconUrl}")`, "important");
    node.style.setProperty("background-position", "center center", "important");
    node.style.setProperty("background-repeat", "no-repeat", "important");
    node.style.setProperty("background-size", "20px 20px", "important");
    node.style.setProperty("display", "block", "important");
    node.style.setProperty("width", "32px", "important");
    node.style.setProperty("height", "32px", "important");
  });
}
