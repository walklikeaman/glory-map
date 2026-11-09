// The Places list for one picked work (QA 03.11–09.11).
//
// Picking a film from search filters the MAP to that film, but the Places tab kept listing
// the nearby Wikidata search — picking Notting Hill over London listed Tinker Tailor Soldier
// Spy and A Fish Called Wanda, and none of Notting Hill's own places. The film's places are
// already loaded from /api/work for the story trail; this turns them into the rows the list,
// the place card and the route all take, in the same shape as `locationsFromApi`.
export function workPlacesAsLocations(work, places) {
  if (!work?.id || !Array.isArray(places)) return [];
  const kind = work.kind ?? "film";
  return places
    .filter((place) => {
      const lat = Number(place?.lat);
      const lng = Number(place?.lng);
      return place?.lat != null && place?.lng != null
        && Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    })
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
    }));
}
