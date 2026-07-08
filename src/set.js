// Builds and manages a pre-generated card set for a searched anime.
//
// Flow:
//  1. Search the name and keep only TV seasons + movies (chronological order).
//  2. Generate page 1's card synchronously so the first card is ready instantly.
//  3. Generate the remaining cards in the background and hold them (5 min TTL).
//  4. If the user pages faster than generation, the missing page is generated
//     on demand. Cards are re-fetchable within the TTL for smooth Prev/Next.

import { searchAnime } from "./search.js";
import { isSeasonOrMovie, getAnimeDetails } from "./aggregate.js";
import * as anilist from "./sources/anilist.js";
import { buildCard } from "./card.js";
import * as store from "./setstore.js";

const MAX_PAGES = 12;
const MAX_CALLS = 12; // cap AniList relation lookups
const WALK_BUDGET_MS = 11000; // hard time budget for the whole graph walk
const inflight = new Map(); // `${setId}:${page}` -> Promise

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Relation types that make up a franchise's *watchable* line-up.
//  - MAIN: real seasons; we follow these to discover the whole chain.
//  - LEAF: real side movies/series; included but not traversed further.
// Everything else (ALTERNATIVE, SUMMARY, COMPILATION, SPIN_OFF, CHARACTER,
// OTHER, ...) is skipped — that's where recaps/compilations live.
const MAIN_REL = new Set(["PREQUEL", "SEQUEL", "PARENT"]);
const LEAF_REL = new Set(["SIDE_STORY"]);

const edgeToEntry = (n) => ({
  mal_id: n.idMal,
  title: n.title?.romaji || null,
  title_english: n.title?.english || null,
  type: n.format,
  year: n.startDate?.year || null
});

// Walk AniList's relation graph from the anchor and collect only real
// seasons + side movies (no recaps/compilations/spin-offs).
async function walkFranchise(anchor) {
  const collected = new Map();
  const add = (e) => {
    if (e?.mal_id && isSeasonOrMovie(e.type) && !collected.has(e.mal_id)) collected.set(e.mal_id, e);
  };
  add(anchor);

  const visited = new Set();
  const queue = [anchor.mal_id];
  let calls = 0;
  const deadline = Date.now() + WALK_BUDGET_MS;

  while (queue.length && calls < MAX_CALLS && Date.now() < deadline) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);

    // Short per-call budget so one throttled AniList request can't stall the set.
    const media = await anilist.byMalId(id, { attempts: 2, timeout: 6000 }).catch(() => null);
    calls++;
    if (!media?.relations?.edges) continue;

    for (const e of media.relations.edges) {
      const n = e.node;
      if (n?.type !== "ANIME" || !n.idMal) continue;
      if (MAIN_REL.has(e.relationType)) {
        add(edgeToEntry(n));
        if (!visited.has(n.idMal)) queue.push(n.idMal); // continue the chain
      } else if (LEAF_REL.has(e.relationType)) {
        add(edgeToEntry(n)); // real side movie/series, don't traverse
      }
    }
  }

  return [...collected.values()];
}

// Build the ordered list of franchise entries (real seasons + movies only).
async function buildEntries(query, results) {
  // Anchor: prefer a TV entry, else any season/movie, else the top hit.
  const anchor =
    results.find((r) => String(r.type).toUpperCase() === "TV") ||
    results.find((r) => isSeasonOrMovie(r.type)) ||
    results[0];
  if (!anchor?.mal_id) return [];

  let entries = await walkFranchise(anchor);

  // Fallback: if the relation graph gave us nothing usable, at least return the
  // season/movie search hits so a set is never empty.
  if (entries.length === 0) {
    entries = results.filter((r) => r.mal_id && isSeasonOrMovie(r.type));
  }

  entries.sort((a, b) => {
    const ay = a.year || 9999;
    const by = b.year || 9999;
    if (ay !== by) return ay - by;
    return String(a.title_english || a.title || "").localeCompare(String(b.title_english || b.title || ""));
  });
  return entries.slice(0, MAX_PAGES);
}

async function generatePage(setId, page) {
  const key = `${setId}:${page}`;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    const p = store.getPage(setId, page);
    if (!p || p.status === "ready") return p;
    try {
      const details = await getAnimeDetails(p.malId, { lite: true });
      if (!details) {
        store.markFailed(setId, page);
        return store.getPage(setId, page);
      }
      const png = await buildCard(details);
      store.setPageData(setId, page, { details, cardBuffer: png });
    } catch {
      store.markFailed(setId, page);
    }
    return store.getPage(setId, page);
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

function backgroundGenerateRest(setId) {
  (async () => {
    const set = store.getSet(setId);
    if (!set) return;
    for (const page of set.pages.keys()) {
      if (!store.getSet(setId)) return; // set expired
      const p = store.getPage(setId, page);
      if (p && p.status === "pending") await generatePage(setId, page);
    }
  })().catch(() => {});
}

/** Create a set for a search query. Returns { setId, count } or null. */
export async function createSet(query) {
  const results = await searchAnime(query, 20);
  if (!results.length) return null;
  const entries = await buildEntries(query, results);
  if (!entries.length) return null;

  const setId = store.createSet(query, entries);
  await generatePage(setId, 1); // page 1 ready before responding
  backgroundGenerateRest(setId); // the rest in the background
  return { setId, count: entries.length };
}

/** Get a page, generating it on demand if it isn't ready yet. */
export async function getSetPage(setId, page) {
  const set = store.getSet(setId);
  if (!set) return null;
  const num = Number(page);
  if (!set.pages.has(num)) return null;
  let p = store.getPage(setId, num);
  if (p.status !== "ready") p = await generatePage(setId, num);
  return p;
}
