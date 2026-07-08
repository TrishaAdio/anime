// Holds a pre-generated "set" of cards (all seasons/movies of a searched anime)
// so the bot can page through them instantly. Everything is kept for 5 minutes,
// then the whole set (metadata + card image files) is cleaned up.

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const TTL_MS = 5 * 60 * 1000;
const root = join(tmpdir(), "anime-sets");
mkdirSync(root, { recursive: true });

const sets = new Map(); // setId -> { query, createdAt, expiresAt, timer, dir, pages: Map }

export const TTL_SECONDS = TTL_MS / 1000;

export function createSet(query, entries) {
  const setId = randomBytes(12).toString("hex");
  const dir = join(root, setId);
  mkdirSync(dir, { recursive: true });

  const pages = new Map();
  entries.forEach((e, i) => {
    const page = i + 1;
    pages.set(page, {
      page,
      malId: e.mal_id,
      title: e.title_english || e.title || null,
      type: e.type || null,
      year: e.year || null,
      status: "pending", // pending | ready | failed
      details: null,
      cardFile: null
    });
  });

  const timer = setTimeout(() => destroySet(setId), TTL_MS);
  if (timer.unref) timer.unref();

  sets.set(setId, { query, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, timer, dir, pages });
  return setId;
}

export function getSet(setId) {
  return sets.get(setId) || null;
}

export function getPage(setId, page) {
  const set = sets.get(setId);
  if (!set) return null;
  return set.pages.get(Number(page)) || null;
}

export function setPageData(setId, page, { details, cardBuffer }) {
  const set = sets.get(setId);
  if (!set) return;
  const p = set.pages.get(Number(page));
  if (!p) return;
  const cardFile = join(set.dir, `${page}.png`);
  writeFileSync(cardFile, cardBuffer);
  p.details = details;
  p.cardFile = cardFile;
  p.title = details?.title?.english || details?.title?.default || p.title;
  p.type = details?.type || p.type;
  p.year = details?.year || p.year;
  p.status = "ready";
}

export function markFailed(setId, page) {
  const p = getPage(setId, page);
  if (p) p.status = "failed";
}

export function cardFileFor(setId, page) {
  const p = getPage(setId, page);
  return p && p.cardFile && existsSync(p.cardFile) ? p.cardFile : null;
}

export function destroySet(setId) {
  const set = sets.get(setId);
  if (!set) return;
  clearTimeout(set.timer);
  sets.delete(setId);
  try {
    rmSync(set.dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
