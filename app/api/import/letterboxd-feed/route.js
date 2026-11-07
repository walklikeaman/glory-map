// Sync a public Letterboxd profile into the personal library, by username alone.
//
// `GET /api/import/letterboxd-feed?handle=dave` reads the profile's RSS feed and answers
// with the films in library shape. Nothing is stored here: the browser merges the rows
// into the list it already keeps, the same way a ZIP import does, so a guest can use it
// without an account. The feed carries only the most recent diary entries, so this is
// how new watches arrive after the full ZIP export did the first fill.

import {
  letterboxdHandleFrom,
  letterboxdRssUrl,
  libraryFromLetterboxdFeed,
  parseLetterboxdRss,
} from "../../../lib/connectors/letterboxd-rss.mjs";

export const runtime = "nodejs";

// Letterboxd 403s a bare server request; a browser User-Agent gets the feed.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FEED_TIMEOUT_MS = 10_000;

// The feed is public and changes when its owner logs a film. Fifteen minutes at the edge
// keeps a reload from hitting Letterboxd again without hiding tonight's watch for long.
const okHeaders = { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" };
const errorHeaders = { "Cache-Control": "no-store" };

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: errorHeaders });
}

export function createLetterboxdFeedHandler({
  fetchImpl = (...args) => fetch(...args),
  logError = (...args) => console.error(...args),
} = {}) {
  return async function GET(request) {
    const handle = letterboxdHandleFrom(new URL(request.url).searchParams.get("handle"));
    if (!handle) return jsonError("Enter a Letterboxd username, like the one in letterboxd.com/username", 400);

    let response;
    try {
      response = await fetchImpl(letterboxdRssUrl(handle), {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      });
    } catch (error) {
      logError("Letterboxd feed fetch failed", { name: error?.name });
      return jsonError("Letterboxd is not answering right now. Try again in a minute.", error?.name === "TimeoutError" ? 504 : 502);
    }

    if (response.status === 404) return jsonError(`There is no Letterboxd profile called ${handle}.`, 404);
    if (!response.ok) {
      logError("Letterboxd feed refused", { status: response.status });
      return jsonError("Letterboxd did not hand over the profile. Try again later, or upload the ZIP export.", 502);
    }

    const movies = libraryFromLetterboxdFeed(parseLetterboxdRss(await response.text()));
    return Response.json({ handle, movies }, { headers: okHeaders });
  };
}

export const GET = createLetterboxdFeedHandler();
