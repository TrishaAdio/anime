// AniList GraphQL API (https://anilist.gitbook.io/anilist-apiv2-docs/).
// Used for data Jikan lacks or lags on: the exact next-episode air time,
// banner artwork, trailer, and sequel/prequel start dates + release status.

import { postJSON } from "../http.js";
import { cached } from "../cache.js";

const ENDPOINT = "https://graphql.anilist.co";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// AniList rate-limits aggressively (429). Retry a few times with short backoff
// so transient bursts recover; give up quickly rather than blocking the request.
async function query(payload, { attempts = 3, timeout = 12000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await postJSON(ENDPOINT, payload, { timeout });
    } catch (err) {
      lastErr = err;
      if ((err.status && !RETRYABLE.has(err.status)) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i)); // 500ms, 1s
    }
  }
  throw lastErr;
}

const MEDIA_QUERY = `
query ($idMal: Int) {
  Media(idMal: $idMal, type: ANIME) {
    id
    idMal
    status
    episodes
    averageScore
    meanScore
    popularity
    favourites
    bannerImage
    coverImage { extraLarge large color }
    trailer { id site thumbnail }
    nextAiringEpisode { episode airingAt timeUntilAiring }
    startDate { year month day }
    endDate { year month day }
    studios(isMain: true) { nodes { name } }
    externalLinks { site url }
    relations {
      edges {
        relationType
        node {
          idMal
          type
          format
          status
          title { romaji english }
          startDate { year month day }
          coverImage { large }
        }
      }
    }
  }
}`;

const SEARCH_QUERY = `
query ($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      idMal
      format
      episodes
      status
      averageScore
      seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      siteUrl
    }
  }
}`;

// Search anime on AniList. Returns entries shaped like Jikan's summary so the
// server can treat both sources the same way. Used as a fallback when Jikan's
// (flaky) search endpoint times out.
export async function searchAnime(search, perPage = 10) {
  const json = await query({
    query: SEARCH_QUERY,
    variables: { search, perPage }
  });
  const media = json?.data?.Page?.media || [];
  return media
    .filter((m) => m.idMal)
    .map((m) => ({
      mal_id: m.idMal,
      title: m.title?.romaji,
      title_english: m.title?.english || null,
      type: m.format,
      episodes: m.episodes,
      status: m.status,
      score: m.averageScore ? m.averageScore / 10 : null,
      year: m.seasonYear,
      season: null,
      images: { jpg: { large_image_url: m.coverImage?.extraLarge || m.coverImage?.large || null } },
      url: m.siteUrl
    }));
}

export async function byMalId(idMal, opts = {}) {
  const key = `anilist:${idMal}`;
  try {
    return await cached(key, 30 * 60 * 1000, async () => {
      const json = await query(
        { query: MEDIA_QUERY, variables: { idMal: Number(idMal) } },
        opts
      );
      return json?.data?.Media || null;
    });
  } catch {
    // AniList is a best-effort enrichment; never fail the whole request on it.
    return null;
  }
}
