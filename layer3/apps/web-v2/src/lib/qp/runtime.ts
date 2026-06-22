import { getQpBundleKey, getQpScriptUrl, getQpStyleId } from "./assets";
import { getBundledQpStylesheetText } from "./styles";
import "./types";

let runtimePromise: Promise<void> | null = null;

export function ensureQpRuntime(): Promise<void> {
  if (window.QP?.__bundle === getQpBundleKey()) return Promise.resolve();
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    ensureQpStyles();
    await ensureQpScript();
  })();

  return runtimePromise;
}

function ensureQpStyles() {
  const styleId = getQpStyleId();
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = getBundledQpStylesheetText();
  document.head.appendChild(style);
}

function ensureQpScript() {
  const scriptUrl = getQpScriptUrl();
  const bundleKey = getQpBundleKey();

  if (window.QP?.__bundle === bundleKey) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
    if (existing) {
      if (window.QP?.__bundle === bundleKey) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        if (window.QP) window.QP.__bundle = bundleKey;
        resolve();
      }, { once: true });
      existing.addEventListener("error", () => reject(new Error("qp.js load failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.onload = () => {
      if (window.QP) window.QP.__bundle = bundleKey;
      resolve();
    };
    script.onerror = () => {
      runtimePromise = null;
      reject(new Error("qp.js load failed"));
    };
    document.head.appendChild(script);
  });
}
