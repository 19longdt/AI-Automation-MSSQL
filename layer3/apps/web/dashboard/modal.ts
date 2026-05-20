var modalStack: HTMLElement[] = [];
var modalEventsBound = false;
var baseZIndex = 3000;

function createModalElement(title: string, contentHtml: string): HTMLElement {
  var root = document.createElement("div");
  root.className = "modal";
  root.setAttribute("data-modal-layer", "1");

  var z = baseZIndex + modalStack.length * 20;
  root.style.zIndex = String(z);
  root.innerHTML =
    "<div class='modal-backdrop' data-close='1'></div>" +
    "<div class='modal-panel'>" +
      "<div class='modal-head'><strong class='modal-title'></strong><button class='modal-close-btn' type='button' data-close-modal='1' aria-label='Close dialog'>Close</button></div>" +
      "<div class='modal-body'></div>" +
    "</div>";

  var titleEl = root.querySelector(".modal-head strong");
  var bodyEl = root.querySelector(".modal-body");
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) (bodyEl as HTMLElement).innerHTML = contentHtml;
  return root;
}

export function openModal(title: string, contentHtml: string) {
  var modal = createModalElement(title, contentHtml);
  var normalizedTitle = String(title || "").toLowerCase();
  if (normalizedTitle.indexOf("execution plan") >= 0) {
    modal.classList.add("modal-execution-plan");
  }
  if (normalizedTitle.indexOf("finding metrics") >= 0 || normalizedTitle.indexOf("finding detail") >= 0) {
    modal.classList.add("modal-finding-detail");
  }
  document.body.appendChild(modal);
  modalStack.push(modal);
}

export function openActionConfirmModal(
  title: string,
  messageHtml: string,
  confirmText?: string,
  cancelText?: string
): Promise<boolean> {
  var okText = confirmText || "Confirm";
  var noText = cancelText || "Cancel";
  var content =
    "<div class='action-confirm'>" +
      "<div class='action-confirm-message'>" + messageHtml + "</div>" +
      "<div class='action-confirm-actions'>" +
        "<button type='button' class='btn-cancel' data-action-confirm='cancel'>" + noText + "</button>" +
        "<button type='button' class='btn-danger' data-action-confirm='ok'>" + okText + "</button>" +
      "</div>" +
    "</div>";
  var modal = createModalElement(title, content);
  document.body.appendChild(modal);
  modalStack.push(modal);

  return new Promise(function (resolve) {
    function done(result: boolean) {
      if (modal.parentElement) modal.parentElement.removeChild(modal);
      for (var i = modalStack.length - 1; i >= 0; i--) {
        if (modalStack[i] === modal) {
          modalStack.splice(i, 1);
          break;
        }
      }
      resolve(result);
    }

    var okBtn = modal.querySelector("[data-action-confirm='ok']") as HTMLButtonElement | null;
    var cancelBtn = modal.querySelector("[data-action-confirm='cancel']") as HTMLButtonElement | null;
    var backdrop = modal.querySelector("[data-close='1']") as HTMLElement | null;
    var closeBtn = modal.querySelector("[data-close-modal='1']") as HTMLElement | null;

    if (okBtn) okBtn.addEventListener("click", function () { done(true); });
    if (cancelBtn) cancelBtn.addEventListener("click", function () { done(false); });
    if (backdrop) backdrop.addEventListener("click", function () { done(false); });
    if (closeBtn) closeBtn.addEventListener("click", function () { done(false); });
  });
}

export function closeModal() {
  var top = modalStack.pop();
  if (!top) return;
  if (top.parentElement) top.parentElement.removeChild(top);
}

export function bindModalEvents() {
  if (modalEventsBound) return;
  modalEventsBound = true;

  // Hide legacy single-modal node if it exists; new stack modals are created dynamically.
  var legacy = document.getElementById("modal");
  if (legacy) legacy.classList.add("hidden");

  document.addEventListener("click", function (e) {
    var t = e.target as HTMLElement;
    if (!t) return;
    if (t.getAttribute("data-close-modal") === "1" || t.getAttribute("data-close") === "1") {
      closeModal();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });
}
