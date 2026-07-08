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
const inflight = new Map(); // `${setId}:${page}` -> Promise

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Is this search hit part of the same franchise as the query/anchor?
function isRelevant(entry, q) {
  const t = norm(entry.title_english || entry.title);
  const t2 = norm(entry.title);
  return t.includes(q) || q.includes(t) || t2.includes(q) || q.includes(t2);
}

// The searched anime's own seasons/movies, from AniList relations.
async function franchiseRelations(malId) {
  const media = await anilist.byMalId(malId).catch(() => null);
  if (!media?.relations?.edges) return [];
  const wanted = new Set(["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY"]);
  return media.relations.edges
    .filter(
      (e) =>
        wanted.has(e.relationType) &&
        e.node?.type === "ANIME" &&
        isSeasonOrMovie(e.node?.format) &&
        e.node?.idMal
    )
    .map((e) => ({
      mal_id: e.node.idMal,
      title: e.node.title?.romaji || null,
      title_english: e.node.title?.english || null,
      type: e.node.format,
      year: e.node.startDate?.year || null
    }));
}

// Build the ordered list of franchise entries (seasons + movies only).
async function buildEntries(query, results) {
  const q = norm(query);
  const anchor = results.find((r) => isSeasonOrMovie(r.type)) || results[0];

  // Relevant search hits (share the franchise name) that are seasons/movies.
  const relevant = results.filter((r) => r.mal_id && isSeasonOrMovie(r.type) && isRelevant(r, q));

  // Enrich with the anchor's own related seasons/movies (catches differently
  // named sequels/movies that the text search missed).
  const related = anchor?.mal_id ? await franchiseRelations(anchor.mal_id) : [];

  const byId = new Map();
  const add = (e) => {
    if (e?.mal_id && !byId.has(e.mal_id)) byId.set(e.mal_id, e);
  };
  if (anchor && isSeasonOrMovie(anchor.type)) add(anchor);
  relevant.forEach(add);
  related.forEach(add);

  const entries = [...byId.values()];
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
