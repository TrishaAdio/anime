// Shared anime search: Jikan first (flaky, so retried inside), then AniList as
// a fast, reliable fallback. Both return Jikan-shaped summaries.

import * as jikan from "./sources/jikan.js";
import * as anilist from "./sources/anilist.js";

export async function searchAnime(query, limit = 10) {
  try {
    const results = await jikan.searchAnime(query, limit);
    if (results.length) return results;
  } catch {
    /* fall through to AniList */
  }
  return anilist.searchAnime(query, limit);
}
