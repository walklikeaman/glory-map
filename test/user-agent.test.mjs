import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { isTimeout, upstreamFailed } from "../app/lib/upstream-error.mjs";
import { CONTACT_USER_AGENT, USER_AGENT, WIKIDATA_SPARQL } from "../app/lib/user-agent.mjs";

test("both identities name the product, one version, and the site", () => {
  for (const agent of [USER_AGENT, CONTACT_USER_AGENT]) {
    assert.match(agent, /^GloryMap\/1\.1 \(https:\/\/glory-map\.vercel\.app\//);
  }
  assert.match(CONTACT_USER_AGENT, /@/);
  assert.equal(USER_AGENT.includes("@"), false, "the owner's address goes only where it already went");
});

// The whole point of #85: no file writes its own identity or endpoint again.
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(mjs|js|jsx)$/.test(name) ? [path] : [];
  });
}

test("no file but user-agent.mjs spells out a User-Agent or the SPARQL endpoint", () => {
  const offenders = sources("app")
    .filter((path) => !path.endsWith("user-agent.mjs"))
    .filter((path) => /GloryMap[\w-]*\/\d|query\.wikidata\.org\/sparql/.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
  assert.equal(WIKIDATA_SPARQL, "https://query.wikidata.org/sparql");
});

test("the contact address is sent only by the Wikimedia clients that already sent it", () => {
  const senders = sources("app").filter((path) => /CONTACT_USER_AGENT/.test(readFileSync(path, "utf8")) && !path.endsWith("user-agent.mjs"));
  assert.deepEqual(senders.map((path) => path.replace(/^app\/lib\//, "")).sort(), ["inverted-places.mjs", "wikidata-sparql.mjs", "wikipedia-source.mjs"]);
});

test("an upstream that did not answer is a 504, any other failure a 502, in the route's words", async () => {
  const words = { timeoutMessage: "City search timed out", failureMessage: "Unable to search for a city" };
  for (const name of ["TimeoutError", "AbortError"]) {
    const response = upstreamFailed({ name }, words);
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: "City search timed out" });
  }
  const failed = upstreamFailed(new Error("ECONNRESET"), words);
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: "Unable to search for a city" });
  assert.equal(isTimeout(null), false);
});
