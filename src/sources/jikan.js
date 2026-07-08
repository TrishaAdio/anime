// MyAnimeList data via the Jikan v4 API (https://docs.api.jikan.moe/).
// Jikan is rate limited (~3 req/sec, 60/min), so every request goes through a
// serial queue with spacing, and results are cached.

import { getJSON } from "../http.js";
import { cached } from "../cache.js";

const BASE = "https://api.jikan.moe/v4";
const SPACING_MS = 400;

let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(async () => {
    const result = await task();
    await new Promise((r) => setTimeout(r, SPACING_MS));
    return result;
  });
  // Keep the chain alive even if a task rejects.
  chain = run.catch(() => {});
  return run;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function getWithRetry(path, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getJSON(`${BASE}${path}`, { timeout: 15000 });
    } catch (err) {
      lastErr = err;
      if ((err.status && !RETRYABLE.has(err.status)) || i === attempts - 1) throw err;
      // Backoff: 800ms, 1.6s, 3.2s, 6.4s ...
      await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw lastErr;
}

function get(path, ttlMs) {
  return cached(`jikan:${path}`, ttlMs, () => enqueue(() => getWithRetry(path)));
}

export async function searchAnime(query, limit = 10) {
  const url = `/anime?q=${encodeURIComponent(query)}&limit=${limit}`;
  const json = await get(url, 10 * 60 * 1000);
  return json.data || [];
}

export async function getFull(id) {
  const json = await get(`/anime/${id}/full`, 30 * 60 * 1000);
  return json.data || null;
}

export async function getCharacters(id) {
  const json = await get(`/anime/${id}/characters`, 30 * 60 * 1000);
  return json.data || [];
}

export async function getAnimeNews(id) {
  const json = await get(`/anime/${id}/news`, 15 * 60 * 1000);
  return json.data || [];
}

export async function getManga(id) {
  const json = await get(`/manga/${id}/full`, 30 * 60 * 1000);
  return json.data || null;
}

export async function seasonNow() {
  const json = await get(`/seasons/now?limit=25`, 30 * 60 * 1000);
  return json.data || [];
}

export async function seasonUpcoming() {
  const json = await get(`/seasons/upcoming?limit=25`, 30 * 60 * 1000);
  return json.data || [];
}
