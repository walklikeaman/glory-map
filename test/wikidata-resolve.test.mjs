import assert from "node:assert/strict";
import test from "node:test";

import { chooseEntity, namesTheSamePlace, withoutDisambiguator } from "../app/lib/wikidata-resolve.mjs";

const entity = (label, qid = "Q1", alts = []) => ({ qid, label, alts });

test("withoutDisambiguator drops Wikipedia's town suffix", () => {
  assert.equal(withoutDisambiguator("Pile Gate, Dubrovnik"), "Pile Gate");
  assert.equal(withoutDisambiguator("Rector's Palace (Dubrovnik)"), "Rector's Palace");
  assert.equal(withoutDisambiguator("Stradun"), "Stradun");
});

test("a label with a disambiguator still names the place", () => {
  assert.equal(namesTheSamePlace("Pile Gate", entity("Pile Gate, Dubrovnik")), true);
  assert.equal(namesTheSamePlace("Rector's Palace", entity("Rector's Palace (Dubrovnik)")), true);
});

test("fort, fortress and tower describe the same proper noun", () => {
  assert.equal(namesTheSamePlace("Fort Bokar", entity("Bokar Fortress")), true);
  assert.equal(namesTheSamePlace("Minčeta Tower", entity("Minčeta Fortress")), true);
});

test("a generic on one side only is still two different things", () => {
  assert.equal(namesTheSamePlace("Victoria Park", entity("Victoria")), false);
  assert.equal(namesTheSamePlace("Stradun", entity("Siege of Dubrovnik")), false);
});

test("two different entities answering one name are refused", () => {
  const verdict = chooseEntity("Pile Gate", [entity("Pile Gate, Dubrovnik", "Q1"), entity("Pile Gate", "Q2")]);
  assert.equal(verdict.entity, null);
});
