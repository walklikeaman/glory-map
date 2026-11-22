import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #114 rest (22.11): 320, 360, a phone on its side, tablets, and "Add to Home Screen".
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the panel's newer controls are 44 px under a finger, stated after their own rules", () => {
  const block = css.lastIndexOf("@media (pointer: coarse)");
  const tail = css.slice(block, css.indexOf("\n}\n", block));
  for (const selector of [".panel-toolbar .filters-toggle", ".panel-toolbar .account-button", ".results-tab", ".notable-here .notable-row", ".plan-summary .ghost-button"]) {
    assert.ok(tail.includes(selector), `${selector} missing from the last coarse-pointer block`);
    // Order decides between equal selectors: the base rule must come earlier.
    const base = css.indexOf(`${selector} {`);
    assert.ok(base === -1 || base < block, `${selector} is restyled after the 44 px rule`);
  }
  assert.match(tail, /\.film-chip-open\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
});

test("a short landscape window moves the pin key beside the map buttons", () => {
  const at = css.indexOf("@media (max-width: 860px) and (max-height: 500px)");
  assert.ok(at > 0);
  const block = css.slice(at, css.indexOf("\n}", at));
  assert.match(block, /\.map-key\s*\{\s*right:\s*calc\(1\.1rem \+ 44px/);
});

test("an iPhone gets a real home-screen icon and opens without Safari's bars", () => {
  const png = readFileSync(new URL("../app/apple-icon.png", import.meta.url));
  assert.equal(png.toString("ascii", 1, 4), "PNG");
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
  const layout = readFileSync(new URL("../app/layout.jsx", import.meta.url), "utf8");
  assert.match(layout, /appleWebApp:\s*\{\s*capable:\s*true/);
});
