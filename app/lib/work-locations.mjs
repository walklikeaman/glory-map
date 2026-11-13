// The Places list for one picked work (QA 03.11–09.11).
//
// Picking a film from search filters the MAP to that film, but the Places tab kept listing
// the nearby Wikidata search — picking Notting Hill over London listed Tinker Tailor Soldier
// Spy and A Fish Called Wanda, and none of Notting Hill's own places. The film's places are
// already loaded from /api/work for the story trail; this turns them into the rows the list,
// the place card and the route all take, in the same shape as `locationsFromApi`.
function finiteCoordinate(row) {
  if (row?.lat == null || row?.lng == null) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // Null Island is a missing coordinate written as zeros, not a filming location.
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}

export function workPlacesAsLocations(work, places) {
  if (!work?.id || !Array.isArray(places)) return [];
  const kind = work.kind ?? "film";
  return places
    .filter((place) => finiteCoordinate(place))
    .map((place) => ({
      id: `${kind}-${work.id}-${place.id}`,
      filmId: work.wikidata_id ?? work.id,
      film: work.title ?? "",
      scene: place.role_label ?? (kind === "book" ? "Story setting" : "Filming location"),
      place: place.name,
      description: place.sentence ?? `${place.name} is connected with ${work.title}.`,
      position: [Number(place.lat), Number(place.lng)],
      locationId: place.wikidata_id ?? null,
      backdrop: null,
      backdropVerified: false,
      now: null,
      filmTmdbId: work.tmdb_id ?? null,
      sceneMatchToken: null,
      year: work.year ?? null,
      kind,
      relationKind: "filming_location",
      precision: place.precision ?? "unknown",
      display: "pin",
      precisionCaveat: null,
      isCandidate: false,
      sourceUrl: null,
      sourceTitle: null,
      evidenceSource: "graph",
      // Not from the nearby answer, so a reload of that answer must not close its card.
      fromPickedWork: true,
    }));
}


// The same picked work's UNCONFIRMED rows (QA 13.11). /api/work already returns them as
// `candidates` — 46 for Twin Peaks against 5 confirmed places — but the map drew only the
// confirmed five, because the queue layer skips a work-scoped view. So "open a film and see
// all its places" showed a fraction of what we hold. These are the rows the map draws as
// hollow pins when "Unconfirmed places" is on; `isCandidate` keeps the card from
// presenting them as fact.
//
// A row that repeats one of the work's confirmed places — the same name, or within a few
// metres — is left out: MovieMaps and Wikidata both know Ennis House, and drawing it twice
// is the map contradicting itself (and a doubled stop on a route).
const SAME_SPOT_DEGREES = 0.0005; // ~50 m

function nameKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function workCandidatesAsLocations(work, candidates, { confirmed = [] } = {}) {
  if (!work?.id || !Array.isArray(candidates)) return [];
  const kind = work.kind ?? "film";
  const shown = (Array.isArray(confirmed) ? confirmed : [])
    .map((place) => ({ name: nameKey(place?.name), position: finiteCoordinate(place) }));
  const repeatsConfirmed = (row, position) => shown.some((place) =>
    (place.name && place.name === nameKey(row.name))
    || (place.position
      && Math.abs(place.position[0] - position[0]) < SAME_SPOT_DEGREES
      && Math.abs(place.position[1] - position[1]) < SAME_SPOT_DEGREES));
  return candidates
    .filter((row) => row?.mappable !== false)
    .map((row) => ({ row, position: finiteCoordinate(row) }))
    .filter(({ row, position }) => position && !repeatsConfirmed(row, position))
    .map(({ row, position }) => ({
      id: `${kind}-${work.id}-unconfirmed-${row.id}`,
      filmId: work.wikidata_id ?? work.id,
      film: work.title ?? "",
      scene: kind === "book" ? "Story setting" : "Filming location",
      place: row.name,
      description: row.sentence ?? `${row.name} is reported as connected with ${work.title}.`,
      position,
      locationId: null,
      backdrop: null,
      backdropVerified: false,
      now: null,
      filmTmdbId: work.tmdb_id ?? null,
      sceneMatchToken: null,
      year: work.year ?? null,
      kind,
      relationKind: "candidate",
      // `precision` on these rows is a review badge ("Source checked" / "Unconfirmed"), not
      // how exactly the point is placed, so it is not passed on as one.
      precision: "unknown",
      display: "pin",
      precisionCaveat: null,
      // A row a moderator verified is drawn solid, as it is in the map's own queue layer.
      isCandidate: row.status !== "verified",
      sourceUrl: row.source_url ?? null,
      // Who reported it — the card names the source instead of guessing how it was found.
      // Inside a studio lot `role_label` is the lot's access note, not a source.
      sourceTitle: row.studio_lot ? null : row.role_label ?? null,
      evidenceSource: "queue",
      studioLot: Boolean(row.studio_lot),
      fromPickedWork: true,
    }));
}

// The box around a work's places, as [[west, south], [east, north]] — what the map fits
// when a work is picked, so its places are on screen instead of wherever the map was.
// Null when there is nothing to fit.
//
// The farthest tenth is left out of the FRAME (never off the map). Twin Peaks has 50 pins
// between Los Angeles and Snoqualmie and one in upstate New York; framing all of them put
// the whole country on screen and every one of the 50 under the panel. Fewer than ten
// places keep every one, so a film shot in two cities still shows both.
export function boundsOfPositions(positions, { keepShare = 0.9 } = {}) {
  const points = (Array.isArray(positions) ? positions : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!points.length) return null;

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const centre = [median(points.map((p) => p[0])), median(points.map((p) => p[1]))];
  const cos = Math.cos((centre[0] * Math.PI) / 180);
  const distance = ([lat, lng]) => Math.hypot(lat - centre[0], (lng - centre[1]) * cos);
  const keep = Math.max(Math.min(points.length, 9), Math.ceil(points.length * keepShare));
  const framed = [...points].sort((a, b) => distance(a) - distance(b)).slice(0, keep);

  let [south, west] = framed[0];
  let [north, east] = framed[0];
  for (const [lat, lng] of framed) {
    south = Math.min(south, lat); north = Math.max(north, lat);
    west = Math.min(west, lng); east = Math.max(east, lng);
  }
  return [[west, south], [east, north]];
}

// What of the map is covered, as fitBounds padding. The panel sits over the left of the
// map on a desktop and over the bottom on a phone, and a frame that ignores it puts the
// places it was asked to show underneath it. `covers` are the client rects of whatever
// floats over the map; a column on the left pads the left, anything low pads the bottom,
// and a bar across the top pads the top.
export function paddingForCovers(covers, { width, height }, base = 48) {
  const padding = { top: base, right: base + 24, bottom: base, left: base };
  if (!Number.isFinite(width) || !Number.isFinite(height)) return padding;
  for (const rect of Array.isArray(covers) ? covers : []) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
    if (rect.left < width / 2 && rect.width < width / 2 && rect.height > height / 4 && rect.top < height / 2) {
      padding.left = Math.max(padding.left, rect.right + 24);
    } else if (rect.top > height / 2) {
      padding.bottom = Math.max(padding.bottom, height - rect.top + 16);
    } else if (rect.bottom < height / 4 && rect.width > width / 2) {
      padding.top = Math.max(padding.top, rect.bottom + 16);
    }
  }
  return padding;
}
