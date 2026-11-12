import assert from "node:assert/strict";
import test from "node:test";

import { readRoute, retryOn502 } from "../app/lib/page-load.mjs";

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

test("a 502 gets one more try, and a good second answer wins", async () => {
  // 12.11: the first catalogue query after a quiet spell timed out; the next took 0.3 s.
  const answers = [Response.json({}, { status: 502 }), Response.json({ letter: "n" })];
  const waited = [];
  const response = await retryOn502(async () => answers.shift(), { wait: async (ms) => waited.push(ms) });
  assert.deepEqual(await readRoute(response, "The directory"), { letter: "n" });
  assert.deepEqual(waited, [1500]);
});

test("only a 502 is retried, and only so many times", async () => {
  let calls = 0;
  const wait = async () => {};
  await retryOn502(async () => { calls += 1; return Response.json({}, { status: 404 }); }, { wait });
  assert.equal(calls, 1);
  calls = 0;
  const last = await retryOn502(async () => { calls += 1; return Response.json({}, { status: 502 }); }, { wait });
  assert.equal(calls, 2);
  assert.equal(last.status, 502);
});
