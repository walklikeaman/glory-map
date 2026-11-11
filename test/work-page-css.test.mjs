import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const rule = (selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} rule is missing`);
  return css.slice(at, css.indexOf("}", at));
};

// QA 2026-11-11: on a 390 px phone the work page scrolled sideways (up to 511 px wide)
// because one long place name or badge widened the whole places grid.
test("the work page's places list can't grow wider than the screen", () => {
  assert.match(rule(".work-places"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(rule(".work-place"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(".work-place-head"), /flex-wrap:\s*wrap/);
});
