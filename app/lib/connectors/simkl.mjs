// Simkl connector: sign in with Simkl (OAuth 2.0 + PKCE, no client secret) and read what
// the person has watched. Simkl imports from IMDb, Letterboxd, Netflix and others, so it is
// the one real account link that also covers IMDb, which has no user API of its own.
//
// Pure module: URL builders, the PKCE pair (Web Crypto, present in browsers and Node 22)
// and the row mapper. The network calls live in `app/api/import/simkl/route.js`.
//
// Docs: api.simkl.org (authentication.md, api-reference/simkl/get-all-items.md).

import { RATING_SCALE } from "../media-sources.mjs";

// Public by design: a PKCE app has no secret, and the id is visible in every sign-in URL.
export const SIMKL_CLIENT_ID =
  process.env.NEXT_PUBLIC_SIMKL_CLIENT_ID ||
  "db6b24ee057c6ac3d6c5a0f46db91eb088f7cf04cbbc42a1c41104b19570e843";

export const SIMKL_AUTHORIZE_URL = "https://simkl.com/oauth2/authorize";
export const SIMKL_API = "https://api.simkl.com";
export const SIMKL_ISSUER = "https://simkl.com";
export const SIMKL_CALLBACK_PATH = "/auth/simkl";

// Where Simkl sends the person back. It must match a Redirect URL registered on the app
// byte for byte, so it is built from the page's own origin and this one path.
export function simklRedirectUri(origin) {
  return `${String(origin).replace(/\/+$/, "")}${SIMKL_CALLBACK_PATH}`;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32, cryptoImpl = globalThis.crypto) {
  return base64Url(cryptoImpl.getRandomValues(new Uint8Array(byteLength)));
}

// RFC 7636: a 43-character verifier from 32 random bytes, and its S256 challenge.
export async function createPkcePair(cryptoImpl = globalThis.crypto) {
  const verifier = randomToken(32, cryptoImpl);
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function simklAuthorizeUrl({ clientId = SIMKL_CLIENT_ID, redirectUri, state, codeChallenge }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    // Read only: GloryMap never writes to a Simkl account.
    scope: "media:read",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${SIMKL_AUTHORIZE_URL}?${params}`;
}

// Every Simkl request carries the app's identity as query parameters.
export function simklApiUrl(path, { clientId = SIMKL_CLIENT_ID, ...query } = {}) {
  const params = new URLSearchParams({ client_id: clientId, "app-name": "glorymap", "app-version": "1.0", ...query });
  return `${SIMKL_API}${path}?${params}`;
}

// Statuses that mean "I have seen this", for a series as much as a film. Plan-to-watch is
// a wish list, and dropped is a verdict against the work, so neither puts it on the map.
const WATCHED_STATUSES = new Set(["completed", "watching", "hold"]);

function rowFrom(item, key) {
  const work = item?.[key];
  const title = (work?.title ?? item?.title)?.trim?.();
  if (!title) return null;
  if (item.status && !WATCHED_STATUSES.has(item.status)) return null;

  const ids = work?.ids ?? {};
  const year = Number.isInteger(work?.year ?? item?.year) ? (work?.year ?? item?.year) : null;
  const rating = Number(item.user_rating);
  const imdbId = /^tt\d+$/.test(ids.imdb ?? "") ? ids.imdb : null;
  const kindPath = key === "movie" ? "movies" : "tv";

  return {
    id: imdbId || `simkl:${ids.simkl ?? title.toLowerCase()}`,
    title,
    year,
    // Simkl rates 1 to 10, already the library's scale.
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    ratingScale: RATING_SCALE,
    watchedDate: item.last_watched_at ?? null,
    url: ids.simkl ? `https://simkl.com/${kindPath}/${ids.simkl}${ids.slug ? `/${ids.slug}` : ""}` : null,
    imdbId,
    sources: ["simkl"],
  };
}

// `GET /sync/all-items/...` answers { movies: [...] } or { shows: [...] }, or null when the
// list is empty. Rows come out in the personal library's shape.
export function libraryFromSimkl({ movies, shows } = {}) {
  return [
    ...(Array.isArray(movies?.movies) ? movies.movies.map((item) => rowFrom(item, "movie")) : []),
    ...(Array.isArray(shows?.shows) ? shows.shows.map((item) => rowFrom(item, "show")) : []),
  ].filter(Boolean);
}
