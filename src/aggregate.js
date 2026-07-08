// Combines Jikan (MAL), AniList, IMDb and live news into one rich anime object.

import * as jikan from "./sources/jikan.js";
import * as anilist from "./sources/anilist.js";
import { getImdbRating } from "./sources/imdb.js";
import { searchNews } from "./sources/news.js";
import { cached } from "./cache.js";
import { cleanSynopsis, buildCaptionHtml } from "./format.js";

// Only real seasons (TV) and movies count — OVA/ONA/specials/music are excluded.
const SEASON_FORMATS = new Set(["TV", "TV_SHORT", "MOVIE"]);
export function isSeasonOrMovie(format) {
  if (!format) return false;
  const f = String(format).toUpperCase().replace(/\s+/g, "_");
  return f === "TV" || f === "TV_SHORT" || f === "MOVIE";
}

function fuzzyDate(d) {
  if (!d || !d.year) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const parts = [d.year];
  if (d.month) parts.push(pad(d.month));
  if (d.day) parts.push(pad(d.day));
  const iso = d.day && d.month ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : null;
  return { year: d.year, month: d.month || null, day: d.day || null, iso, text: parts.join("-") };
}

function bestImages(full, ani) {
  const jpg = full?.images?.jpg || {};
  const webp = full?.images?.webp || {};
  return {
    poster: jpg.large_image_url || jpg.image_url || null,
    posterWebp: webp.large_image_url || webp.image_url || null,
    cover: ani?.coverImage?.extraLarge || ani?.coverImage?.large || jpg.large_image_url || null,
    banner: ani?.bannerImage || null,
    color: ani?.coverImage?.color || null
  };
}

function buildTrailer(full, ani) {
  if (full?.trailer?.youtube_id) {
    return {
      youtubeId: full.trailer.youtube_id,
      url: full.trailer.url,
      thumbnail: full.trailer.images?.maximum_image_url || full.trailer.images?.large_image_url || null
    };
  }
  if (ani?.trailer?.site === "youtube" && ani.trailer.id) {
    return {
      youtubeId: ani.trailer.id,
      url: `https://www.youtube.com/watch?v=${ani.trailer.id}`,
      thumbnail: ani.trailer.thumbnail || null
    };
  }
  return null;
}

// Season chain (prequels + sequels) from AniList relations, which include
// each entry's release status and start date.
function buildSeasons(ani) {
  if (!ani?.relations?.edges) return [];
  const wanted = new Set(["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY"]);
  return ani.relations.edges
    .filter(
      (e) =>
        wanted.has(e.relationType) &&
        e.node?.type === "ANIME" &&
        SEASON_FORMATS.has(e.node?.format)
    )
    .map((e) => ({
      relation: e.relationType.toLowerCase(),
      malId: e.node.idMal || null,
      title: e.node.title?.english || e.node.title?.romaji || null,
      format: e.node.format || null,
      status: e.node.status || null,
      startDate: fuzzyDate(e.node.startDate),
      image: e.node.coverImage?.large || null
    }));
}

// The next unreleased/airing sequel, treated as the "upcoming season".
function findUpcomingSeason(seasons) {
  const upcoming = seasons.find(
    (s) =>
      s.relation === "sequel" &&
      (s.status === "NOT_YET_RELEASED" || s.status === "RELEASING")
  );
  if (!upcoming) return null;
  return {
    title: upcoming.title,
    malId: upcoming.malId,
    status: upcoming.status === "RELEASING" ? "currently airing" : "announced / not yet released",
    expectedDate: upcoming.startDate,
    note: upcoming.startDate ? null : "Announced, exact date to be confirmed."
  };
}

function nextEpisodeInfo(ani) {
  const n = ani?.nextAiringEpisode;
  if (!n) return null;
  const airDate = new Date(n.airingAt * 1000);
  return {
    episode: n.episode,
    airsAt: airDate.toISOString(),
    inDays: Math.round(n.timeUntilAiring / 86400),
    inHours: Math.round(n.timeUntilAiring / 3600)
  };
}

// Voice-actor / dub information from MAL character data.
function buildDubInfo(characters) {
  const languages = new Set();
  const hindiCast = [];
  for (const c of characters || []) {
    for (const va of c.voice_actors || []) {
      if (!va.language) continue;
      languages.add(va.language);
      if (/hindi/i.test(va.language)) {
        hindiCast.push({ character: c.character?.name || null, actor: va.person?.name || null });
      }
    }
  }
  return {
    dubLanguages: [...languages].sort(),
    hindiDub: {
      available: hindiCast.length > 0,
      cast: hindiCast
    }
  };
}

function findMangaRelation(full) {
  const mangaEntries = [];
  for (const rel of full?.relations || []) {
    for (const e of rel.entry || []) {
      if (e.type === "manga") mangaEntries.push({ relation: rel.relation, ...e });
    }
  }
  if (mangaEntries.length === 0) return null;
  // Prefer the source manga: an "Adaptation" whose title is not a novelization.
  const isNovel = (name) => /novel|novelize/i.test(name || "");
  return (
    mangaEntries.find((e) => e.relation === "Adaptation" && !isNovel(e.name)) ||
    mangaEntries.find((e) => !isNovel(e.name)) ||
    mangaEntries[0]
  );
}

async function buildManga(full) {
  const ref = findMangaRelation(full);
  if (!ref) return null;
  try {
    const m = await jikan.getManga(ref.mal_id);
    if (!m) return { malId: ref.mal_id, title: ref.name, url: ref.url, relation: ref.relation };
    return {
      malId: m.mal_id,
      relation: ref.relation,
      title: m.title,
      titleEnglish: m.title_english || null,
      type: m.type,
      chapters: m.chapters,
      volumes: m.volumes,
      status: m.status,
      publishing: m.publishing,
      published: m.published?.string || null,
      score: m.score,
      authors: (m.authors || []).map((a) => a.name),
      genres: (m.genres || []).map((g) => g.name),
      synopsis: m.synopsis || null,
      image: m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || null,
      url: m.url
    };
  } catch {
    return { malId: ref.mal_id, title: ref.name, url: ref.url, relation: ref.relation };
  }
}

/**
 * Full aggregated details for a MAL anime id.
 * `lite` skips the character/manga/news lookups (used for fast batch card
 * generation) — it still returns everything needed for a card + caption.
 */
export async function getAnimeDetails(malId, { includeNews = true, lite = false } = {}) {
  return cached(`details:${malId}:${includeNews}:${lite}`, 15 * 60 * 1000, async () => {
    const full = await jikan.getFull(malId);
    if (!full) return null;

    const [characters, ani] = await Promise.all([
      lite ? Promise.resolve([]) : jikan.getCharacters(malId).catch(() => []),
      anilist.byMalId(malId)
    ]);

    const title = full.title_english || full.title;
    const [imdb, manga, news] = await Promise.all([
      getImdbRating(title, full.year),
      lite ? Promise.resolve(null) : buildManga(full),
      !lite && includeNews ? searchNews(`${title} anime`, 8) : Promise.resolve([])
    ]);

    const seasons = buildSeasons(ani);
    const upcomingSeason = findUpcomingSeason(seasons);
    const nextEpisode = nextEpisodeInfo(ani);
    const dub = buildDubInfo(characters);

    const expectedNextRelease = nextEpisode
      ? { kind: "episode", episode: nextEpisode.episode, date: nextEpisode.airsAt, inDays: nextEpisode.inDays }
      : upcomingSeason
      ? { kind: "season", title: upcomingSeason.title, date: upcomingSeason.expectedDate?.iso || null, note: upcomingSeason.note }
      : null;

    const details = {
      malId: full.mal_id,
      anilistId: ani?.id || null,
      url: full.url,
      title: {
        default: full.title,
        english: full.title_english || null,
        japanese: full.title_japanese || null,
        synonyms: full.title_synonyms || []
      },
      synopsis: cleanSynopsis(full.synopsis) || null,
      background: full.background || null,
      type: full.type,
      source: full.source,
      status: full.status,
      airing: full.airing,
      episodes: full.episodes,
      duration: full.duration,
      ageRating: full.rating,
      season: full.season,
      year: full.year,
      aired: {
        from: full.aired?.from || null,
        to: full.aired?.to || null,
        text: full.aired?.string || null
      },
      broadcast: full.broadcast?.string || null,
      images: bestImages(full, ani),
      trailer: buildTrailer(full, ani),
      genres: (full.genres || []).map((g) => g.name),
      themes: (full.themes || []).map((t) => t.name),
      demographics: (full.demographics || []).map((d) => d.name),
      studios: (full.studios || []).map((s) => s.name),
      producers: (full.producers || []).map((p) => p.name),
      licensors: (full.licensors || []).map((l) => l.name),
      ratings: {
        mal: {
          score: full.score,
          scoredBy: full.scored_by,
          rank: full.rank,
          popularity: full.popularity,
          members: full.members,
          favorites: full.favorites
        },
        anilist: ani
          ? { averageScore: ani.averageScore, meanScore: ani.meanScore, popularity: ani.popularity }
          : null,
        imdb: imdb || null
      },
      seasons,
      upcomingSeason,
      nextEpisode,
      expectedNextRelease,
      dubLanguages: dub.dubLanguages,
      hindiDub: dub.hindiDub,
      manga,
      streaming: (full.streaming || []).map((s) => ({ name: s.name, url: s.url })),
      externalLinks: (ani?.externalLinks || []).map((l) => ({ site: l.site, url: l.url })),
      news
    };

    // Telegram-ready HTML caption for the bot chat.
    details.captionHtml = buildCaptionHtml(details);
    return details;
  });
}
