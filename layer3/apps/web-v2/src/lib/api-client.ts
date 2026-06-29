export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload, `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

// `object` accepts any interface/type without requiring an index signature.
// Internally cast to iterate entries safely.
export function apiGet<T>(url: string, params?: object): Promise<T> {
  if (!params) return apiFetch<T>(url);
  const entries = Object.entries(params as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)]);
  const qs = new URLSearchParams(entries).toString();
  return apiFetch<T>(qs ? `${url}?${qs}` : url);
}

export function apiPost<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: "POST", body: JSON.stringify(body) });
}

export function apiPut<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: "PUT", body: JSON.stringify(body) });
}

export function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: "PATCH", body: JSON.stringify(body) });
}

export function apiDelete<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: "DELETE" });
}
