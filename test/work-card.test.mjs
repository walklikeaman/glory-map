import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUTE_BLOCK_DISTANCES,
  coverageLine,
  placeBlocks,
  stillsCaption,
  workLinks,
} from "../app/lib/work-card.mjs";
import { slugifyTitle, workIdFromSlug, workPath, workSlug } from "../app/lib/work-url.mjs";

const ID = "d0296dd7-a372-4fe1-869b-2e189a002cce";
const place = (overrides = {}) => ({
  id: "p1", name: "Glencoe", sentence: "Skyfall was filmed at Glencoe.",
  distance: 0, routable: true, precision: "Exact point", ...overrides,
});

// --- the address a film can be sent to ------------------------------------------

test("a work has a URL that says what it is", () => {
  assert.equal(workPath({ id: ID, title: "Skyfall", year: 2012 }), `/work/skyfall-2012--${ID}`);
  assert.equal(workIdFromSlug(`skyfall-2012--${ID}`), ID);
});

test("the readable half is decorative and the link survives a retitle", () => {
  // A title corrected later must not break links already sent, so the parser reads only
  // the id and ignores everything before it.
  assert.equal(workIdFromSlug(`some-other-title-1999--${ID}`), ID);
  assert.equal(workIdFromSlug(ID), ID);
});

test("the separator is a double hyphen because titles are spelled with single ones", () => {
  // Splitting on a single hyphen would cut "the-third-man" in the wrong place.
  const slug = workSlug({ id: ID, title: "The Third Man", year: 1949 });
  assert.equal(slug, `the-third-man-1949--${ID}`);
  assert.equal(workIdFromSlug(slug), ID);
});

test("a slug that is not a work resolves to nothing rather than to a query", () => {
  assert.equal(workIdFromSlug("skyfall-2012"), null);
  assert.equal(workIdFromSlug(""), null);
  assert.equal(workIdFromSlug(null), null);
  assert.equal(workPath({ title: "Skyfall" }), null);
});

test("an accented or punctuated title still makes a usable slug", () => {
  assert.equal(slugifyTitle("Amélie"), "amelie");
  assert.equal(slugifyTitle("Léon: The Professional"), "leon-the-professional");
  assert.equal(slugifyTitle("WALL·E"), "wall-e");
  // A work with no title at all is still addressable by its id.
  assert.equal(workSlug({ id: ID }), ID);
});

// --- distance is the spine, and the card never flattens it ------------------------

test("places are grouped by distance, nearest first", () => {
  const blocks = placeBlocks([
    place({ id: "influence", distance: 2, routable: false }),
    place({ id: "self" }),
    place({ id: "person", distance: 1 }),
  ]);
  assert.deepEqual(blocks.map((block) => block.distance), [0, 1, 2]);
  assert.deepEqual(blocks.map((block) => block.places[0].id), ["self", "person", "influence"]);
});

test("only the first two blocks are offered as a route", () => {
  // "Harry Potter places" must not quietly become "places connected to anything Rowling
  // ever touched", and the flag travels with the block so the button cannot appear over
  // the wrong one.
  const blocks = placeBlocks([place(), place({ distance: 1 }), place({ distance: 2 })]);
  assert.deepEqual(blocks.map((block) => block.routable), [true, true, false]);
  assert.deepEqual(ROUTE_BLOCK_DISTANCES, [0, 1]);
});

test("the influence block says in words that it is not a stop", () => {
  const [block] = placeBlocks([place({ distance: 2, routable: false })]);
  assert.match(block.note, /not a stop on the walk/i);
  assert.match(block.heading, /nearby/i);
});

test("a block nobody has anything in is not printed", () => {
  // A heading over nothing reads as a gap in the data rather than as the absence of that
  // kind of fact.
  const blocks = placeBlocks([place(), place()]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].places.length, 2);
  assert.deepEqual(placeBlocks([]), []);
});

test("a place with no distance is treated as being in the film itself", () => {
  const [block] = placeBlocks([{ id: "x", name: "Somewhere" }]);
  assert.equal(block.distance, 0);
});

// --- coverage, said out loud ------------------------------------------------------

test("thin coverage says so instead of looking broken", () => {
  // 39.8% of works in the queue have exactly one place. One pin with no comment invites
  // the reader to assume something failed.
  const line = coverageLine({ places: [place()], tally: { on_location: 1 } });
  assert.match(line, /^1 place/);
  assert.match(line, /1 filmed on location/);
});

test("places that are only nearby are counted apart from the rest", () => {
  const line = coverageLine({
    places: [place(), place({ distance: 2, routable: false })],
    tally: { on_location: 1 },
  });
  assert.match(line, /2 places/);
  assert.match(line, /1 nearby rather than in the film/);
});

test("a work with nothing says that plainly", () => {
  assert.match(coverageLine({ places: [] }), /No places recorded/);
  assert.match(coverageLine({}), /No places recorded/);
});

// --- what a still is allowed to claim ---------------------------------------------

test("unmatched frames are captioned as frames, never as a location", () => {
  // A gallery of "frames from this film" is honest; the same frames pinned to a street
  // would be an invention.
  const caption = stillsCaption({ stills: [{}, {}], verified: false });
  assert.match(caption, /Not matched to any location/i);
});

test("no stills means no caption at all", () => {
  assert.equal(stillsCaption({ stills: [] }), null);
  assert.equal(stillsCaption({}), null);
});

test("the API's own note wins over the default wording", () => {
  const caption = stillsCaption({ stills: [{}], note: "Checked by the scene matcher." });
  assert.equal(caption, "Checked by the scene matcher.");
});

test("a link with no url is not a link", () => {
  assert.deepEqual(
    workLinks([{ label: "IMDb", url: "https://imdb.com/x" }, { label: "TMDB" }, null]),
    [{ label: "IMDb", url: "https://imdb.com/x" }],
  );
  assert.deepEqual(workLinks(null), []);
});

// --- UX-7: the top of the page and the long lists ------------------------------

test("a block prints the first ten and keeps the rest for Show all", async () => {
  const { firstAndRest, FIRST_PLACES } = await import("../app/lib/work-card.mjs");
  const list = Array.from({ length: 23 }, (_, i) => i);
  const { first, rest } = firstAndRest(list);
  assert.equal(FIRST_PLACES, 10);
  assert.deepEqual(first, list.slice(0, 10));
  assert.equal(rest.length, 13);
  assert.deepEqual(firstAndRest(list.slice(0, 4)).rest, []);
  assert.deepEqual(firstAndRest(null), { first: [], rest: [] });
});

test("the mini-map draws only usable coordinates and says which are confirmed", async () => {
  const { miniMapPoints } = await import("../app/lib/work-card.mjs");
  const points = miniMapPoints({
    places: [{ name: "Glencoe", lat: 56.68, lng: -5.1 }, { name: "Nowhere", lat: null, lng: null }],
    candidates: [{ name: "Null Island", lat: 0, lng: 0 }, { name: "Soho", lat: "51.51", lng: "-0.13" }, { lat: 120, lng: 0 }],
  });
  assert.deepEqual(points, [
    { position: [56.68, -5.1], confirmed: true, name: "Glencoe" },
    { position: [51.51, -0.13], confirmed: false, name: "Soho" },
  ]);
});

test("Open on the map lands on the median point, not between continents", async () => {
  const { mapLinkFor } = await import("../app/lib/work-card.mjs");
  const at = (lat, lng) => ({ position: [lat, lng] });
  assert.equal(mapLinkFor([at(51.5, -0.12), at(51.51, -0.13), at(34.05, -118.24)]), "/?lat=51.5000&lng=-0.1300&z=13");
  assert.equal(mapLinkFor([]), null);
});
