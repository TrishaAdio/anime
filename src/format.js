// Telegram-ready caption formatting for the bot chat.
//
// Style rules (kept intentionally lean):
//  - HTML parse mode. Escape all dynamic text so it can never break the message.
//  - Use <b> for emphasis and <blockquote> for the stat block.
//  - The synopsis goes in an <blockquote expandable> so it collapses in chat.
//  - No <i> italics.
//  - Data only: no "how to use" hints or filler.

const MAX_CAPTION = 1000; // stay safely under Telegram's media-caption limit

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Clean a MAL synopsis: drop the boilerplate credit/source notes and tidy
// whitespace. Optionally truncate (used for the caption).
export function cleanSynopsis(text, { maxLen } = {}) {
  if (!text) return "";
  let s = String(text)
    .replace(/\[Written by[^\]]*\]/gi, "")
    .replace(/\(Source:[^)]*\)/gi, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (maxLen && s.length > maxLen) {
    s = s.slice(0, maxLen - 1).trimEnd() + "…";
  }
  return s;
}

/**
 * Build a Telegram HTML caption for an anime, matching the bot's card style.
 * Returns a string ready to send with parse_mode="HTML".
 */
export function buildCaptionHtml(a, { page, count } = {}) {
  const title = escapeHtml(a.title?.english || a.title?.default || "Unknown");

  // Stat block lines (omit whatever is missing).
  const lines = [];

  const mal = a.ratings?.mal?.score;
  const imdb = a.ratings?.imdb?.rating;
  if (mal || imdb) {
    const parts = [];
    if (mal) parts.push(`⭐ <b>Score</b> ${mal}`);
    if (imdb) parts.push(`${imdb} IMDb`);
    lines.push(parts.join(" · "));
  }

  const fmt = [];
  if (a.type) fmt.push(escapeHtml(a.type));
  if (a.episodes) fmt.push(`${a.episodes} eps`);
  if (a.status) fmt.push(escapeHtml(a.status));
  if (fmt.length) lines.push(`📺 ${fmt.join(" · ")}`);

  const when = [capitalize(a.season), a.year].filter(Boolean).join(" ");
  if (when) lines.push(`📅 ${escapeHtml(when)}`);

  if (a.genres?.length) lines.push(`✨ ${escapeHtml(a.genres.slice(0, 4).join(", "))}`);

  const nr = a.expectedNextRelease;
  if (nr) {
    if (nr.kind === "episode") lines.push(`🔜 <b>Ep ${nr.episode}</b> in ${nr.inDays}d`);
    else if (nr.title) lines.push(`🔜 ${escapeHtml(nr.title)}${nr.date ? " · " + nr.date : ""}`);
  }

  const statBlock = lines.length ? `<blockquote>${lines.join("\n")}</blockquote>` : "";

  // Story in a collapsible blockquote. Budget the length so the whole caption
  // stays under Telegram's limit.
  const header = `<b>${title}</b>\n${statBlock}`;
  const budget = Math.max(200, MAX_CAPTION - header.length - 40);
  const story = cleanSynopsis(a.synopsis, { maxLen: budget });
  const storyBlock = story ? `\n<blockquote expandable>${escapeHtml(story)}</blockquote>` : "";

  return `${header}${storyBlock}`.trim();
}
