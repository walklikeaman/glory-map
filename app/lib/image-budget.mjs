// What an image is allowed to weigh, and where that number came from (#198).
//
// Images were the one thing in this product nothing was measured against. Every other
// cost has a number somebody can argue with — a tile is 25 kB (tile-corridor.mjs), a
// corridor is capped at 400 of them — and images had none, so they arrived one feature
// at a time and nobody could name the one that did it.
//
// Measured on production, 2026-09-21, and every number below is a mean over ten real
// files rather than a guess:
//
//   image.tmdb.org, poster (2:3)   w92 5 kB · w154 10 · w185 14 · w342 36 · w500 73 · w780 153
//   image.tmdb.org, frame (16:9)   w92 3 kB · w185  7 · w300 13 · w342 16 · w500 27 · w780  58
//   commons, Special:FilePath      no width: 5.1 MB mean, 7.0 MB max · ?width=400: 57 kB
//
// The last line is the one that mattered. `location-search.mjs` stored the P18 image URL
// exactly as Wikidata states it — `Special:FilePath/<file>` with no width — and 15 of the
// 15 places in a central-London viewport carried one. That is the full original upload,
// five megabytes on average, rendered into a figure 192 CSS px wide.
//
// ---------------------------------------------------------------------------------------
//
// **The budget is per surface, not per page.** "The app should be under N MB" cannot be
// enforced, because the number of images on screen depends on what is in view. What can
// be enforced is that every image is asked for at the size it is drawn at — so the table
// below names each one's box, in CSS pixels, taken from globals.css, and the test holds
// the code to it.
//
// **Two device pixels per CSS pixel, and no more.** Phones report 3 and even 4, and
// serving for those doubles the bytes for a difference nobody has been shown to see on a
// photograph. Every box here is therefore budgeted at ×2.

// The widths image.tmdb.org actually serves. TMDB documents a different list per image
// type; measured, the CDN answers this union for any path and 400s on anything else — so
// a "still" width like w533 is not available even for a still.
export const TMDB_WIDTHS = Object.freeze([45, 92, 154, 185, 300, 342, 400, 500, 780, 1280, 1920]);

// Mean bytes per rung, measured. Held here rather than in a comment because the test
// checks budgets against them, and a number a test reads is a number that stays true.
export const TMDB_BYTES = Object.freeze({
  poster: Object.freeze({ 45: 4_096, 92: 5_120, 154: 10_240, 185: 14_336, 300: 33_792, 342: 36_864, 400: 50_176, 500: 74_752, 780: 156_672, 1280: 342_016 }),
  frame: Object.freeze({ 45: 2_048, 92: 3_072, 154: 5_120, 185: 7_168, 300: 13_312, 342: 16_384, 400: 21_504, 500: 27_648, 780: 59_392, 1280: 137_216 }),
});

// A photograph is not worth more than two device pixels per CSS pixel. See the note above.
export const MAX_DPR = 2;

// The smallest rung that still covers the box. A box larger than the top rung gets the
// top rung: asking for more than TMDB serves is a 400, and an image slightly soft is
// better than an image missing.
export function tmdbWidth(cssWidth, { dpr = MAX_DPR, widths = TMDB_WIDTHS } = {}) {
  const wanted = Number(cssWidth) * Math.min(Number(dpr) || 1, MAX_DPR);
  if (!Number.isFinite(wanted) || wanted <= 0) return null;
  return widths.find((width) => width >= wanted) ?? widths[widths.length - 1];
}

// Mean bytes per Commons bucket, measured over the same files. 640 and 800 are one
// number because MediaWiki measurably returns the same rendering for both.
export const COMMONS_BYTES = Object.freeze({ 400: 58_368, 640: 174_080, 800: 174_080, 1280: 285_696 });

export function measuredBytes(shape, width) {
  if (shape === "commons") return COMMONS_BYTES[width] ?? null;
  return TMDB_BYTES[shape]?.[width] ?? null;
}

// Commons renders a thumbnail on demand at whatever width `Special:FilePath?width=` is
// given — but ONLY through that parameter. A thumb URL already rendered at 960 cannot be
// rewritten to 400 by hand: measured, upload.wikimedia.org answers 400 Bad Request for a
// width nobody asked the API for. So the width must be decided here, when the URL is
// built, and it is the only chance to decide it.
//
// The buckets are MediaWiki's own: it rounds a request up to one of these, and asking for
// 640 and 800 measurably returns the same file.
export const COMMONS_WIDTHS = Object.freeze([320, 400, 640, 800, 1024, 1280]);

// A bucket that covers this many IMAGE pixels.
export function commonsBucket(pixels) {
  const wanted = Number(pixels);
  if (!Number.isFinite(wanted) || wanted <= 0) return COMMONS_WIDTHS[0];
  return COMMONS_WIDTHS.find((width) => width >= wanted) ?? COMMONS_WIDTHS[COMMONS_WIDTHS.length - 1];
}

// A bucket that covers this many CSS pixels, at two device pixels each. The two are
// separate functions because they take different units and one silently standing in for
// the other is a factor-of-two mistake that nothing would report.
export function commonsWidth(cssWidth, { dpr = MAX_DPR } = {}) {
  return commonsBucket(Number(cssWidth) * Math.min(Number(dpr) || 1, MAX_DPR));
}

// The ONE place a Commons file URL is built. There were two, one of which forgot the
// width and cost five megabytes a pin; a helper that cannot be called without a width is
// the only version of this that stays fixed.
export function commonsFileUrl(filename, { width } = {}) {
  const name = String(filename ?? "").trim();
  if (!name) return null;
  const size = commonsBucket(width);
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${size}`;
}

// `Special:FilePath` renders on demand, so unlike an already-rendered thumb URL its width
// CAN be changed after the fact — which is what makes a srcset possible for a photo whose
// URL was decided on the server and stored on a row. Measured: ?width=400 and ?width=1200
// both answer 200 for the same file; rewriting 960px- to 400px- in an upload.wikimedia.org
// thumb answers 400.
//
// Anything that is not a Special:FilePath URL is left alone and gets no srcset: a
// Mapillary thumb is one fixed size and a rewritten width would simply 404.
export function commonsSrcSetForSurface(url, key) {
  const widths = responsiveWidths(key);
  return widths.length > 1 ? commonsSrcSet(url, widths) : null;
}

export function commonsSrcSet(url, widths = COMMONS_WIDTHS.slice(0, 4)) {
  const base = String(url ?? "");
  if (!base.includes("/Special:FilePath/")) return null;
  const withoutWidth = base.replace(/([?&])width=\d+&?/, "$1").replace(/[?&]$/, "");
  const join = withoutWidth.includes("?") ? "&" : "?";
  return widths.map((width) => `${withoutWidth}${join}width=${width} ${width}w`).join(", ");
}

// Where every image in the product is drawn, how wide its box is in CSS pixels at each
// breakpoint, and what it may therefore weigh. The boxes are read off globals.css; the
// comment on each says which rule, so a CSS change that invalidates one is findable.
export const SURFACES = Object.freeze({
  // .poster-tile — 28 px in the two-column chip grid, ~84 px in the five-column
  // horizontal scroller a phone gets. One fixed size cannot serve both: w185 is right
  // for the phone and twice what the desktop needs, which is what shipped.
  filmChip: Object.freeze({ shape: "poster", box: 28, phoneBox: 84, budgetBytes: 16_384 }),
  // .search-suggestion img — 34 px, the same on every screen.
  searchSuggestion: Object.freeze({ shape: "poster", box: 34, phoneBox: 34, budgetBytes: 8_192 }),
  // .deck-card img — the interests deck (#15): a 200 px poster card, the same on every
  // screen, so the phone's 390 px fits it with room for the buttons.
  deckCard: Object.freeze({ shape: "poster", box: 200, phoneBox: 200, budgetBytes: 81_920 }),
  // .work-card-poster — 62 px, 52 px under 520.
  workCardPoster: Object.freeze({ shape: "poster", box: 62, phoneBox: 52, budgetBytes: 16_384 }),
  // .work-profile-poster — 76 px, 56 px under 860.
  workProfilePoster: Object.freeze({ shape: "poster", box: 76, phoneBox: 56, budgetBytes: 20_480 }),
  // .point-film-poster — 34 px beside each film in a map pin's card, the same on every
  // screen. Enough to recognise a poster, which is all it is for.
  pointFilmPoster: Object.freeze({ shape: "poster", box: 34, phoneBox: 34, budgetBytes: 8_192 }),
  // .place-scene-frame — 84×47, 64×36 under 860.
  placeSceneFrame: Object.freeze({ shape: "frame", box: 84, phoneBox: 64, budgetBytes: 10_240 }),
  // .work-stills and .work-profile-stills — auto-fill minmax(160/180px, 1fr) inside a
  // 46rem page and a 410px panel. 167 px measured at a 1024 viewport; the widest the
  // column can get in either container is about 190, which is what is budgeted for.
  workStill: Object.freeze({ shape: "frame", box: 190, phoneBox: 180, budgetBytes: 32_768 }),
  // .scene-frame-list figure img — a 180 px column in a horizontal scroller.
  galleryFrame: Object.freeze({ shape: "frame", box: 180, phoneBox: 180, budgetBytes: 24_576 }),
  // .comparison-grid figure, the "place today" half — half of a 430 px sheet on a
  // desktop, the full sheet in one column under 860. A Commons photo, so its rungs are
  // MediaWiki's buckets rather than TMDB's; the film half of the same grid is the hero
  // image reused, and costs nothing extra because it is the same URL.
  placePhoto: Object.freeze({ shape: "commons", box: 192, phoneBox: 350, budgetBytes: 204_800 }),
  // .sheet-media > img — the card's backdrop, behind a black gradient that covers it from
  // 8% at the top to 92% at the bottom. Deliberately capped below its box: a sheet is
  // 430 px on a desktop and up to 836 px on a tablet, and paying 1280 for a darkened
  // background is the kind of decision this file exists to stop.
  sheetHero: Object.freeze({ shape: "frame", box: 430, phoneBox: 430, budgetBytes: 65_536, cap: 780 }),
});

// The size a surface should ask for, at the breakpoint that needs the most.
export function widthForSurface(key) {
  const surface = SURFACES[key];
  if (!surface) return null;
  const widest = Math.max(surface.box, surface.phoneBox);
  const width = surface.shape === "commons" ? commonsWidth(widest) : tmdbWidth(widest);
  return surface.cap ? Math.min(width, surface.cap) : width;
}

// What a surface costs at that size, and whether it fits. Returned rather than thrown:
// the caller is a test, and a test that prints the overspend is more use than one that
// prints "false".
export function surfaceCost(key) {
  const surface = SURFACES[key];
  if (!surface) return null;
  const width = widthForSurface(key);
  const bytes = measuredBytes(surface.shape, width);
  return { key, width, bytes, budgetBytes: surface.budgetBytes, over: bytes === null ? null : bytes - surface.budgetBytes };
}

// The one breakpoint globals.css changes these boxes at.
export const PHONE_BREAKPOINT_PX = 860;

// The `sizes` a responsive surface needs, in the same terms its boxes are declared in.
// Without it the browser assumes 100vw and picks the largest rung on every screen, which
// is the bug this was meant to fix wearing a srcset.
export function sizesForSurface(key) {
  const surface = SURFACES[key];
  if (!surface) return null;
  if (surface.box === surface.phoneBox) return `${surface.box}px`;
  return `(max-width: ${PHONE_BREAKPOINT_PX}px) ${surface.phoneBox}px, ${surface.box}px`;
}

// A box that differs between phone and desktop wants both rungs and a `sizes` telling the
// browser which is which. One `src` cannot serve a 28 px tile and an 84 px one, and
// picking either means one of the two screens is wrong.
export function responsiveWidths(key) {
  const surface = SURFACES[key];
  if (!surface) return [];
  const at = (box) => (surface.shape === "commons" ? commonsWidth(box) : tmdbWidth(box));
  const widths = new Set([at(surface.box), at(surface.phoneBox)]);
  return [...widths].filter(Boolean).sort((left, right) => left - right);
}

// What may be kept, per source. This was three comments in place-photo.mjs and one in
// work-posters.mjs — four statements of a licensing rule, in four files, none of which a
// new route would be read alongside. It is a licence question before it is a performance
// one, so it belongs in one place and is stated here.
export const STORAGE_POLICY = Object.freeze({
  mapillary: Object.freeze({
    store: true,
    licence: "CC BY-SA 4.0",
    why: "Freely licensed; the id outlives the URL, so the id is what we keep.",
  }),
  wikimedia: Object.freeze({
    store: true,
    licence: "per file",
    why: "Each file carries its own licence, so the credit travels with the image.",
  }),
  streetview: Object.freeze({
    store: false,
    licence: "Google Maps Platform terms",
    why: "The terms forbid caching or saving the imagery. A live embed only; never a file, "
      + "never a proxy, and never part of a saved before/after composition. Only the pano id may be kept.",
  }),
  tmdb: Object.freeze({
    store: false,
    licence: "TMDB API terms",
    why: "Studio art served by TMDB under their API terms. The PATH is stored — it is "
      + "not the image — and image.tmdb.org serves the file to the reader directly. "
      + "Caching the bytes ourselves has not been checked against their terms, so it is not done.",
  }),
});

export function mayStore(source) {
  return STORAGE_POLICY[source]?.store === true;
}
