import assert from "node:assert/strict";
import test from "node:test";

import { DIPTYCH, coverCrop, diptychFileName, diptychLayout, diptychText } from "../app/lib/diptych.mjs";

test("a wide image is cut at the sides, a tall one at the top and bottom", () => {
  assert.deepEqual(coverCrop(1920, 1080, 596, 630), { sx: (1920 - 1080 * 596 / 630) / 2, sy: 0, sw: 1080 * 596 / 630, sh: 1080 });
  const tall = coverCrop(1000, 2000, 500, 500);
  assert.deepEqual(tall, { sx: 0, sy: 500, sw: 1000, sh: 1000 });
  assert.equal(coverCrop(0, 100, 10, 10), null);
  assert.equal(coverCrop(100, 100, 0, 10), null);
});

test("the two halves are equal and the footer spans the card", () => {
  const layout = diptychLayout();
  assert.equal(layout.then.width, layout.now.width);
  assert.equal(layout.now.x + layout.now.width, DIPTYCH.width);
  assert.equal(layout.height, DIPTYCH.panelHeight + DIPTYCH.footerHeight);
  assert.equal(layout.footer.y, DIPTYCH.panelHeight);
});

test("the card credits whoever made the left half", () => {
  const film = diptychText({ film: "Skyfall", place: "National Gallery", thenSrc: "https://image.tmdb.org/t/p/w780/a.jpg" });
  assert.equal(film.title, "Skyfall · National Gallery");
  assert.match(film.credit, /TMDB/);
  assert.equal(film.thenTag, "Then");
  assert.match(film.shareText, /Skyfall was filmed: National Gallery/);
  const visitor = diptychText({ film: "Skyfall", place: "National Gallery", referenceLabel: "a visitor's shot" });
  assert.equal(visitor.thenTag, "Their shot");
  assert.match(visitor.credit, /visitor/);
  assert.equal(diptychText().title, "Then and now");
  const elsewhere = diptychText({ film: "Skyfall", thenSrc: "https://example.org/frame.jpg" });
  assert.doesNotMatch(elsewhere.credit, /TMDB/, "never credit TMDB for a frame that is not theirs");
  assert.doesNotMatch(diptychText({ film: "X", thenSrc: "https://nottmdb.org.evil.com/a.jpg" }).credit, /TMDB/);
  assert.match(diptychText({ film: "Gudrun", place: "The Ritz", kind: "book" }).shareText, /Gudrun is set: The Ritz/);
});

test("the file name is safe on any phone", () => {
  assert.equal(diptychFileName({ film: "Amélie", place: "Café des 2 Moulins" }), "amelie-cafe-des-2-moulins-glorymap.jpg");
  assert.equal(diptychFileName({}), "then-and-now-glorymap.jpg");
});
