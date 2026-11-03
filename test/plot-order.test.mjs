import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_QUOTE_WORDS, MIN_QUOTE_WORDS, appearsAsName, findPlotSection,
  plotSectionFromWikitext, normalisedText, placeInPlot,
  scenesFromPlacement,
} from "../app/lib/plot-order.mjs";

const PLOT = "In 1890 London, Holmes and Watson stop the ritual murder of a young woman. "
  + "Holmes visits Blackwood in his cell at Pentonville Prison before the hanging. "
  + "Later Holmes returns to the cell where it all began, at Pentonville Prison again.";
const KNOWN = [
  { location: "Somerset House", appears_as: "Appears as \"Pentonville Prison (cell)\"." },
  { location: "St Bartholomew-the-Great", appears_as: "Appears as \"St. Paul's Cathedral (crypt)\"." },
];

test("the plot section is found by its name, and its index — not its number — is returned", () => {
  const toc = { sections: [
    { line: "Plot", index: "1", number: "1" },
    { line: "Cast", index: "2", number: "2" },
  ] };
  assert.equal(findPlotSection(toc), "1");
  assert.equal(findPlotSection({ sections: [{ line: "<i>Synopsis</i>", index: "3" }] }), "3");
  assert.equal(findPlotSection({ sections: [{ line: "Production", index: "1" }] }), null);
  assert.equal(findPlotSection(null), null);
});

test("a quote counts only if the text contains it, with curly quotes and spacing forgiven", () => {
  const placed = placeInPlot(PLOT, [{ matches: [
    { location: "Somerset House", plot_quote: "Holmes visits Blackwood in his   cell at Pentonville Prison", fictional: false },
    { location: "St Bartholomew-the-Great", plot_quote: "Holmes and Watson interrupt the ritual in a crypt", fictional: false },
  ] }], KNOWN);
  assert.deepEqual(placed.map((entry) => entry.location), ["Somerset House"]);
  assert.equal(normalisedText("Holmes’s “cell”"), normalisedText("holmes's \"cell\""));
});

test("a location the story returns to is placed at its first passage", () => {
  const placed = placeInPlot(PLOT, [
    { matches: [{ location: "Somerset House", plot_quote: "Holmes returns to the cell where it all began", fictional: false }] },
    { matches: [{ location: "Somerset House", plot_quote: "Holmes visits Blackwood in his cell at Pentonville", fictional: false }] },
  ], KNOWN);
  assert.equal(placed.length, 1);
  assert.match(placed[0].quote, /visits Blackwood/);
});

test("a quote outside the length window, or for a place not ours, is refused", () => {
  const tooShort = "his cell at Pentonville";
  assert.ok(tooShort.split(" ").length < MIN_QUOTE_WORDS);
  const tooLong = PLOT.split(" ").slice(0, MAX_QUOTE_WORDS + 3).join(" ");
  const placed = placeInPlot(PLOT, [{ matches: [
    { location: "Somerset House", plot_quote: tooShort, fictional: false },
    { location: "Somerset House", plot_quote: tooLong, fictional: false },
    { location: "Somewhere Invented", plot_quote: "Holmes visits Blackwood in his cell at Pentonville Prison", fictional: false },
  ] }], KNOWN);
  assert.deepEqual(placed, []);
});

test("what a place appears as is read off the guide line, or not at all", () => {
  assert.equal(appearsAsName("Appears as \"Grand Hotel (exterior)\". The college was built in…"), "Grand Hotel (exterior)");
  assert.equal(appearsAsName("Appears as “Wayne Manor”."), "Wayne Manor");
  assert.equal(appearsAsName("Westminster Bridge was designed by Thomas Page."), null);
});

// A film has no chapters: its spoiler tier IS its place in the story, so the trail shows
// the walk only as far as the reader has watched. The teaser names nothing.
test("the scenes keep the order as their spoiler tier, credit the quote, and spoil nothing early", () => {
  const scenes = scenesFromPlacement(placeInPlot(PLOT, [{ matches: [
    { location: "Somerset House", plot_quote: "Holmes visits Blackwood in his cell at Pentonville Prison", fictional: false },
  ] }], KNOWN), { title: "Sherlock Holmes (2009 film)" });
  assert.deepEqual(scenes[0], {
    sequence_index: 1,
    place_name: "Pentonville Prison (cell)",
    known_place: "Somerset House",
    plot_beat: "\"Holmes visits Blackwood in his cell at Pentonville Prison\" (Wikipedia, Sherlock Holmes (2009 film))",
    quote: "Holmes visits Blackwood in his cell at Pentonville Prison",
    safe_teaser: "Scene 1 of the walk.",
    spoiler_tier: 1,
    is_fictional_setting: false,
  });
});

// Love Actually's opening quote placed both "London" and "London Heathrow Airport"; two
// sources spelled Grosvenor Chapel two ways. Walked, each pair is two stops at one door.
test("one quote is one scene, kept at its most precise place, and one building is one stop", async () => {
  const { distinctStops } = await import("../app/lib/plot-order.mjs");
  const places = new Map([
    ["London", { lat: 51.5072, lng: -0.1276, precision: "city" }],
    ["London Heathrow Airport", { lat: 51.4700, lng: -0.4543, precision: "point" }],
    ["Grosvenor Chapel, Mayfair", { lat: 51.50906, lng: -0.15132, precision: "point" }],
    ["Grosvenor Chapel, South Audley Street, Mayfair, London", { lat: 51.50910, lng: -0.15140, precision: "point" }],
    ["Selfridges", { lat: 51.5145, lng: -0.1527, precision: "building" }],
  ]);
  const placed = [
    { location: "London", at: 10 },
    { location: "London Heathrow Airport", at: 10 },
    { location: "Grosvenor Chapel, Mayfair", at: 200 },
    { location: "Grosvenor Chapel, South Audley Street, Mayfair, London", at: 230 },
    { location: "Selfridges", at: 400 },
  ];
  assert.deepEqual(distinctStops(placed, places).map((entry) => entry.location), [
    "London Heathrow Airport", "Grosvenor Chapel, Mayfair", "Selfridges",
  ]);
});

test("the plot section is cut from whole-article wikitext, subsections included", () => {
  const source = [
    "Intro text.", "== Plot ==", "Paddington arrives.", "=== Later ===", "He finds a home.",
    "== Cast ==", "* Ben Whishaw",
  ].join("\n");
  assert.equal(plotSectionFromWikitext(source),
    "== Plot ==\nPaddington arrives.\n=== Later ===\nHe finds a home.");
  assert.equal(plotSectionFromWikitext("== Plot summary ==\nA.\n"), "== Plot summary ==\nA.\n");
  assert.equal(plotSectionFromWikitext("== Cast ==\nB"), null);
});
