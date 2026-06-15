const QP_VERSION = "20260615f";

export function getQpScriptUrl() {
  return `/dist/qp.js?v=${QP_VERSION}`;
}

export function getQpBundleKey() {
  return `current-modern-${QP_VERSION}`;
}

export function getQpStyleId() {
  return `qp-modern-icons-${QP_VERSION}`;
}
