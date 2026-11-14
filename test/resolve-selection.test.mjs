import assert from "node:assert/strict";
import test from "node:test";

import { parseQids, pickWorkIds } from "../app/lib/resolve-selection.mjs";

test("parseQids keeps valid Q-ids once, upper-cased", () => {
  assert.deepEqual(parseQids("Q23572, q19798734 ,Q23572,junk,Q0"), ["Q23572", "Q19798734"]);
  assert.deepEqual(parseQids(null), []);
});

test("pickWorkIds skips rows without a Q-id and works already linked", () => {
  const rows = [
    { id: "a", wikidata_id: "Q1" },
    { id: "b", wikidata_id: null },
    { id: "c", wikidata_id: "Q3" },
    { id: "d", wikidata_id: "not-a-qid" },
  ];
  assert.deepEqual(pickWorkIds(rows), ["a", "c"]);
  assert.deepEqual(pickWorkIds(rows, { linked: new Set(["a"]) }), ["c"]);
  assert.deepEqual(pickWorkIds(rows, { limit: 1 }), ["a"]);
});
