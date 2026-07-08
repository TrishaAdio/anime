// Measures real internet download/upload speed and ping using Cloudflare's
// public speed-test endpoints (https://speed.cloudflare.com).
//
// The test is run in the background and cached, so /health can return the
// latest result instantly without ever blocking on a live measurement.

const DOWN_URL = "https://speed.cloudflare.com/__down?bytes=";
const UP_URL = "https://speed.cloudflare.com/__up";
const DOWNLOAD_BYTES = 10_000_000; // 10 MB (inbound)
const UPLOAD_BYTES = 3_000_000; //   3 MB (outbound)
const STALE_MS = 15 * 60 * 1000; // refresh at most every 15 minutes

let cache = {
  provider: "Cloudflare",
  pingMs: null,
  downloadMbps: null,
  uploadMbps: null,
  testedAt: null,
  status: "pending"
};
let running = false;

const round = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100);
const mbps = (bytes, seconds) => (seconds > 0 ? (bytes * 8) / seconds / 1e6 : null);

async function measurePing() {
  const start = performance.now();
  const res = await fetch(`${DOWN_URL}0`, { signal: AbortSignal.timeout(10000) });
  await res.arrayBuffer();
  return performance.now() - start;
}

async function measureDownload() {
  const start = performance.now();
  const res = await fetch(`${DOWN_URL}${DOWNLOAD_BYTES}`, { signal: AbortSignal.timeout(30000) });
  const buf = await res.arrayBuffer();
  return mbps(buf.byteLength, (performance.now() - start) / 1000);
}

async function measureUpload() {
  const payload = Buffer.alloc(UPLOAD_BYTES);
  const start = performance.now();
  const res = await fetch(UP_URL, {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/octet-stream" },
    signal: AbortSignal.timeout(30000)
  });
  await res.arrayBuffer();
  return mbps(UPLOAD_BYTES, (performance.now() - start) / 1000);
}

export async function runSpeedTest() {
  if (running) return cache;
  running = true;
  try {
    const pingMs = await measurePing().catch(() => null);
    const downloadMbps = await measureDownload().catch(() => null);
    const uploadMbps = await measureUpload().catch(() => null);
    cache = {
      provider: "Cloudflare",
      pingMs: round(pingMs),
      downloadMbps: round(downloadMbps),
      uploadMbps: round(uploadMbps),
      testedAt: new Date().toISOString(),
      status: downloadMbps || uploadMbps ? "ok" : "failed"
    };
  } finally {
    running = false;
  }
  return cache;
}

export function getSpeed() {
  const ageSeconds = cache.testedAt
    ? Math.round((Date.now() - Date.parse(cache.testedAt)) / 1000)
    : null;
  return { ...cache, ageSeconds };
}

// Fire-and-forget refresh when the cached result is stale.
export function refreshIfStale() {
  const age = cache.testedAt ? Date.now() - Date.parse(cache.testedAt) : Infinity;
  if (age > STALE_MS && !running) runSpeedTest().catch(() => {});
}

// Kick off the first measurement at startup.
export function startSpeedMonitor() {
  runSpeedTest().catch(() => {});
}
