var globalLoadingCounter = 0;
var loadingElementId = "appLoadingOverlay";

function ensureLoadingOverlayElement(): HTMLElement {
  var existing = document.getElementById(loadingElementId);
  if (existing) return existing;

  var root = document.createElement("div");
  root.id = loadingElementId;
  root.className = "dashboard-loading hidden";
  root.innerHTML = "<div class='dashboard-loading-box'>Loading...</div>";
  document.body.appendChild(root);
  return root;
}

function setOverlayVisible(visible: boolean) {
  var el = ensureLoadingOverlayElement();
  if (visible) el.classList.remove("hidden");
  else el.classList.add("hidden");
}

export function beginGlobalLoading() {
  globalLoadingCounter++;
  setOverlayVisible(true);
}

export function endGlobalLoading() {
  globalLoadingCounter = Math.max(0, globalLoadingCounter - 1);
  if (globalLoadingCounter === 0) setOverlayVisible(false);
}

export async function withGlobalLoading<T>(fn: () => Promise<T>): Promise<T> {
  beginGlobalLoading();
  try {
    return await fn();
  } finally {
    endGlobalLoading();
  }
}

function setButtonLoadingState(btn: HTMLButtonElement, loading: boolean, loadingText?: string) {
  if (!btn) return;
  if (loading) {
    if (!btn.getAttribute("data-origin-text")) {
      btn.setAttribute("data-origin-text", btn.textContent || "");
    }
    btn.disabled = true;
    btn.textContent = loadingText || "Loading...";
    return;
  }
  var origin = btn.getAttribute("data-origin-text");
  if (origin !== null) btn.textContent = origin;
  btn.removeAttribute("data-origin-text");
  btn.disabled = false;
}

export async function withButtonLoading(btn: HTMLButtonElement, fn: () => Promise<void>, loadingText?: string) {
  setButtonLoadingState(btn, true, loadingText);
  try {
    await fn();
  } finally {
    setButtonLoadingState(btn, false);
  }
}

