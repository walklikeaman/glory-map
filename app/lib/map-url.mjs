// Where the map is, as an address somebody can send.
//
// Measured 10.09.2026: the map opens on London and there is **no way to open it anywhere
// else by link.** `londonCenter` and `Q84` are hard-coded initial state, and nothing reads
// the URL. Every other surface in this product got an address — a work in #146, a city and
// the directory in #158, a place in #129 — and the main one, the map itself, never did.
//
// It matters most to the person who is actually travelling: "open my map on Los Angeles"
// is a link, or it is four clicks through a dropdown that has to be scrolled past four
// films of the same name. It is also why the map cannot be linked from the city pages,
// which is the obvious way in.
//
// **A city slug is preferred to a coordinate** where one fits, for the reason [[directory]]
// gives: a slug survives the anchor being re-measured, and `?city=los-angeles` says what
// it means where `?lat=34.0597` does not. A raw coordinate is still accepted, because the
// map can be dragged anywhere and most places are not in the gazetteer.
//
// Related: [[work-url]], [[directory]], [[studio-lots]].

import { findCity } from "./city-gazetteer.mjs";
import { slugifyTitle } from "./work-url.mjs";
import { finiteOrNull } from "./numbers.mjs";

// The map holds a city NAME, not a slug — it comes from the live Wikidata search, which
// knows nothing about the committed gazetteer. This is the one join between them, and it
// uses the gazetteer's own slugifier so "Almería" resolves the same way on both sides.
// A city we do not hold answers null and the URL falls back to a coordinate, which is the
// honest result: Wikidata knows far more cities than the directory does.
export function citySlugFromName(name) {
  const slug = slugifyTitle(name);
  return slug && findCity(slug) ? slug : null;
}

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 19;

function inRange(value, low, high) {
  const number = finiteOrNull(value);
  return number !== null && number >= low && number <= high ? number : null;
}

// What the map should show, read from a query string. Null when the URL says nothing,
// which is not the same as saying London: the caller keeps its own default and this does
// not invent one.
export function readMapUrl(searchParams) {
  const get = (key) => searchParams?.get?.(key) ?? null;

  const zoom = inRange(get("z"), MIN_ZOOM, MAX_ZOOM);

  const citySlug = get("city");
  if (citySlug) {
    const city = findCity(citySlug);
    // An unknown slug is ignored rather than guessed at. Falling back to a coordinate
    // somebody did not write is how a shared link quietly opens somewhere else.
    if (city) {
      return {
        source: "city",
        slug: city.slug,
        name: city.name,
        lat: city.lat,
        lng: city.lng,
        zoom: zoom ?? 12,
      };
    }
  }

  const lat = inRange(get("lat"), -90, 90);
  const lng = inRange(get("lng"), -180, 180);
  if (lat === null || lng === null) return null;
  // Null Island is not a place. Four incidents in this project, all from `Number("")`
  // being 0 and 0 being finite.
  if (lat === 0 && lng === 0) return null;

  return { source: "point", slug: null, name: null, lat, lng, zoom: zoom ?? 13 };
}

// Whether the map should ask for the reader's position as it opens. Only when the address
// named nowhere: a shared link to Los Angeles must open on Los Angeles, not on the person
// who clicked it. `opened` is what readMapUrl returned.
export function locateOnOpen(opened) {
  return opened == null;
}

// The query string for a view, so the address bar always describes what is on screen.
//
// The city slug wins when the centre is the city's own anchor — that is what a reader
// pasted — and a dragged map falls back to its coordinate. Rounded to four decimals,
// about 11 m, which is the same precision the place card copies: a URL carrying six is
// inventing digits the map never had.
export function mapUrlQuery({ lat, lng, zoom, citySlug = null } = {}) {
  const params = new URLSearchParams();
  const city = citySlug ? findCity(citySlug) : null;
  const y = finiteOrNull(lat);
  const x = finiteOrNull(lng);

  if (city && y !== null && x !== null
    && Math.abs(city.lat - y) < 0.0005 && Math.abs(city.lng - x) < 0.0005) {
    params.set("city", city.slug);
  } else {
    if (y === null || x === null) return "";
    params.set("lat", y.toFixed(4));
    params.set("lng", x.toFixed(4));
  }

  const z = inRange(zoom, MIN_ZOOM, MAX_ZOOM);
  if (z !== null) params.set("z", String(Math.round(z)));
  return params.toString();
}
