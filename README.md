# Anime Details API

A comprehensive anime API that returns **everything about an anime** in one call — aggregated from multiple open data sources. No API keys required.

## What it returns

- Titles (default / English / Japanese / synonyms), synopsis, background
- **High-quality images**: poster, cover (extra-large), banner, theme color
- Trailer (YouTube)
- Type, source, status, episodes, duration, age rating, broadcast
- Aired dates, season, year
- Genres, themes, demographics, studios, producers, licensors
- **Ratings**: MyAnimeList score/rank, AniList score, and **IMDb rating** (fetched from the open web)
- **Seasons chain** (prequels/sequels with status + start dates)
- **Upcoming season** detection + expected release date
- **Next episode** air date & countdown (for currently-airing anime)
- **Dub languages** + **Hindi dub cast** where available (best-effort)
- **Manga details** of the source (chapters, volumes, status, authors, score)
- Streaming platforms & external links
- **Live news** searched from the open web

## Data sources (all free, no key)

- [Jikan v4](https://docs.api.jikan.moe/) — MyAnimeList data
- [AniList GraphQL](https://anilist.gitbook.io/anilist-apiv2-docs/) — next-episode timing, banner, sequel dates
- IMDb suggestion API + [Cinemeta](https://v3-cinemeta.strem.io) — IMDb ratings from the open web
- Google News RSS — live news search

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/search?q=naruto` | Search anime by name |
| GET | `/anime/:id` | Full details for a MAL anime id (everything) |
| GET | `/anime/:id?news=false` | Full details, skipping the live news lookup (faster) |
| GET | `/anime/:id/card` | Generate an **AE-style image**; returns a 1-minute download link |
| GET | `/anime/:id/card?inline=true` | Return the AE-style image directly (no link) |
| GET | `/anime/by-name/:name/card` | AE-style image for the best name match |
| GET | `/download/:token` | Download a generated card (auto-deletes after 1 min or on download) |
| GET | `/anime/by-name/:name` | Full details for the best name match |
| GET | `/set?q=solo+leveling` | Pre-generate cards for **all seasons + movies** of a search (held 5 min) |
| GET | `/anime/by-name/:name/set` | Same as `/set`, name in the path |
| GET | `/set/:setId` | Set overview: every page with status + card/data URLs |
| GET | `/set/:setId/:page` | One page: details + card URL |
| GET | `/set/:setId/:page/card` | The pre-generated card image (PNG) for a page |
| GET | `/anime/:id/news` | Live news for the anime |
| GET | `/anime/:id/characters` | Characters + voice actors (all languages) |
| GET | `/news?q=one+piece` | Live anime news search |
| GET | `/seasons/now` | Airing this season |
| GET | `/seasons/upcoming` | Upcoming anime |
| GET | `/health` | Status + system specs (CPU, memory, load, uptime) + internet speed |
| GET | `/health?speedtest=live` | Same, but forces a fresh live speed measurement |

### Example

```bash
curl https://<your-app>.onrender.com/anime/21        # One Piece
curl https://<your-app>.onrender.com/search?q=naruto
```

Response (trimmed):

```json
{
  "malId": 21,
  "title": { "default": "One Piece", "english": "One Piece", "japanese": "ONE PIECE" },
  "images": { "poster": "https://cdn.myanimelist.net/...l.jpg", "banner": "https://s4.anilist.co/..." },
  "ratings": {
    "mal": { "score": 8.73, "rank": 55 },
    "anilist": { "averageScore": 87 },
    "imdb": { "rating": 9.0, "id": "tt0388629", "url": "https://www.imdb.com/title/tt0388629/" }
  },
  "nextEpisode": { "episode": 1169, "airsAt": "2026-07-12T14:16:00.000Z", "inDays": 4 },
  "manga": { "title": "One Piece", "status": "Publishing", "score": 9.21, "authors": ["Oda, Eiichiro"] },
  "hindiDub": { "available": false, "cast": [] },
  "news": [ { "title": "...", "source": "Crunchyroll", "link": "..." } ]
}
```

## AE-style image cards

`GET /anime/:id/card` composites an "After Effects style" edit — the anime's
banner as a blurred background, accent-colour glows (auto-picked from AniList),
the poster with a coloured glow, and title / score / genre text.

It returns a **temporary download link** that is valid for **60 seconds**:

```json
{
  "title": "Demon Slayer: Kimetsu no Yaiba",
  "downloadUrl": "https://<host>/download/<token>?name=demon-slayer-ae-card",
  "expiresInSeconds": 60,
  "expiresAt": "2026-07-08T09:59:00.000Z",
  "note": "Link is valid for 60s. The file auto-deletes 1 minute after generation (or right after it is downloaded)."
}
```

- If the link is **downloaded within 1 minute**, the file is served and then removed.
- If it is **not** downloaded, it is **auto-deleted** after 1 minute and the link returns `410 Gone`.
- Use `?inline=true` to get the PNG directly without the link/expiry flow.

Rendering uses `@napi-rs/canvas` (prebuilt binaries — no system libraries needed
on Render) with the bundled Poppins font (`assets/fonts`). Cards are branded
**@YorManagerXBot**.

## Card sets (smooth Prev/Next for a franchise)

`GET /set?q=solo+leveling` finds the searched anime's **seasons and movies only**
(OVA/ONA/specials/music are filtered out), orders them chronologically, and
pre-generates a card for each one. Page 1's card is ready in the response; the
rest are generated in the background and **held for 5 minutes**, then cleaned up.

The response gives a `setId`, the ordered `pages`, and the fully-ready `current`
(page 1). To navigate, the bot requests `/set/:setId/:page` (data + caption) and
`/set/:setId/:page/card` (image) — these are already generated by the time the
user taps Next, so navigation is instant. If the user is faster than generation,
the missing page is generated on demand. Cards are re-fetchable within the TTL.

## Health & system metrics

`GET /health` returns service status plus live host metrics and internet speed:

```json
{
  "status": "ok",
  "uptimeSeconds": 1234,
  "system": {
    "platform": "linux", "arch": "x64", "nodeVersion": "v22.x",
    "cpu": { "model": "Intel(R) Xeon(R) ...", "cores": 8, "loadAverage": [0.2, 0.3, 0.2] },
    "memory": { "totalMB": 512, "freeMB": 210, "usedMB": 302, "processRssMB": 120 },
    "osUptimeSeconds": 4686
  },
  "network": { "provider": "Cloudflare", "pingMs": 40, "downloadMbps": 846, "uploadMbps": 168, "testedAt": "...", "ageSeconds": 12, "status": "ok" }
}
```

The speed test (Cloudflare's public endpoints) runs in the background at startup
and refreshes when the cached result is older than 15 minutes, so `/health`
responds instantly and never blocks Render's health check. Add `?speedtest=live`
to force a fresh measurement.

## Staying awake on Render free tier

Render free web services sleep after ~15 minutes without inbound traffic. This
app includes a keep-alive that self-pings its own public URL every 12 minutes
(using the `RENDER_EXTERNAL_URL` that Render injects automatically), so it stays
up continuously. It is a no-op locally.

- Configure the interval with `KEEPALIVE_MINUTES` (default `12`).
- Note: a single always-on free service uses roughly the whole monthly free
  instance-hour allowance, so it stays up until that free-tier limit resets.

## Notes

- **Hindi dub**: surfaced from MyAnimeList's per-character voice-actor language data. Many titles don't have Hindi VAs recorded, in which case `hindiDub.available` is `false` — that's expected.
- **IMDb**: matched by title via IMDb's suggestion endpoint, rating read from Cinemeta. Best-effort; may be `null` if no confident match.
- The full `/anime/:id` call makes several upstream requests, so the first hit can take a few seconds; results are cached for 15 minutes.

## Run locally

```bash
npm install
npm start
# http://localhost:3000
```

## Deploy to Render

Includes `render.yaml`. In Render choose **New > Blueprint** and point it at this repo, or create a Node web service with build `npm install` and start `npm start`. The app binds to `process.env.PORT`.
