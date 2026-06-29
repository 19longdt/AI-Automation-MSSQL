export async function fetchJsonWithTimeout(url: string, timeoutMs = 3000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const contentType = res.headers.get("content-type") || "";
    let payload: any = null;
    if (contentType.indexOf("application/json") >= 0) {
      payload = await res.json();
    } else {
      const text = await res.text();
      payload = text ? { message: text } : null;
    }
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function postJsonWithTimeout(url: string, body: unknown, timeoutMs = 5000): Promise<unknown> {
  return postJsonWithTimeoutAndHeaders(url, body, timeoutMs);
}

export async function putJsonWithTimeout(url: string, body: unknown, timeoutMs = 5000): Promise<unknown> {
  return sendJsonWithMethod(url, "PUT", body, timeoutMs);
}

export async function deleteJsonWithTimeout(url: string, timeoutMs = 5000): Promise<unknown> {
  return sendJsonWithMethod(url, "DELETE", undefined, timeoutMs);
}

export async function postJsonWithTimeoutAndHeaders(
  url: string,
  body: unknown,
  timeoutMs = 5000,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await sendJsonWithMethod(url, "POST", body, timeoutMs, ctrl, timer, extraHeaders);
  } finally {
    clearTimeout(timer);
  }
}

async function sendJsonWithMethod(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
  timeoutMs = 5000,
  ctrlArg?: AbortController,
  _timerArg?: ReturnType<typeof setTimeout>,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  const ctrl = ctrlArg ?? new AbortController();
  const timer = ctrlArg ? null : setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    const contentType = res.headers.get("content-type") || "";
    let payload: any = null;
    if (contentType.indexOf("application/json") >= 0) {
      payload = await res.json();
    } else {
      const text = await res.text();
      payload = text ? { message: text } : null;
    }
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
