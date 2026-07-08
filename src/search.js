// Shared anime search. AniList first: it's fast, reliable, and returns the MAL
// id + format directly. Jikan is the fallback (its search endpoint is flaky and
// its retry/backoff can add many seconds). Both return Jikan-shaped summaries.

import * as jikan from "./sources/jikan.js";
import * as anilist from "./sources/anilist.js";

export async function searchAnime(query, limit = 10) {
  try {
    const results = await anilist.searchAnime(query, limit);
    if (results.length) return results;
  } catch {
    /* fall through to Jikan */
  }
  try {
    return await jikan.searchAnime(query, limit);
  } catch {
    return [];
  }
}
