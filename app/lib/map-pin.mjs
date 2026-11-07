// What a pin means, decided in one place.
//
// The map grew three pin systems from three code paths and never reconciled them: an amber
// diamond for a searched work's places, a filled circle for the graph, a hollow circle for
// the queue. A reader was asked to learn three shapes for one idea — *a place* — and the
// owner's verdict on 11.09 was the right one: **"почему одни жёлтые ромбики, а другие
// кружочки? Не понимаешь, что это означает."**
//
// So there is ONE shape now, and the things that actually differ are the things that vary:
//
//   how many films are here  → the NUMBER printed on the pin, and its size
//   have we checked it       → filled (checked) against outlined (nobody has looked)
//   what kind of place       → amber for somewhere you can stand, violet for a studio lot
//   is it the one you picked → a ring around it, which never changes the other three
//
// A number on the pin is the part that was missing and the part that was asked for. 566 of
// the 2,024 Los Angeles points carry more than one film and the busiest carries 96; without
// the number every one of them looks like a single place, which is what hid 71% of the data
// before the points were grouped at all.

import { finiteOrNull } from "./numbers.mjs";

// A pin is a place. What varies is what we know about it.
export const PIN_KIND = Object.freeze({
  // Somewhere the camera was, that a person can walk to.
  place: "place",
  // Inside a studio lot: the camera was here and the scene is set somewhere else.
  studio: "studio",
  // Where the story happens, which is not a claim that anything was filmed there.
  narrative: "narrative",
});

// Big enough to hold two digits at the smallest size, and it grows logarithmically —
// linear saturates at once and draws 5 films the same as 96.
export const MIN_PIN = 24;
export const MAX_PIN = 46;

export function pinSize(filmCount) {
  const n = finiteOrNull(filmCount);
  if (n === null || n <= 1) return MIN_PIN;
  return Math.round(Math.min(MAX_PIN, MIN_PIN + Math.log10(n) * 13));
}

// What is printed inside. One film prints nothing — a "1" on every pin is noise, and the
// number is there to mark the points that hide something.
export function pinLabel(filmCount) {
  const n = finiteOrNull(filmCount);
  if (n === null || n <= 1) return "";
  // Three digits do not fit and no point needs them: the busiest place in Los Angeles has
  // 96 films and the largest in the whole queue is under 999.
  return n > 999 ? "999+" : String(Math.round(n));
}

export function pinKind({ depicts_elsewhere: studio, narrative } = {}) {
  if (studio) return PIN_KIND.studio;
  if (narrative) return PIN_KIND.narrative;
  return PIN_KIND.place;
}

// The class list the marker is drawn with. Kept as data so the meaning is testable without
// a browser, and so one shape cannot drift into three again.
export function pinClasses({
  filmCount = 1,
  checked = false,
  depicts_elsewhere: studio = false,
  narrative = false,
  selected = false,
} = {}) {
  return [
    "map-pin",
    `is-${pinKind({ depicts_elsewhere: studio, narrative })}`,
    // Filled means somebody checked it. The distinction is evidence, not decoration —
    // 32,138 of the located rows are unchecked and only 92 facts are not.
    checked ? "is-checked" : "is-unchecked",
    Number(filmCount) > 1 ? "has-many" : "",
    selected ? "is-selected" : "",
  ].filter(Boolean).join(" ");
}

// The whole marker, as HTML. Leaflet's `divIcon` takes a string, and building it here keeps
// the shape, the number and the meaning in one testable place.
export function pinHtml(options = {}) {
  const label = pinLabel(options.filmCount);
  return `<span class="${pinClasses(options)}"><span class="map-pin-body">${label}</span></span>`;
}

// Two pins that look the same may SHARE one icon object, and this is the key that says so.
//
// Why it matters, measured: `GraphLayer` built a fresh `L.divIcon` for every marker on
// every render. A new icon object is a changed `icon` prop, so react-leaflet called
// `marker.setIcon()` on all of them, and `setIcon` replaces the marker's DOM element. The
// cost was not the pins being on screen — it was rebuilding all of them whenever ANY state
// in the app changed. Opening the layers menu with 598 pins drawn blocked the main thread
// for 220 ms; with 10 pins drawn, 45 ms. Nothing about the pins had changed either time.
//
// Sharing is safe because `DivIcon.createIcon()` builds a NEW element per marker — the icon
// object is a recipe, not the thing on the map. So the key has to cover exactly what the
// recipe reads: the html (which is the label plus the classes) and the size.
export function pinIconKey(options = {}) {
  return `${pinSize(options.filmCount)}|${pinClasses(options)}|${pinLabel(options.filmCount)}`;
}

// What the legend says. Written as sentences rather than labels because a legend of nouns
// — "Exact", "Approximate", "Studio" — is what the reader could not decode.
export const PIN_LEGEND = Object.freeze([
  { kind: PIN_KIND.place, checked: true, text: "A filled pin: a place we checked. You can go and stand here." },
  { kind: PIN_KIND.place, checked: false, text: "A ring or a small dot: a source says a film was shot here. Nobody has checked it yet." },
  { kind: PIN_KIND.studio, checked: false, text: "Violet: a film studio. The camera was here, but the story is set somewhere else." },
  { kind: "count", checked: false, text: "A number means several places or films close together. Tap it to zoom in." },
  // The big dashed ring. It has always meant something and nothing ever said what, so it
  // read as a decoration that occasionally swallowed the screen.
  { kind: "area", checked: false, text: "A dashed ring means we only know the city or area, not the street." },
  // The reader's own position and search radius, drawn blue so it never reads as a place.
  { kind: "you", checked: false, text: "The blue dot is you. The blue circle is the area searched around you." },
]);
