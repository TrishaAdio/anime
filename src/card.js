// Generates an "AE style" (After Effects-style) aesthetic anime card:
// blurred banner background, duotone accent glows, a glowing gradient-ringed
// poster, gradient title text, glass score/genre pills, a light streak and
// subtle film grain. Returns a PNG buffer.

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontDir = join(__dirname, "..", "assets", "fonts");

const BRAND = "@YorManagerXBot";

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  GlobalFonts.registerFromPath(join(fontDir, "Poppins-ExtraBold.ttf"), "PoppinsX");
  GlobalFonts.registerFromPath(join(fontDir, "Poppins-Bold.ttf"), "PoppinsB");
  GlobalFonts.registerFromPath(join(fontDir, "Poppins-SemiBold.ttf"), "PoppinsS");
  GlobalFonts.registerFromPath(join(fontDir, "Poppins-Regular.ttf"), "PoppinsR");
  fontsReady = true;
}

const W = 1280;
const H = 720;

async function loadRemote(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

function hexToRgb(hex, fallback = [138, 92, 255]) {
  if (!hex || typeof hex !== "string") return fallback;
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const lighten = ([r, g, b], t = 0.45) => [
  Math.round(r + (255 - r) * t),
  Math.round(g + (255 - g) * t),
  Math.round(b + (255 - b) * t)
];
// A complementary-ish second accent so the glow feels richer (hue rotate).
const shift = ([r, g, b]) => [Math.min(255, g + 40), Math.min(255, b + 20), Math.min(255, r + 40)];

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const tr = w / h;
  let sw, sh, sx, sy;
  if (ir > tr) {
    sh = img.height;
    sw = sh * tr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / tr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      while (last.length && ctx.measureText(last + "...").width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last.trimEnd() + "...";
    }
  }
  return lines;
}

// Wrap into as many lines as needed (no truncation).
function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Pick the largest title font that fits within a sensible line budget so long
// titles don't blow up the layout (and push text into the footer).
function fitTitle(ctx, text, maxWidth) {
  const tries = [
    [78, 2],
    [70, 2],
    [62, 2],
    [58, 3],
    [52, 3],
    [46, 3]
  ];
  for (const [size, maxLines] of tries) {
    ctx.font = `800 ${size}px PoppinsX`;
    const lines = wrapLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines, lineHeight: Math.round(size * 1.06) };
  }
  ctx.font = "800 44px PoppinsX";
  return { size: 44, lines: wrapText(ctx, text, maxWidth, 3), lineHeight: 48 };
}

function pill(ctx, x, y, label, accent, opts = {}) {
  ctx.font = "600 24px PoppinsS";
  const padX = 20;
  const w = ctx.measureText(label).width + padX * 2;
  const h = 46;
  ctx.save();
  if (opts.solid) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, rgba(lighten(accent, 0.25), 1));
    g.addColorStop(1, rgba(accent, 1));
    ctx.shadowColor = rgba(accent, 0.55);
    ctx.shadowBlur = 18;
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0b0b12";
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
  }
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + padX, y + h / 2 + 1);
  ctx.restore();
  return w;
}

function radialGlow(ctx, cx, cy, radius, color, alpha) {
  const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function addGrain(ctx) {
  const gw = 320;
  const gh = 180;
  const g = createCanvas(gw, gh);
  const gc = g.getContext("2d");
  const img = gc.createImageData(gw, gh);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  gc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.05;
  try {
    ctx.globalCompositeOperation = "overlay";
  } catch {
    /* keep default */
  }
  ctx.drawImage(g, 0, 0, W, H);
  ctx.restore();
}

export async function buildCard(a) {
  ensureFonts();
  const accent = hexToRgb(a?.images?.color, [138, 92, 255]);
  const accent2 = shift(accent);

  const [bannerImg, posterImg] = await Promise.all([
    loadRemote(a?.images?.banner || a?.images?.cover || a?.images?.poster),
    loadRemote(a?.images?.poster || a?.images?.cover)
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Base.
  ctx.fillStyle = "#08080d";
  ctx.fillRect(0, 0, W, H);

  // Blurred, zoomed banner background.
  if (bannerImg) {
    ctx.save();
    try {
      ctx.filter = "blur(24px) brightness(0.5) saturate(1.25)";
    } catch {
      /* filter unsupported */
    }
    drawCover(ctx, bannerImg, -60, -60, W + 120, H + 120);
    ctx.restore();
  }

  // Duotone accent wash (diagonal).
  const duo = ctx.createLinearGradient(0, 0, W, H);
  duo.addColorStop(0, rgba(accent, 0.28));
  duo.addColorStop(0.5, "rgba(8,8,13,0.10)");
  duo.addColorStop(1, rgba(accent2, 0.22));
  ctx.save();
  try {
    ctx.globalCompositeOperation = "soft-light";
  } catch {
    /* default */
  }
  ctx.fillStyle = duo;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Legibility gradients.
  const gShade = ctx.createLinearGradient(0, 0, W, 0);
  gShade.addColorStop(0, "rgba(5,5,9,0.94)");
  gShade.addColorStop(0.5, "rgba(5,5,9,0.6)");
  gShade.addColorStop(1, "rgba(5,5,9,0.18)");
  ctx.fillStyle = gShade;
  ctx.fillRect(0, 0, W, H);

  const gVert = ctx.createLinearGradient(0, 0, 0, H);
  gVert.addColorStop(0, "rgba(5,5,9,0.55)");
  gVert.addColorStop(0.45, "rgba(5,5,9,0.0)");
  gVert.addColorStop(1, "rgba(5,5,9,0.9)");
  ctx.fillStyle = gVert;
  ctx.fillRect(0, 0, W, H);

  // Accent glow blobs.
  radialGlow(ctx, 120, H - 80, 520, accent, 0.5);
  radialGlow(ctx, W - 260, 120, 420, accent2, 0.35);

  // Diagonal light streak.
  ctx.save();
  ctx.translate(W * 0.62, -80);
  ctx.rotate(-0.42);
  const streak = ctx.createLinearGradient(0, 0, 0, 900);
  streak.addColorStop(0, "rgba(255,255,255,0)");
  streak.addColorStop(0.5, "rgba(255,255,255,0.06)");
  streak.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = streak;
  ctx.fillRect(0, 0, 130, 900);
  ctx.restore();

  // ---- Poster with gradient ring + glow ----
  const pw = 350;
  const ph = 502;
  const px = W - pw - 76;
  const py = (H - ph) / 2 - 6;
  if (posterImg) {
    const pad = 6;
    ctx.save();
    ctx.shadowColor = rgba(accent, 0.85);
    ctx.shadowBlur = 65;
    const ring = ctx.createLinearGradient(px - pad, py - pad, px + pw, py + ph);
    ring.addColorStop(0, rgba(lighten(accent, 0.3), 1));
    ring.addColorStop(1, rgba(accent2, 1));
    ctx.fillStyle = ring;
    roundRect(ctx, px - pad, py - pad, pw + pad * 2, ph + pad * 2, 26);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, px, py, pw, ph, 20);
    ctx.clip();
    drawCover(ctx, posterImg, px, py, pw, ph);
    // Gloss.
    const gloss = ctx.createLinearGradient(px, py, px, py + ph);
    gloss.addColorStop(0, "rgba(255,255,255,0.18)");
    gloss.addColorStop(0.25, "rgba(255,255,255,0.0)");
    gloss.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = gloss;
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
  }

  // ---- Left text column (measured + vertically centred, clear of footer) ----
  const x = 76;
  const textMax = px - x - 56;
  const footerY = H - 46;
  const safeBottom = footerY - 40; // text must never cross into this zone

  const kicker = [a.type, a.year, (a.status || "").toUpperCase()]
    .filter(Boolean)
    .join("   •   ")
    .toUpperCase();
  const titleText = a.title?.english || a.title?.default || "Unknown";
  const fit = fitTitle(ctx, titleText, textMax);
  const secondary = a.title?.default && a.title.default !== titleText ? a.title.default : null;

  const mal = a.ratings?.mal?.score;
  const imdb = a.ratings?.imdb?.rating;
  const anilistScore = a.ratings?.anilist?.averageScore;
  const hasPills = Boolean(mal || imdb || anilistScore || a.episodes);
  const genres = (a.genres || []).slice(0, 4);
  const nr = a.expectedNextRelease;

  const KICKER_H = 30;
  const UNDER_GAP = 12;
  const UNDER_H = 6;
  const TITLE_GAP = 26;
  const SUB_GAP = 16;
  const SUB_H = 34;
  const PILLS_GAP = 26;
  const PILL_H = 46;
  const GENRE_GAP = 16;
  const NEXT_GAP = 20;
  const NEXT_H = 28;

  let blockH = KICKER_H + UNDER_GAP + UNDER_H + TITLE_GAP + fit.lines.length * fit.lineHeight;
  if (secondary) blockH += SUB_GAP + SUB_H;
  if (hasPills) blockH += PILLS_GAP + PILL_H;
  if (genres.length) blockH += GENRE_GAP + PILL_H;
  if (nr) blockH += NEXT_GAP + NEXT_H;

  // Vertically centre the block, but never let it cross the footer safe zone.
  let y = Math.round((H - blockH) / 2);
  if (y + blockH > safeBottom) y = safeBottom - blockH;
  if (y < 108) y = 108;

  ctx.textBaseline = "top";

  // Kicker.
  ctx.font = "600 26px PoppinsS";
  ctx.fillStyle = rgba(lighten(accent, 0.35), 1);
  ctx.fillText(kicker, x, y);
  y += KICKER_H;

  // Accent underline (gradient).
  y += UNDER_GAP;
  const ug = ctx.createLinearGradient(x, 0, x + 90, 0);
  ug.addColorStop(0, rgba(lighten(accent, 0.3), 1));
  ug.addColorStop(1, rgba(accent2, 1));
  ctx.fillStyle = ug;
  roundRect(ctx, x, y, 90, UNDER_H, 3);
  ctx.fill();
  y += UNDER_H + TITLE_GAP;

  // Title (adaptive size, gradient fill + glow).
  ctx.font = `800 ${fit.size}px PoppinsX`;
  for (const line of fit.lines) {
    ctx.save();
    ctx.shadowColor = rgba(accent, 0.5);
    ctx.shadowBlur = 26;
    const tg = ctx.createLinearGradient(x, y, x, y + fit.size);
    tg.addColorStop(0, "#ffffff");
    tg.addColorStop(1, rgba(lighten(accent, 0.55), 1));
    ctx.fillStyle = tg;
    ctx.fillText(line, x, y);
    ctx.restore();
    y += fit.lineHeight;
  }

  // Secondary title (romaji) — always Latin so it renders reliably.
  if (secondary) {
    y += SUB_GAP;
    ctx.font = "400 28px PoppinsR";
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(wrapLines(ctx, secondary, textMax)[0], x, y);
    y += SUB_H;
  }

  // Score pills.
  if (hasPills) {
    y += PILLS_GAP;
    let bx = x;
    if (mal) bx += pill(ctx, bx, y, `MAL  ${mal}`, accent, { solid: true }) + 14;
    if (imdb) bx += pill(ctx, bx, y, `IMDb  ${imdb}`, accent) + 14;
    if (anilistScore) bx += pill(ctx, bx, y, `AniList  ${anilistScore}`, accent) + 14;
    if (a.episodes) bx += pill(ctx, bx, y, `${a.episodes} eps`, accent) + 14;
    y += PILL_H;
  }

  // Genres.
  if (genres.length) {
    y += GENRE_GAP;
    let gx = x;
    for (const g of genres) {
      const gw = pill(ctx, gx, y, g, accent);
      gx += gw + 12;
      if (gx > textMax) break;
    }
    y += PILL_H;
  }

  // Next release line.
  if (nr) {
    y += NEXT_GAP;
    ctx.font = "600 26px PoppinsS";
    ctx.fillStyle = rgba(lighten(accent, 0.35), 1);
    const label =
      nr.kind === "episode"
        ? `Next: Episode ${nr.episode} in ${nr.inDays} day(s)`
        : `Next season: ${nr.title || "announced"}${nr.date ? " • " + nr.date : ""}`;
    ctx.fillText(label, x, y);
  }

  // Grain texture.
  addGrain(ctx);

  // Outer gradient frame.
  ctx.save();
  const frame = ctx.createLinearGradient(0, 0, W, H);
  frame.addColorStop(0, rgba(lighten(accent, 0.2), 0.9));
  frame.addColorStop(1, rgba(accent2, 0.9));
  ctx.strokeStyle = frame;
  ctx.lineWidth = 3;
  roundRect(ctx, 14, 14, W - 28, H - 28, 26);
  ctx.stroke();
  ctx.restore();

  // Footer: brand handle (bottom-left) + studio (bottom-right).
  ctx.textBaseline = "alphabetic";
  ctx.save();
  ctx.font = "800 30px PoppinsX";
  ctx.shadowColor = rgba(accent, 0.6);
  ctx.shadowBlur = 16;
  const bg = ctx.createLinearGradient(x, 0, x + 260, 0);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(1, rgba(lighten(accent, 0.45), 1));
  ctx.fillStyle = bg;
  ctx.fillText(BRAND, x, H - 44);
  ctx.restore();

  const studio = (a.studios || [])[0];
  if (studio) {
    ctx.font = "600 24px PoppinsS";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const sw = ctx.measureText(studio).width;
    ctx.fillText(studio, W - sw - 76, H - 46);
  }

  return canvas.toBuffer("image/png");
}
