import assert from "node:assert/strict";
import test from "node:test";

import { createShotsHandlers } from "../app/api/shots/route.js";

const USER = "11111111-1111-4111-8111-111111111111";
const SHOT = "33333333-3333-4333-8333-333333333333";
const PATH = `${USER}/${SHOT}.jpg`;
const NOW = new Date("2026-11-03T10:00:00Z");

function fakeStore(overrides = {}) {
  const calls = { updates: [], removed: [], inserted: [] };
  const store = {
    calls,
    async getUser(token) { return token === "good" ? { id: USER } : null; },
    async insertShot(token, row) { calls.inserted.push({ token, row }); return { id: "row-1" }; },
    async listShots(placeKey, viewerId) {
      calls.listedFor = viewerId;
      return [
        { id: "a", user_id: "x", status: "approved", storage_path: "x/a.jpg", kind: "photo" },
        { id: "b", user_id: USER, status: "pending", storage_path: PATH, kind: "recreation" },
      ];
    },
    async signUrls(paths) { return Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])); },
    async downloadShot() { return new Uint8Array([1, 2, 3]); },
    async updateShot(id, patch) { calls.updates.push({ id, patch }); },
    async removeObject(path) { calls.removed.push(path); },
    async countCheckedSince() { return 0; },
    async countSharedSince() { return 0; },
    ...overrides,
  };
  return store;
}

const post = (body, token = "good") => new Request("http://x/api/shots", {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const BODY = { placeKey: "Q1", storagePath: PATH, kind: "photo", placeName: "Somewhere" };
const ENV = { ANTHROPIC_API_KEY: "k" };

test("a list shows approved shots to everybody and own shots to their author", async () => {
  const { GET } = createShotsHandlers({ env: {}, store: fakeStore() });
  const anon = await (await GET(new Request("http://x/api/shots?place=Q1"))).json();
  assert.deepEqual(anon.shots.map((s) => s.id), ["a"]);
  assert.equal(anon.shots[0].url, "https://signed/x/a.jpg");
  assert.equal("storagePath" in anon.shots[0], false);
  const mine = await (await GET(new Request("http://x/api/shots?place=Q1", { headers: { authorization: "Bearer good" } }))).json();
  assert.deepEqual(mine.shots.map((s) => s.id), ["a", "b"]);
  assert.equal((await GET(new Request("http://x/api/shots"))).status, 400);
});

test("without the database configured the route says so", async () => {
  const { GET, POST } = createShotsHandlers({ env: {}, store: null });
  assert.equal((await GET(new Request("http://x/api/shots?place=Q1"))).status, 503);
  assert.equal((await POST(post(BODY))).status, 503);
});

test("only a signed-in reader can share, and only their own upload", async () => {
  const { POST } = createShotsHandlers({ env: ENV, store: fakeStore(), moderate: async () => ({ verdict: "approve", reason: "ok" }) });
  assert.equal((await POST(post(BODY, null))).status, 401);
  assert.equal((await POST(post(BODY, "bad"))).status, 401);
  assert.equal((await POST(post({ ...BODY, storagePath: `22222222-2222-4222-8222-222222222222/${SHOT}.jpg` }))).status, 400);
});

test("an approved shot is published, a rejected one is deleted from storage", async () => {
  const store = fakeStore();
  const approve = createShotsHandlers({ env: ENV, store, now: () => NOW, moderate: async () => ({ verdict: "approve", reason: "A street." }) });
  const ok = await approve.POST(post(BODY));
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).shot.status, "approved");
  assert.equal(store.calls.inserted[0].row.status, "pending", "it is written pending, then the check decides");
  assert.equal(store.calls.inserted[0].token, "good", "written under the reader's own token");
  assert.equal(store.calls.updates[0].patch.status, "approved");
  assert.equal(store.calls.removed.length, 0);

  const reject = createShotsHandlers({ env: ENV, store, now: () => NOW, moderate: async () => ({ verdict: "reject", reason: "Spam." }) });
  assert.equal((await (await reject.POST(post(BODY))).json()).shot.status, "rejected");
  assert.deepEqual(store.calls.removed, [PATH]);
});

test("a check that cannot run leaves the shot pending, never lost", async () => {
  const noKey = createShotsHandlers({ env: {}, store: fakeStore(), moderate: async () => { throw new Error("must not run"); } });
  assert.equal((await (await noKey.POST(post(BODY))).json()).shot.status, "pending");

  const capped = createShotsHandlers({
    env: { ...ENV, SHOT_MODERATION_DAILY_LIMIT: "5" },
    store: fakeStore({ async countCheckedSince() { return 5; } }),
    moderate: async () => { throw new Error("must not run"); },
  });
  assert.equal((await (await capped.POST(post(BODY))).json()).shot.status, "pending");

  const store = fakeStore();
  const failing = createShotsHandlers({ env: ENV, store, logError: () => {}, moderate: async () => { throw new Error("503"); } });
  const response = await failing.POST(post(BODY));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).shot.status, "pending");
  assert.equal(store.calls.updates.length, 0);
});

test("a failed insert is reported, not hidden", async () => {
  const { POST } = createShotsHandlers({
    env: ENV, logError: () => {},
    store: fakeStore({ async insertShot() { throw new Error("rls"); } }),
  });
  assert.equal((await POST(post(BODY))).status, 502);
});

test("one account cannot spend the day's checks, and its extra upload is removed", async () => {
  const store = fakeStore({ async countSharedSince() { return 20; } });
  const { POST } = createShotsHandlers({ env: ENV, store, moderate: async () => { throw new Error("must not run"); } });
  assert.equal((await POST(post(BODY))).status, 429);
  assert.deepEqual(store.calls.removed, [PATH]);
  assert.equal(store.calls.inserted.length, 0);
});

test("a failed insert removes the orphaned upload", async () => {
  const store = fakeStore({ async insertShot() { throw new Error("rls"); } });
  const { POST } = createShotsHandlers({ env: ENV, logError: () => {}, store });
  assert.equal((await POST(post(BODY))).status, 502);
  assert.deepEqual(store.calls.removed, [PATH]);
});

test("a failing token check lists public shots instead of failing the list", async () => {
  const store = fakeStore({ async getUser() { throw new Error("network"); } });
  const { GET } = createShotsHandlers({ env: {}, store });
  const response = await GET(new Request("http://x/api/shots?place=Q1", { headers: { authorization: "Bearer good" } }));
  assert.equal(response.status, 200);
  assert.equal(store.calls.listedFor, null);
});

test("an empty limit setting falls back to the default instead of switching checks off", async () => {
  const store = fakeStore();
  const { POST } = createShotsHandlers({
    env: { ...ENV, SHOT_MODERATION_DAILY_LIMIT: "" }, store, now: () => NOW,
    moderate: async () => ({ verdict: "approve", reason: "ok" }),
  });
  assert.equal((await (await POST(post(BODY))).json()).shot.status, "approved");
});
