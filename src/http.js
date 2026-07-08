// Small fetch helpers with timeout + a browser-like User-Agent.

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export async function getText(url, { timeout = 12000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": DEFAULT_UA, ...headers }
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(url, opts = {}) {
  const { ok, status, body } = await getText(url, {
    ...opts,
    headers: { Accept: "application/json", ...(opts.headers || {}) }
  });
  if (!ok) {
    const err = new Error(`GET ${url} failed: ${status}`);
    err.status = status;
    throw err;
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`GET ${url} returned invalid JSON`);
  }
}

export async function postJSON(url, payload, { timeout = 12000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_UA,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = new Error(`POST ${url} failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
