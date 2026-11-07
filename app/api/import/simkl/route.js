// Read a Simkl account's watched films and series into the personal library.
//
// `POST /api/import/simkl` with either
//   { code, codeVerifier, redirectUri }  right after "Sign in with Simkl", or
//   { refreshToken }                     on every later visit,
// answers { movies, refreshToken }. The token exchange happens here rather than in the
// browser because Simkl documents no CORS for it. Nothing is stored server side: the
// browser keeps the refresh token (read-only scope, 180 days) and merges the rows itself,
// the same way a Letterboxd ZIP import does.

import { USER_AGENT } from "../../../lib/user-agent.mjs";
import { SIMKL_CLIENT_ID, SIMKL_API, libraryFromSimkl, simklApiUrl } from "../../../lib/connectors/simkl.mjs";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };
const TIMEOUT_MS = 15_000;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStore });
}

const isText = (value, max = 4096) => typeof value === "string" && value.length > 0 && value.length <= max;

export function createSimklImportHandler({
  clientId = SIMKL_CLIENT_ID,
  fetchImpl = (...args) => fetch(...args),
  logError = (...args) => console.error(...args),
} = {}) {
  async function requestToken(fields) {
    const response = await fetchImpl(`${SIMKL_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({ client_id: clientId, ...fields }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      logError("Simkl token request failed", { status: response.status, error: payload?.error });
      return null;
    }
    return payload;
  }

  async function readList(path, accessToken) {
    const response = await fetchImpl(simklApiUrl(path, { clientId, extended: "ids_only" }), {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Simkl ${path} answered ${response.status}`);
    // An empty list comes back as null or an empty body.
    return (await response.json().catch(() => null)) ?? {};
  }

  return async function POST(request) {
    const body = await request.json().catch(() => ({}));

    let fields;
    if (isText(body?.refreshToken)) {
      fields = { grant_type: "refresh_token", refresh_token: body.refreshToken };
    } else if (isText(body?.code) && isText(body?.codeVerifier, 128) && isText(body?.redirectUri, 512)) {
      fields = {
        grant_type: "authorization_code",
        code: body.code,
        code_verifier: body.codeVerifier,
        redirect_uri: body.redirectUri,
      };
    } else {
      return jsonError("Sign in with Simkl first", 400);
    }

    let token;
    try {
      token = await requestToken(fields);
    } catch (error) {
      logError("Simkl token request threw", { name: error?.name });
      return jsonError("Simkl is not answering right now. Try again in a minute.", 502);
    }
    // A refused refresh means the person revoked GloryMap or 180 days passed: sign in again.
    if (!token) return jsonError("Simkl did not accept the sign-in. Please connect Simkl again.", 401);

    try {
      const [movies, shows] = await Promise.all([
        readList("/sync/all-items/movies/completed", token.access_token),
        readList("/sync/all-items/shows/all", token.access_token),
      ]);
      return Response.json(
        { movies: libraryFromSimkl({ movies, shows }), refreshToken: token.refresh_token ?? body.refreshToken ?? null },
        { headers: noStore },
      );
    } catch (error) {
      logError("Simkl list read failed", { message: error?.message });
      return jsonError("Simkl signed you in but your list could not be read. Try again in a minute.", 502);
    }
  };
}

export const POST = createSimklImportHandler();
