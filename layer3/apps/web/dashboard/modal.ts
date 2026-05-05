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
