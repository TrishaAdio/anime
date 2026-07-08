// Text helpers for anime data.

// Clean a MAL synopsis: drop the boilerplate credit/source notes and tidy
// whitespace. Optionally truncate.
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
