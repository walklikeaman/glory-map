// "What's nearby" from our own records first (QA 18.11).
//
// The browse list asked one live Wikidata geo query and nothing else. On 18.11 a new spot
// took 13–18 s and one answered 504 at the 18 s timeout, so the list said nothing was
// here while `location_submissions` held 1,625 mappable rows in central London alone.
// So the route now reads our queue for the same circle, in parallel, and Wikidata only
// adds to it: a slow or failing WDQS can thin the list, never empty it.
//
// Pure: the route does the two reads, this file decides the answer.

import { aroundBox } from "./around-here.mjs";
import { isAlreadyShown, MATCHED_BY, submissionToLocation } from "./submission-places.mjs";

// Rows read per ask. Central London has ~1,600 in a 3 km box; a full page means the box
// was too big to be fair (rows come back in index order, south first), so the route asks
// again for a smaller box around the centre, which is what "nearby" weighs most anyway.
export const OWN_NEARBY_LIMIT = 800;
export const OWN_RETRY_SHRINK = 3;
// With our own rows in hand, Wikidata gets this long to add to them; without any, it gets
// its full timeout, since it is then the only answer there is.
export const WIKIDATA_WAIT_WITH_OWN_MS = 6000;

export function ownNearbyBox({ lat, lng, radius }) {
  return aroundBox([lat, lng], radius);
}

// A queue row → the location shape `/api/locations` answers with. The work's Wikidata id
// when it has one, so a work Wikidata also knows lands in the same group; our own id
// otherwise, which no Wikidata row can collide with.
export function ownRowsToLocations(rows, { kind = "all" } = {}) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const work = row?.works;
    if (!work?.id || !String(work.title ?? "").trim()) continue;
    if (kind !== "all" && work.kind !== kind) continue;
    const location = submissionToLocation(row, {
      work: { id: work.wikidata_id || `work:${work.id}`, title: work.title, year: work.year ?? null },
      kind: work.kind,
      matchedBy: MATCHED_BY.id,
    });
    if (location) out.push(location);
  }
  return out;
}

// Wikidata's rows first (they are statements), then ours where they are not the same
// place again. The caller cuts the result to the circle and ranks it.
export function mergeNearby(wikidata, own) {
  const merged = [...(Array.isArray(wikidata) ? wikidata : [])];
  for (const location of Array.isArray(own) ? own : []) {
    if (isAlreadyShown(location, merged)) continue;
    merged.push(location);
  }
  return merged;
}

// Waits for `promise` at most `ms` (no limit when `ms` is not finite); never rejects.
// { value } | { error } | { timedOut }.
export function settleWithin(promise, ms) {
  const settled = Promise.resolve(promise).then((value) => ({ value }), (error) => ({ error }));
  // setTimeout reads Infinity as 1 ms, so an unlimited wait must not start one.
  if (!Number.isFinite(ms)) return settled;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}
