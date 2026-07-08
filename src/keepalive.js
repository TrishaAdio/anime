// Keeps a Render free web service awake.
//
// Render free instances spin down after ~15 minutes with no inbound traffic.
// We self-ping the public URL a little more often than that, which creates
// inbound traffic and prevents the service from sleeping. The service will
// then stay up continuously (subject to the free tier's monthly hour limit).
//
// Render injects RENDER_EXTERNAL_URL automatically. Locally it is unset, so
// keep-alive is a no-op there.

export function startKeepAlive() {
  const base = process.env.RENDER_EXTERNAL_URL;
  if (!base) {
    console.log("[keepalive] no RENDER_EXTERNAL_URL; keep-alive disabled (local run).");
    return;
  }
  const minutes = Number(process.env.KEEPALIVE_MINUTES) || 12;
  const intervalMs = Math.max(1, minutes) * 60 * 1000;
  const target = `${base.replace(/\/$/, "")}/health`;

  const ping = async () => {
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(10000) });
      console.log(`[keepalive] ping ${target} -> ${res.status}`);
    } catch (err) {
      console.log(`[keepalive] ping failed: ${err.message}`);
    }
  };

  const timer = setInterval(ping, intervalMs);
  if (timer.unref) timer.unref();
  console.log(`[keepalive] enabled, pinging ${target} every ${minutes} min.`);
}
