interface ApiError extends Error {
  status?: number
  payload?: any
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const q: string[] = [];
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== "") q.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  });
  return q.length ? "?" + q.join("&") : "";
}

export async function apiGet(path: string, params?: Record<string, string | number | undefined>): Promise<any> {
  const res = await fetch(path + toQuery(params || {}));
  if (!res.ok) {
    const err: ApiError = new Error("API error");
    err.status = res.status;
    try { err.payload = await res.json(); } catch (_e) { }
    throw err;
  }
  return res.json();
}

export async function apiPost(path: string, payload: unknown): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) {
    const err: ApiError = new Error("API error");
    err.status = res.status;
    try { err.payload = await res.json(); } catch (_e) { }
    throw err;
  }
  return res.json();
}

export async function apiPost(path: string, payload: unknown): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) {
    const err: ApiError = new Error("API error");
    err.status = res.status;
    throw err;
  }
  return res.json();
}
