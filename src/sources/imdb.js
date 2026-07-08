// IMDb rating from the open web, no API key required.
//   1. Resolve the IMDb title id via IMDb's public suggestion endpoint.
//   2. Read the rating from Cinemeta (Stremio's public metadata service),
//      which exposes imdbRating without authentication.

import { getJSON } from "../http.js";
import { cached } from "../cache.js";

const SUGGEST = "https://v3.sg.media-imdb.com/suggestion/x";
const CINEMETA = "https://v3-cinemeta.strem.io/meta";

// Find the best matching IMDb title id for an anime name (optionally a year).
async function findImdbId(name, year) {
  const q = encodeURIComponent(name.toLowerCase().slice(0, 80));
  const json = await getJSON(`${SUGGEST}/${q}.json`, {
    headers: { Referer: "https://www.imdb.com/" }
  });
  const titles = (json.d || []).filter((x) => String(x.id).startsWith("tt"));
  if (titles.length === 0) return null;

  let best = titles[0];
  if (year) {
    const exact = titles.find((t) => t.y === Number(year));
    if (exact) best = exact;
  }
  const isMovie = best.qid === "movie" || best.qid === "tvMovie";
  return { id: best.id, kind: isMovie ? "movie" : "series", matched: best.l, year: best.y };
}

async function ratingFromCinemeta(id, kind) {
  const order = kind === "movie" ? ["movie", "series"] : ["series", "movie"];
  for (const type of order) {
    try {
      const json = await getJSON(`${CINEMETA}/${type}/${id}.json`);
      const meta = json?.meta;
      if (meta && meta.imdbRating) {
        return { rating: Number(meta.imdbRating), type };
      }
    } catch {
      /* try next type */
    }
  }
  return null;
}

/**
 * Best-effort IMDb rating for an anime title.
 * Returns { rating, id, url, matchedTitle } or null when nothing is found.
 */
export async function getImdbRating(name, year) {
  if (!name) return null;
  const key = `imdb:${name.toLowerCase()}:${year || ""}`;
  try {
    return await cached(key, 6 * 60 * 60 * 1000, async () => {
      const found = await findImdbId(name, year);
      if (!found) return null;
      const rated = await ratingFromCinemeta(found.id, found.kind);
      return {
        source: "IMDb",
        id: found.id,
        url: `https://www.imdb.com/title/${found.id}/`,
        matchedTitle: found.matched,
        rating: rated ? rated.rating : null
      };
    });
  } catch {
    return null;
  }
}
