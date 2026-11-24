import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadSharedShot } from "../app/api/shots/route.js";
import { frameUrlForCard, shotIdFromParam, shotPageModel, shotPath } from "../app/lib/shot-page.mjs";

const ID = "33333333-3333-4333-8333-333333333333";
const row = (over = {}) => ({
  id: ID, status: "approved", kind: "photo", caption: null, reference_url: null,
  storage_path: `u/${ID}.jpg`, place_name: "Trafalgar Square", created_at: "2026-11-20T10:00:00Z", ...over,
});

test("only a uuid makes a shot path", () => {
  assert.equal(shotIdFromParam(ID.toUpperCase()), ID);
  assert.equal(shotIdFromParam("../etc"), null);
  assert.equal(shotPath(ID), `/shot/${ID}`);
  assert.equal(shotPath("nope"), null);
});

test("a held-back or rejected shot has no page", () => {
  assert.equal(shotPageModel(row({ status: "pending" })), null);
  assert.equal(shotPageModel(row({ status: "rejected" })), null);
  assert.equal(shotPageModel(null), null);
  assert.ok(shotPageModel(row()));
});

test("a photo and a recreation are titled for what they are", () => {
  const photo = shotPageModel(row());
  assert.equal(photo.title, "A visitor's shot of Trafalgar Square");
  assert.equal(photo.frameUrl, null);
  const remake = shotPageModel(row({ kind: "recreation", reference_url: "https://image.tmdb.org/t/p/w780/a.jpg", caption: "Same bench" }));
  assert.equal(remake.title, "A recreated shot at Trafalgar Square");
  assert.equal(remake.frameUrl, "https://image.tmdb.org/t/p/w780/a.jpg");
  assert.equal(remake.description, "Same bench");
  assert.equal(shotPageModel(row({ place_name: "" })).title, "A visitor's shot of a film location");
});

test("the card fetches a frame only from TMDB's image host", () => {
  assert.equal(frameUrlForCard("https://image.tmdb.org/t/p/w780/a.jpg"), "https://image.tmdb.org/t/p/w780/a.jpg");
  assert.equal(frameUrlForCard("http://image.tmdb.org/t/p/a.jpg"), null);
  assert.equal(frameUrlForCard("https://169.254.169.254/latest"), null);
  assert.equal(frameUrlForCard("https://evil.example/a.jpg"), null);
  // A photo's reference is never fetched, whatever it says.
  assert.equal(shotPageModel(row({ reference_url: "https://image.tmdb.org/t/p/a.jpg" })).frameUrl, null);
});

test("loadSharedShot signs the photo and hides the storage path", async () => {
  const store = {
    async getApprovedShot(id) { return id === ID ? row() : null; },
    async signUrls(paths) { return Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])); },
  };
  const shot = await loadSharedShot(ID, { store });
  assert.equal(shot.url, `https://signed/u/${ID}.jpg`);
  assert.equal("storagePath" in shot, false);
  assert.equal(await loadSharedShot("44444444-4444-4444-8444-444444444444", { store }), null);
  assert.equal(await loadSharedShot("not-a-uuid", { store }), null);
  assert.equal(await loadSharedShot(ID, { store: null }), null);
});

test("a failed read throws, so the page answers 500 and not 404", async () => {
  const store = { async getApprovedShot() { throw new Error("db down"); }, async signUrls() { return {}; } };
  await assert.rejects(loadSharedShot(ID, { store }), /db down/);
  const unsigned = { async getApprovedShot() { return row(); }, async signUrls() { return {}; } };
  await assert.rejects(loadSharedShot(ID, { store: unsigned }), /signed/);
});

test("an approved shot on the place card offers Share", () => {
  const source = readFileSync(new URL("../app/components/VisitorShots.jsx", import.meta.url), "utf8");
  assert.match(source, /shot\.status === "approved"/);
  assert.match(source, /shotPath\(shot\.id\)/);
});
