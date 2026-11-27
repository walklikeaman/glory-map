import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cardPosterUrl, mapLinkTitle, sharedWorkId, trailOrderFromSearchParams, workShareModel,
} from "../app/lib/work-share-card.mjs";

const ID = "11111111-1111-4111-8111-111111111111";
const payload = (over = {}) => ({
  work: { id: ID, title: "Notting Hill", year: 1999, poster: "https://image.tmdb.org/t/p/w92/np.jpg", ...over.work },
  places: [{ name: "Portobello Road" }, { name: "The Travel Book Co." }, { name: "" }, { name: "Kenwood House" }, { name: "Ritz" }],
  candidates: [],
  candidates_total: 0,
  ...over,
});

test("only a uuid in ?work= is a shared work", () => {
  assert.equal(sharedWorkId({ work: ID.toUpperCase() }), ID);
  assert.equal(sharedWorkId({ work: [ID, "x"] }), ID);
  assert.equal(sharedWorkId({ work: "notting-hill" }), null);
  assert.equal(sharedWorkId({}), null);
  assert.equal(sharedWorkId(undefined), null);
});

test("the card asks TMDB for a bigger poster and fetches nothing else", () => {
  assert.equal(cardPosterUrl("https://image.tmdb.org/t/p/w92/np.jpg"), "https://image.tmdb.org/t/p/w500/np.jpg");
  assert.equal(cardPosterUrl("https://evil.example/t/p/w92/np.jpg"), null);
  assert.equal(cardPosterUrl("http://image.tmdb.org/t/p/w92/np.jpg"), null);
  assert.equal(cardPosterUrl(null), null);
});

test("the model counts places and names the first three, never a scene", () => {
  const model = workShareModel(payload());
  assert.equal(model.name, "Notting Hill (1999)");
  assert.equal(model.placesLine, "5 places on the map");
  assert.deepEqual(model.placeNames, ["Portobello Road", "The Travel Book Co.", "Kenwood House"]);
  assert.match(model.path, new RegExp(`^/work/notting-hill-1999--${ID}$`));
  assert.equal("scenes" in model, false);
  assert.equal(mapLinkTitle(model), "Notting Hill (1999) on the map · GloryMap");
});

test("a work with only candidates says they are unconfirmed", () => {
  const model = workShareModel(payload({ places: [], candidates_total: 4 }));
  assert.equal(model.placesLine, "4 unconfirmed places");
  assert.match(model.description, /^4 unconfirmed places for Notting Hill/);
  assert.equal(workShareModel(payload({ places: [{ name: "A" }] })).placesLine, "1 place on the map");
  assert.equal(workShareModel(payload({ places: [] })).placesLine, "No places on the map yet");
});

test("a walking-order link is titled as a walk", () => {
  assert.equal(trailOrderFromSearchParams({ trail: "walk" }), "walk");
  assert.equal(trailOrderFromSearchParams({ trail: "nope" }), "story");
  const model = workShareModel(payload(), { trailOrder: "walk" });
  assert.equal(mapLinkTitle(model), "Walk Notting Hill (1999) · GloryMap");
});

test("no work, no card", () => {
  assert.equal(workShareModel(null), null);
  assert.equal(workShareModel({ work: { id: ID, title: null } }), null);
  assert.equal(workShareModel({ work: { id: null, title: "X" } }), null);
});

test("the map page stays a server shell over the client app", () => {
  const page = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /"use client"/);
  assert.match(page, /export async function generateMetadata/);
  assert.match(page, /loadWorkForPreview/);
  const client = readFileSync(new URL("../app/HomeClient.jsx", import.meta.url), "utf8");
  assert.match(client, /^"use client"/);
  assert.match(client, /ssr: false/);
});
