// Temporary file store for generated cards.
// Each file lives for at most TTL_MS (1 minute). If it isn't downloaded within
// that window it is auto-deleted; a successful download also removes it.

import { mkdirSync, writeFileSync, existsSync, unlink } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const TTL_MS = 60 * 1000;
const dir = join(tmpdir(), "anime-cards");
mkdirSync(dir, { recursive: true });

const store = new Map(); // token -> { path, timer, expiresAt }

export function saveTemp(buffer, ext = "png") {
  const token = randomBytes(16).toString("hex");
  const path = join(dir, `${token}.${ext}`);
  writeFileSync(path, buffer);
  const expiresAt = Date.now() + TTL_MS;
  const timer = setTimeout(() => remove(token), TTL_MS);
  if (timer.unref) timer.unref();
  store.set(token, { path, timer, expiresAt });
  return { token, expiresAt, ttlSeconds: TTL_MS / 1000 };
}

export function getTemp(token) {
  const entry = store.get(token);
  if (!entry) return null;
  if (!existsSync(entry.path)) {
    store.delete(token);
    return null;
  }
  return entry.path;
}

export function remove(token) {
  const entry = store.get(token);
  if (!entry) return;
  clearTimeout(entry.timer);
  store.delete(token);
  unlink(entry.path, () => {});
}

export const TTL_SECONDS = TTL_MS / 1000;
