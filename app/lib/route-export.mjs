// The walk, handed to the apps people already navigate with (#191, item 2).
//
// We draw the route and do not do turn-by-turn, and should not try. So the five stops go
// out two ways, neither needing a key, an account or a licence review, because handing a
// person their own stops is not redistributing anybody's data:
//
//   * a Google Maps directions link (`api=1`), which opens in their Google Maps app;
//   * a GPX file, which Organic Maps, OsmAnd, Gaia, Komoot and Google My Maps all import,
//     and which works with no signal at all.
//
// Positions in the app are [lat, lng]; GPX writes them as attributes and Google as "lat,lng".

// Google's limit for an `api=1` directions link: origin, destination and nine waypoints.
export const GOOGLE_MAX_STOPS = 11;

function point(position) {
  const [lat, lng] = Array.isArray(position) ? position : [];
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return [Number(la.toFixed(6)), Number(ln.toFixed(6))];
}

function usableStops(stops) {
  return (Array.isArray(stops) ? stops : [])
    .map((stop) => ({ name: stop?.place ?? stop?.name ?? null, at: point(stop?.position) }))
    .filter((stop) => stop.at);
}

// Null when there is nothing to route, or more stops than Google takes in one link.
export function googleMapsDirectionsUrl(stops) {
  const usable = usableStops(stops);
  if (usable.length < 2 || usable.length > GOOGLE_MAX_STOPS) return null;
  const text = (stop) => stop.at.join(",");
  const params = new URLSearchParams({
    api: "1",
    origin: text(usable[0]),
    destination: text(usable[usable.length - 1]),
    travelmode: "walking",
  });
  const middle = usable.slice(1, -1);
  if (middle.length) params.set("waypoints", middle.map(text).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function xml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// The stops as waypoints, in walking order, and the drawn route as a track when there is
// one. A straight-line fallback route is still a track: it is what the map showed.
export function routeGpx({ name = "GloryMap walk", stops = [], track = [] } = {}) {
  const usable = usableStops(stops);
  const line = (Array.isArray(track) ? track : []).map(point).filter(Boolean);
  const waypoints = usable.map((stop, index) =>
    `  <wpt lat="${stop.at[0]}" lon="${stop.at[1]}"><name>${xml(`${index + 1}. ${stop.name ?? "Stop"}`)}</name></wpt>`);
  const trk = line.length >= 2
    ? [
      `  <trk><name>${xml(name)}</name><trkseg>`,
      ...line.map(([lat, lng]) => `    <trkpt lat="${lat}" lon="${lng}"/>`),
      "  </trkseg></trk>",
    ]
    : [];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="GloryMap" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xml(name)}</name></metadata>`,
    ...waypoints,
    ...trk,
    "</gpx>",
    "",
  ].join("\n");
}

export function gpxFileName(cityName) {
  const slug = String(cityName ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug ? `${slug}-` : ""}glorymap-walk.gpx`;
}
