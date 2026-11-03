import assert from "node:assert/strict";
import test from "node:test";

import { isVaguePlaceName } from "../app/lib/vague-place-name.mjs";

test("a lone common noun is vague", () => {
  for (const name of ["Bridge", "Street", "Road", "road", " Library ", "Funeral", "Pier"]) {
    assert.equal(isVaguePlaceName(name), true, name);
  }
});

test("a proper word, or a second word, makes it a name", () => {
  for (const name of ["Rules", "Koko", "Strand", "Lower 5th", "Gotham Ballet", "Lau's Offices", "Van Buren Street Bridge", "Navy Pier", "The Mall", "Old Street", "Tower Bridge", "Park Lane", "Shopping Center", "Alley (south of Cordova, west of Gore)", ""]) {
    assert.equal(isVaguePlaceName(name), false, name);
  }
});
