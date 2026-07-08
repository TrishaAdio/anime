// Tiny in-memory TTL cache. Keeps upstream APIs happy (Jikan is rate limited)
// and makes repeat requests fast. Not shared across instances, which is fine
// for a single Render web service.

const store = new Map();

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/** Wrap an async producer with cache-aside behaviour. */
export async function cached(key, ttlMs, producer) {
  const existing = cacheGet(key);
  if (existing !== undefined) return existing;
  const value = await producer();
  return cacheSet(key, value, ttlMs);
}
