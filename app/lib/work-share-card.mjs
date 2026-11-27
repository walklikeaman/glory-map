// The preview a messenger shows for a link to a work (#77 rest): the work page
// `/work/<slug>`, and the map link that "Share trail" sends (`/?work=<uuid>`).
//
// Both used to unfurl as a bare "GloryMap" with no picture, so a shared trail looked like
// spam. The card is the poster, the title and how many places we hold. It never names a
// story stop or a scene: the person who opens the link starts spoiler-safe (trail-share.mjs).

import { TRAIL_ORDER } from "./trail-order.mjs";
import { TRAIL_PARAM } from "./trail-share.mjs";
import { workIdFromSlug, workPath } from "./work-url.mjs";

// The map reads `?work=`; anything that is not a uuid is not a work.
export function sharedWorkId(searchParams) {
  const raw = searchParams?.work;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? workIdFromSlug(value.trim()) : null;
}

// The poster the API gives is sized for a 76 px card. The preview is 630 px tall, so ask
// TMDB for w500 of the same file. Only TMDB's image host is rewritten or fetched.
export function cardPosterUrl(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "image.tmdb.org") return null;
    parsed.pathname = parsed.pathname.replace(/^\/t\/p\/[^/]+\//, "/t/p/w500/");
    return parsed.toString();
  } catch {
    return null;
  }
}

function placesLine(count, waiting) {
  if (count > 0) return `${count} place${count === 1 ? "" : "s"} on the map`;
  if (waiting > 0) return `${waiting} unconfirmed place${waiting === 1 ? "" : "s"}`;
  return "No places on the map yet";
}

// What the card and the link's title print. null when there is no work to show, so the
// caller falls back to the plain GloryMap preview.
export function workShareModel(payload, { trailOrder = TRAIL_ORDER.story } = {}) {
  const work = payload?.work;
  const title = String(work?.title ?? "").trim();
  if (!title || !work?.id) return null;
  const places = Array.isArray(payload.places) ? payload.places : [];
  const count = places.length;
  const waiting = Number(payload.candidates_total)
    || (Array.isArray(payload.candidates) ? payload.candidates.length : 0);
  const name = `${title}${work.year ? ` (${work.year})` : ""}`;
  return {
    id: work.id,
    name,
    path: workPath(work),
    posterUrl: cardPosterUrl(work.poster),
    placesLine: placesLine(count, waiting),
    // Place names are not plot; the first three show what kind of walk this is.
    placeNames: places.map((place) => String(place?.name ?? "").trim()).filter(Boolean).slice(0, 3),
    walking: trailOrder === TRAIL_ORDER.walk,
    description: count > 0
      ? `${count} place${count === 1 ? "" : "s"} from ${title} on the map, each with the source that stated it.`
      : waiting > 0
        ? `${waiting} unconfirmed place${waiting === 1 ? "" : "s"} for ${title}, each with the guide that reported it.`
        : `No places recorded for ${title} yet.`,
  };
}

// The title of a shared map link: it opens the map, not the work page.
export function mapLinkTitle(model) {
  return model.walking ? `Walk ${model.name} · GloryMap` : `${model.name} on the map · GloryMap`;
}

export function trailOrderFromSearchParams(searchParams) {
  const raw = searchParams?.[TRAIL_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === TRAIL_ORDER.walk ? TRAIL_ORDER.walk : TRAIL_ORDER.story;
}
