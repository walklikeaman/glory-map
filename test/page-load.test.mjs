import assert from "node:assert/strict";
import test from "node:test";

import { readRoute } from "../app/lib/page-load.mjs";

test("a route's 404 is a missing page", async () => {
  assert.equal(await readRoute(Response.json({ error: "No such city" }, { status: 404 }), "city"), null);
});

test("a route that failed is an error, never a 404", async () => {
  // 03.11: a statement timeout (502) on a letter of the directory rendered "not found".
  for (const status of [500, 502, 503]) {
    await assert.rejects(readRoute(Response.json({ error: "down" }, { status }), "The directory"), /unavailable \(\d+\)/);
  }
});

test("an answer is handed back as JSON", async () => {
  assert.deepEqual(await readRoute(Response.json({ letter: "n" }), "letter"), { letter: "n" });
});
