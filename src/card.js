// Generates an "AE style" (After Effects-style) aesthetic anime card:
// blurred banner background, accent-colour glows, poster with glow, and
// title / score / genre text. Returns a PNG buffer.

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontDir = join(__dirname, "..", "assets", "fonts");

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
    const buf = Buffer.from(await res.arrayBuffer());
    return await loadImage(buf);
  } catch {
    return null;
  }
}

function hexToRgb(hex, fallback = [124, 92, 255]) {
  if (!hex || typeof hex !== "string") return fallback;
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

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

// Draw an image covering the target box (like CSS background-size: cover).
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
  // Ellipsize if we ran out of room.
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      while (last.length && ctx.measureText(last + "...").width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last.trimEnd() + "...";
    }
  }
  return lines;
}

function pill(ctx, x, y, label, accent, opts = {}) {
  ctx.font = `600 24px PoppinsS`;
  const padX = 18;
  const w = ctx.measureText(label).width + padX * 2;
  const h = 44;
  ctx.save();
  if (opts.solid) {
    ctx.fillStyle = rgba(accent, 0.9);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.10)";
  }
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = opts.solid ? rgba(accent, 1) : "rgba(255,255,255,0.22)";
  ctx.stroke();
  ctx.fillStyle = opts.solid ? "#0d0d12" : "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + padX, y + h / 2 + 1);
  ctx.restore();
  return w;
}

export async function buildCard(a) {
  ensureFonts();
  const accent = hexToRgb(a?.images?.color, [124, 92, 255]);

  const [bannerImg, posterImg] = await Promise.all([
    loadRemote(a?.images?.banner || a?.images?.cover || a?.images?.poster),
    loadRemote(a?.images?.poster || a?.images?.cover)
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Base fill.
  ctx.fillStyle = "#0b0b10";
  ctx.fillRect(0, 0, W, H);

  // Background banner, blurred + zoomed for the AE look.
  if (bannerImg) {
    ctx.save();
    try {
      ctx.filter = "blur(18px) brightness(0.55) saturate(1.15)";
    } catch {
      /* filter unsupported: fall back to plain cover + dark overlay below */
    }
    drawCover(ctx, bannerImg, -40, -40, W + 80, H + 80);
    ctx.restore();
  }

  // Dark gradients for legibility.
  const gShade = ctx.createLinearGradient(0, 0, W, 0);
  gShade.addColorStop(0, "rgba(6,6,10,0.92)");
  gShade.addColorStop(0.55, "rgba(6,6,10,0.55)");
  gShade.addColorStop(1, "rgba(6,6,10,0.15)");
  ctx.fillStyle = gShade;
  ctx.fillRect(0, 0, W, H);

  const gVert = ctx.createLinearGradient(0, 0, 0, H);
  gVert.addColorStop(0, "rgba(6,6,10,0.35)");
  gVert.addColorStop(0.5, "rgba(6,6,10,0.0)");
  gVert.addColorStop(1, "rgba(6,6,10,0.85)");
  ctx.fillStyle = gVert;
  ctx.fillRect(0, 0, W, H);

  // Accent glow blobs.
  const glow = ctx.createRadialGradient(160, H - 120, 20, 160, H - 120, 480);
  glow.addColorStop(0, rgba(accent, 0.45));
  glow.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Poster on the right with a coloured glow.
  const pw = 348;
  const ph = 500;
  const px = W - pw - 72;
  const py = (H - ph) / 2;
  if (posterImg) {
    ctx.save();
    ctx.shadowColor = rgba(accent, 0.8);
    ctx.shadowBlur = 55;
    roundRect(ctx, px, py, pw, ph, 22);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, px, py, pw, ph, 22);
    ctx.clip();
    drawCover(ctx, posterImg, px, py, pw, ph);
    ctx.restore();

    ctx.save();
    roundRect(ctx, px, py, pw, ph, 22);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();
    ctx.restore();
  }

  // ---- Left text column ----
  const x = 72;
  let y = 150;
  const textMax = px - x - 56;

  // Kicker line.
  const kicker = [a.type, a.year, (a.status || "").toUpperCase()].filter(Boolean).join("   •   ");
  ctx.font = "600 26px PoppinsS";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = rgba(accent, 1);
  ctx.fillText(kicker.toUpperCase(), x, y);
  y += 22;

  // Accent underline.
  ctx.fillStyle = rgba(accent, 1);
  roundRect(ctx, x, y, 64, 6, 3);
  ctx.fill();
  y += 46;

  // Title.
  const titleText = a.title?.english || a.title?.default || "Unknown";
  ctx.font = "800 72px PoppinsX";
  const titleLines = wrapText(ctx, titleText, textMax, 3);
  ctx.save();
  ctx.shadowColor = rgba(accent, 0.6);
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#ffffff";
  for (const line of titleLines) {
    y += 74;
    ctx.fillText(line, x, y);
  }
  ctx.restore();

  // Secondary title (romaji/original) — always Latin so it renders reliably.
  const secondary =
    a.title?.default && a.title.default !== titleText ? a.title.default : null;
  if (secondary) {
    y += 42;
    ctx.font = "400 28px PoppinsR";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    const sub = wrapText(ctx, secondary, textMax, 1)[0];
    ctx.fillText(sub, x, y);
  }

  // Score badges.
  y += 60;
  let bx = x;
  const mal = a.ratings?.mal?.score;
  const imdb = a.ratings?.imdb?.rating;
  const anilistScore = a.ratings?.anilist?.averageScore;
  if (mal) bx += pill(ctx, bx, y, `MAL  ${mal}`, accent, { solid: true }) + 14;
  if (imdb) bx += pill(ctx, bx, y, `IMDb  ${imdb}`, accent) + 14;
  if (anilistScore) bx += pill(ctx, bx, y, `AniList  ${anilistScore}`, accent) + 14;
  if (a.episodes) bx += pill(ctx, bx, y, `${a.episodes} eps`, accent) + 14;

  // Genres.
  if (a.genres?.length) {
    y += 64;
    let gx = x;
    for (const g of a.genres.slice(0, 4)) {
      const gw = pill(ctx, gx, y, g, accent);
      gx += gw + 12;
      if (gx > textMax) break;
    }
  }

  // Next release line.
  const nr = a.expectedNextRelease;
  if (nr) {
    y += 70;
    ctx.font = "600 26px PoppinsS";
    ctx.fillStyle = rgba(accent, 1);
    const label =
      nr.kind === "episode"
        ? `Next: Episode ${nr.episode} in ${nr.inDays} day(s)`
        : `Next season: ${nr.title || "announced"}${nr.date ? " • " + nr.date : ""}`;
    ctx.fillText(label, x, y);
  }

  // Footer: studio + brand mark.
  ctx.font = "600 24px PoppinsS";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  const studio = (a.studios || [])[0];
  if (studio) ctx.fillText(studio, x, H - 56);

  ctx.font = "800 26px PoppinsX";
  ctx.fillStyle = rgba(accent, 1);
  const brand = "ANIME • AE CARD";
  const bw = ctx.measureText(brand).width;
  ctx.fillText(brand, W - bw - 72, H - 40);

  return canvas.toBuffer("image/png");
}
