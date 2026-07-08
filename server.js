import express from "express";
import * as jikan from "./src/sources/jikan.js";
import * as anilist from "./src/sources/anilist.js";
import { searchNews } from "./src/sources/news.js";
import { getAnimeDetails } from "./src/aggregate.js";
import os from "node:os";
import { buildCard } from "./src/card.js";
import { saveTemp, getTemp, remove, TTL_SECONDS } from "./src/cardstore.js";
import { startKeepAlive } from "./src/keepalive.js";
import { getSpeed, refreshIfStale, runSpeedTest, startSpeedMonitor } from "./src/speedtest.js";
import { createSet, getSetPage } from "./src/set.js";
import * as setstore from "./src/setstore.js";

const app = express();
app.set("trust proxy", true); // correct req.protocol behind Render's proxy
const PORT = process.env.PORT || 3000;

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function safeName(str) {
  return String(str || "anime")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

// Jikan's search endpoint is flaky (frequent 504s). Try it, then fall back to
// AniList search, which is fast and reliable and also yields the MAL id.
async function searchAnime(query, limit) {
  try {
    const results = await jikan.searchAnime(query, limit);
    if (results.length) return results;
  } catch {
    /* fall through to AniList */
  }
  return anilist.searchAnime(query, limit);
}

const asyncRoute = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(err.status && err.status < 500 ? err.status : 500).json({
      error: err.message || "Internal error"
    });
  });

function summarize(a) {
  return {
    malId: a.mal_id,
    title: a.title_english || a.title,
    titleDefault: a.title,
    type: a.type,
    episodes: a.episodes,
    status: a.status,
    score: a.score,
    year: a.year,
    season: a.season,
    image: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
    url: a.url
  };
}

app.get("/", (_req, res) => {
  res.json({
    name: "Anime Details API",
    description:
      "Full anime details aggregated from MyAnimeList (Jikan) + AniList, with IMDb ratings from the open web, live news, dub info, seasons and manga.",
    endpoints: {
      "GET /search?q=naruto": "Search anime by name.",
      "GET /anime/:id": "Full details for a MAL anime id (everything).",
      "GET /anime/:id?news=false": "Full details without the live news lookup (faster).",
      "GET /anime/:id/card": "Generate an AE-style image; returns a 1-minute download link.",
      "GET /anime/:id/card?inline=true": "Return the AE-style image directly (no link).",
      "GET /anime/by-name/:name/card": "AE-style image for the best name match.",
      "GET /anime/by-name/:name": "Full details for the best match of a name.",
      "GET /set?q=solo+leveling": "Pre-generate cards for all seasons+movies of a search (held 5 min).",
      "GET /anime/by-name/:name/set": "Same as /set for a name path.",
      "GET /set/:setId": "Set overview: all pages with status + card/data URLs.",
      "GET /set/:setId/:page": "One page: details + Telegram captionHtml + card URL.",
      "GET /set/:setId/:page/card": "The pre-generated card image for a page.",
      "GET /anime/:id/news": "Live news for the anime (searches the web).",
      "GET /anime/:id/characters": "Characters and voice actors (all languages).",
      "GET /news?q=one+piece": "Live anime news search.",
      "GET /seasons/now": "Anime airing this season.",
      "GET /seasons/upcoming": "Upcoming anime.",
      "GET /health": "Health check."
    }
  });
});

const MB = 1024 * 1024;

app.get(
  "/health",
  asyncRoute(async (req, res) => {
    // ?speedtest=live forces a fresh (blocking) measurement; otherwise the
    // cached background result is returned instantly and refreshed if stale.
    if (req.query.speedtest === "live") {
      await runSpeedTest();
    } else {
      refreshIfStale();
    }

    const cpus = os.cpus();
    const mem = process.memoryUsage();

    res.json({
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        hostname: os.hostname(),
        cpu: {
          model: cpus[0]?.model?.trim() || "unknown",
          cores: cpus.length,
          loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100)
        },
        memory: {
          totalMB: Math.round(os.totalmem() / MB),
          freeMB: Math.round(os.freemem() / MB),
          usedMB: Math.round((os.totalmem() - os.freemem()) / MB),
          processRssMB: Math.round(mem.rss / MB)
        },
        osUptimeSeconds: Math.round(os.uptime())
      },
      network: getSpeed()
    });
  })
);

app.get(
  "/search",
  asyncRoute(async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (!q) return res.status(400).json({ error: "Missing ?q=" });
    const limit = Math.min(25, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const results = await searchAnime(q, limit);
    res.json({ query: q, count: results.length, results: results.map(summarize) });
  })
);

app.get(
  "/anime/by-name/:name",
  asyncRoute(async (req, res) => {
    const results = await searchAnime(req.params.name, 1);
    if (!results.length) return res.status(404).json({ error: "No anime found for that name" });
    const details = await getAnimeDetails(results[0].mal_id, {
      includeNews: req.query.news !== "false"
    });
    res.json(details);
  })
);

app.get(
  "/anime/:id/news",
  asyncRoute(async (req, res) => {
    const full = await jikan.getFull(req.params.id);
    if (!full) return res.status(404).json({ error: "Anime not found" });
    const title = full.title_english || full.title;
    const news = await searchNews(`${title} anime`, 15);
    res.json({ malId: full.mal_id, title, count: news.length, news });
  })
);

app.get(
  "/anime/:id/characters",
  asyncRoute(async (req, res) => {
    const chars = await jikan.getCharacters(req.params.id);
    const mapped = chars.map((c) => ({
      name: c.character?.name || null,
      role: c.role,
      image: c.character?.images?.jpg?.image_url || null,
      voiceActors: (c.voice_actors || []).map((v) => ({
        name: v.person?.name || null,
        language: v.language
      }))
    }));
    res.json({ count: mapped.length, characters: mapped });
  })
);

app.get(
  "/anime/:id",
  asyncRoute(async (req, res) => {
    const details = await getAnimeDetails(req.params.id, {
      includeNews: req.query.news !== "false"
    });
    if (!details) return res.status(404).json({ error: "Anime not found" });
    res.json(details);
  })
);

async function makeCard(req, res, malId) {
  const details = await getAnimeDetails(malId, { includeNews: false });
  if (!details) return res.status(404).json({ error: "Anime not found" });

  const png = await buildCard(details);
  const title = details.title.english || details.title.default;
  const baseName = `${safeName(title)}-ae-card`;

  // ?inline=true returns the image directly instead of a temporary link.
  if (req.query.inline === "true") {
    res.type("png");
    res.setHeader("Content-Disposition", `inline; filename="${baseName}.png"`);
    return res.send(png);
  }

  const { token, expiresAt } = saveTemp(png, "png");
  res.json({
    malId: details.malId,
    title,
    image: { style: "AE card", width: 1280, height: 720, format: "png" },
    downloadUrl: `${baseUrl(req)}/download/${token}?name=${encodeURIComponent(baseName)}`,
    expiresInSeconds: TTL_SECONDS,
    expiresAt: new Date(expiresAt).toISOString(),
    note: `Link is valid for ${TTL_SECONDS}s. The file auto-deletes 1 minute after generation (or right after it is downloaded).`
  });
}

app.get(
  "/anime/:id/card",
  asyncRoute((req, res) => makeCard(req, res, req.params.id))
);

app.get(
  "/anime/by-name/:name/card",
  asyncRoute(async (req, res) => {
    const results = await searchAnime(req.params.name, 1);
    if (!results.length) return res.status(404).json({ error: "No anime found for that name" });
    return makeCard(req, res, results[0].mal_id);
  })
);

app.get("/download/:token", (req, res) => {
  const path = getTemp(req.params.token);
  if (!path) {
    return res
      .status(410)
      .json({ error: "Link expired or already used. AE cards auto-delete 1 minute after generation." });
  }
  const filename = (req.query.name && safeName(req.query.name)) || "anime-ae-card";
  res.download(path, `${filename}.png`, () => remove(req.params.token));
});

// ---- Pre-generated card set (all seasons/movies of a searched anime) ----

function pageBrief(req, setId, p) {
  return {
    page: p.page,
    malId: p.malId,
    title: p.title,
    type: p.type,
    year: p.year,
    status: p.status,
    cardUrl: `${baseUrl(req)}/set/${setId}/${p.page}/card`,
    dataUrl: `${baseUrl(req)}/set/${setId}/${p.page}`
  };
}

function pageFull(req, setId, count, p) {
  return {
    setId,
    page: p.page,
    count,
    malId: p.malId,
    title: p.details ? p.details.title.english || p.details.title.default : p.title,
    status: p.status,
    cardUrl: `${baseUrl(req)}/set/${setId}/${p.page}/card`,
    captionHtml: p.details ? p.details.captionHtml : null,
    details: p.details || null
  };
}

function setOverview(req, setId) {
  const set = setstore.getSet(setId);
  if (!set) return null;
  return {
    setId,
    query: set.query,
    count: set.pages.size,
    expiresInSeconds: Math.max(0, Math.round((set.expiresAt - Date.now()) / 1000)),
    pages: [...set.pages.values()].map((p) => pageBrief(req, setId, p))
  };
}

async function respondNewSet(req, res, query) {
  if (!query) return res.status(400).json({ error: "Missing search query" });
  const created = await createSet(query);
  if (!created) return res.status(404).json({ error: "No seasons or movies found for that search" });
  const overview = setOverview(req, created.setId);
  const first = await getSetPage(created.setId, 1);
  overview.current = first ? pageFull(req, created.setId, created.count, first) : null;
  res.json(overview);
}

app.get(
  "/anime/by-name/:name/set",
  asyncRoute((req, res) => respondNewSet(req, res, req.params.name))
);

app.get(
  "/set",
  asyncRoute((req, res) => respondNewSet(req, res, (req.query.q || "").toString().trim()))
);

app.get(
  "/set/:setId",
  asyncRoute((req, res) => {
    const overview = setOverview(req, req.params.setId);
    if (!overview) {
      return res.status(410).json({ error: "Set expired or not found. Sets are kept for 5 minutes." });
    }
    res.json(overview);
  })
);

app.get(
  "/set/:setId/:page",
  asyncRoute(async (req, res) => {
    const set = setstore.getSet(req.params.setId);
    if (!set) {
      return res.status(410).json({ error: "Set expired or not found. Sets are kept for 5 minutes." });
    }
    const p = await getSetPage(req.params.setId, req.params.page);
    if (!p) return res.status(404).json({ error: "Page not found" });
    res.json(pageFull(req, req.params.setId, set.pages.size, p));
  })
);

app.get(
  "/set/:setId/:page/card",
  asyncRoute(async (req, res) => {
    const set = setstore.getSet(req.params.setId);
    if (!set) return res.status(410).json({ error: "Set expired. Sets are kept for 5 minutes." });
    await getSetPage(req.params.setId, req.params.page);
    const file = setstore.cardFileFor(req.params.setId, req.params.page);
    if (!file) return res.status(404).json({ error: "Card not available for this page" });
    res.type("png");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(file);
  })
);

app.get(
  "/news",
  asyncRoute(async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (!q) return res.status(400).json({ error: "Missing ?q=" });
    const news = await searchNews(`${q} anime`, 15);
    res.json({ query: q, count: news.length, news });
  })
);

app.get(
  "/seasons/now",
  asyncRoute(async (_req, res) => {
    const data = await jikan.seasonNow();
    res.json({ count: data.length, anime: data.map(summarize) });
  })
);

app.get(
  "/seasons/upcoming",
  asyncRoute(async (_req, res) => {
    const data = await jikan.seasonUpcoming();
    res.json({ count: data.length, anime: data.map(summarize) });
  })
);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`Anime Details API listening on port ${PORT}`);
  startKeepAlive();
  startSpeedMonitor();
});
