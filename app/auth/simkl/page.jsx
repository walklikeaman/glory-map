"use client";

// Where Simkl sends the person back after "Sign in with Simkl". It checks the state, trades
// the code for a token through our server, hands the films to the map page and goes home.
// See [[simkl]] in app/lib/connectors/simkl.mjs.

import { useEffect, useState } from "react";

import { SIMKL_ISSUER, simklRedirectUri } from "../../lib/connectors/simkl.mjs";
import { SIMKL_IMPORT_KEY, SIMKL_PKCE_KEY } from "../../lib/simkl-session.mjs";

export default function SimklCallback() {
  const [message, setMessage] = useState("Connecting Simkl…");

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      let pending = null;
      try { pending = JSON.parse(sessionStorage.getItem(SIMKL_PKCE_KEY) || "null"); } catch { /* none */ }
      try { sessionStorage.removeItem(SIMKL_PKCE_KEY); } catch { /* nothing to clear */ }

      if (params.get("error")) {
        setMessage("Simkl sign-in was cancelled. Nothing was imported.");
        return;
      }
      const issuer = params.get("iss");
      if (!pending?.state || params.get("state") !== pending.state || (issuer && issuer !== SIMKL_ISSUER)) {
        setMessage("This sign-in link has expired. Start again from My movies.");
        return;
      }

      try {
        const response = await fetch("/api/import/simkl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: params.get("code"),
            codeVerifier: pending.verifier,
            redirectUri: simklRedirectUri(window.location.origin),
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Simkl could not be reached.");
        sessionStorage.setItem(SIMKL_IMPORT_KEY, JSON.stringify({
          movies: payload.movies ?? [],
          refreshToken: payload.refreshToken ?? null,
        }));
        window.location.replace("/");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Simkl could not be reached.");
      }
    })();
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#111", color: "#eee", font: "16px system-ui, sans-serif", textAlign: "center" }}>
      <div>
        <p>{message}</p>
        <p><a href="/" style={{ color: "#f0a83c" }}>Back to the map</a></p>
      </div>
    </main>
  );
}
