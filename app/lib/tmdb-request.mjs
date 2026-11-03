// One TMDB detail request, with whichever credential works (#68 moved it out of
// /api/artwork so the genre lookup can share it).

import { tmdbDetailUrl } from "./work-posters.mjs";

// TMDB has two credential schemes: a v3 `api_key` query parameter and a v4 bearer
// token. They are NOT interchangeable, and the two env vars are easy to fill in
// crosswise — production held a value that 401s as a bearer token. So both are tried,
// bearer first, rather than trusting one and reporting the title as art-less.
export async function requestTmdb(kind, tmdbId, { env, fetchImpl, timeoutMs }) {
  const attempts = [];
  if (env.TMDB_API_READ_ACCESS_TOKEN) {
    attempts.push({
      scheme: "bearer",
      url: tmdbDetailUrl(kind, tmdbId),
      headers: { Accept: "application/json", Authorization: `Bearer ${env.TMDB_API_READ_ACCESS_TOKEN}` },
    });
  }
  if (env.TMDB_API_KEY) {
    attempts.push({
      scheme: "api_key",
      url: tmdbDetailUrl(kind, tmdbId, { apiKey: env.TMDB_API_KEY }),
      headers: { Accept: "application/json" },
    });
  }

  let last = null;
  const tried = [];
  for (const attempt of attempts) {
    if (!attempt.url) continue;
    tried.push(attempt.scheme);
    const response = await fetchImpl(attempt.url, {
      headers: attempt.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response?.ok) return { response, scheme: attempt.scheme, tried };
    last = { response, scheme: attempt.scheme, tried };
    // 401/403 means THIS credential is wrong; another scheme may still work. Any other
    // status is about the title or the service, so stop rather than retry pointlessly.
    if (response?.status !== 401 && response?.status !== 403) break;
  }
  return last;
}
