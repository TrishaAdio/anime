// Live anime news by searching the open web via Google News RSS.
// No API key required. We parse the RSS feed with light regex (the feed
// format is stable and simple).

import { getText } from "../http.js";
import { cached } from "../cache.js";

function decode(str = "") {
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
}

/**
 * Search live news for a query. Returns up to `limit` recent items:
 * { title, link, source, publishedAt }.
 */
export async function searchNews(query, limit = 10) {
  const key = `news:${query.toLowerCase()}:${limit}`;
  return cached(key, 20 * 60 * 1000, async () => {
    const url =
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent(query) +
      "&hl=en-US&gl=US&ceid=US:en";
    let body = "";
    try {
      ({ body } = await getText(url, { timeout: 12000 }));
    } catch {
      return [];
    }

    const items = [];
    const blocks = body.split("<item>").slice(1);
    for (const raw of blocks) {
      const block = raw.split("</item>")[0];
      const title = tag(block, "title");
      if (!title) continue;
      const rawTitle = title;
      // Google News titles look like "Headline - Source".
      const dash = rawTitle.lastIndexOf(" - ");
      const headline = dash > 0 ? rawTitle.slice(0, dash) : rawTitle;
      const sourceFromTitle = dash > 0 ? rawTitle.slice(dash + 3) : null;
      items.push({
        title: headline,
        link: tag(block, "link"),
        source: tag(block, "source") || sourceFromTitle,
        publishedAt: tag(block, "pubDate")
      });
      if (items.length >= limit) break;
    }
    return items;
  });
}
