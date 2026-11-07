// The browser-side keys for "Sign in with Simkl", shared by the map and the callback page.
//
// The PKCE verifier and state live in sessionStorage for the one round trip to simkl.com.
// The refresh token ends up on the account (user metadata, read-only scope, 180 days), so
// each visit on any device pulls new watches without asking to sign in again.

export const SIMKL_PKCE_KEY = "glorymap-simkl-pkce";
// Films and the refresh token the callback fetched, handed to the map page, which merges
// the films and saves the token onto the signed-in account.
export const SIMKL_IMPORT_KEY = "glorymap-simkl-import";
