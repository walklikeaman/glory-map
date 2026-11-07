import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRawUrl, chooseSection, sectionFromWikitext, tocFromWikitext,
} from "../app/lib/wikipedia-source.mjs";

const ARTICLE = [
  "'''Ajami''' is a 2009 film.",
  "==Plot==",
  "A story in Jaffa.",
  "<!-- ==Not a heading== -->",
  "==Production==",
  "It was shot in the [[Ajami, Jaffa|Ajami]] neighbourhood.",
  "===Casting===",
  "Non-professional actors.",
  "==Reception==",
  "Well received.",
].join("\n");

test("the raw path is pinned to the revision the permalink cites", () => {
  const url = new URL(buildRawUrl("Ajami (film)", 1345914810));
  assert.equal(url.pathname, "/w/index.php");
  assert.equal(url.searchParams.get("action"), "raw");
  assert.equal(url.searchParams.get("oldid"), "1345914810");
  assert.equal(buildRawUrl("", 1), null);
});

test("a table of contents rebuilt from wikitext numbers sections as MediaWiki does", () => {
  const toc = tocFromWikitext(ARTICLE);
  assert.deepEqual(toc.sections.map((s) => [s.index, s.line, s.hLevel]), [
    ["1", "Plot", 2], ["2", "Production", 2], ["3", "Casting", 3], ["4", "Reception", 2],
  ]);
  assert.equal(chooseSection(toc, "en").line, "Production");
});

test("a section carries its subsections and stops at the next sibling", () => {
  const text = sectionFromWikitext(ARTICLE, "2");
  assert.match(text, /^==Production==/);
  assert.match(text, /Non-professional actors/);
  assert.doesNotMatch(text, /Well received/);
  assert.equal(sectionFromWikitext(ARTICLE, "9"), "");
});
