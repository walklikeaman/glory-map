#!/usr/bin/env node
//
// GloryMap as tools a Claude agent can call.
//
//   claude mcp add glorymap -- node /path/to/mcp/glorymap-server.mjs
//
// [[trip-agent-bridge]] built `POST /api/trip/plan` and deliberately did not guess the
// transport, because the four candidates — an MCP session, a third-party product, a custom
// GPT, something still being written — want four different wrappers. The owner answered it
// on 11.09: **his trip agent is a Claude agent.** So the wrapper is MCP, and this is it.
//
// **It calls the deployed API, it does not reimplement it.** Every honesty rule this
// project has — a candidate labelled as a candidate, a studio lot flagged as one, a source
// named on every stop, a coordinate that may be missing — lives in those routes. A server
// that queried the database directly would have to re-derive all of it and would drift, and
// the drift would be invisible: an agent cannot see that the pin it was handed should have
// been hollow.
//
// **Read-only, and public.** Nothing here writes, and it uses no credential: the routes it
// calls are the ones the browser calls. That also means it redistributes nothing the site
// does not already show — the open question in #191 is about serving this to third parties,
// and an agent acting for the owner on his own machine is not that.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { metresApart, namesMatch, normalizePlaceName } from "../app/lib/place-dedup.mjs";
import { sceneNote } from "../app/lib/place-note.mjs";

const BASE = (process.env.GLORYMAP_URL ?? "https://glory-map.vercel.app")
  .replace(/\/+$/, "");
const TIMEOUT_MS = 20_000;

// The owner's own account, if he set one up. Everything here works without it — the token
// buys exactly one thing, which is "plan from MY films" without the agent carrying 2,798
// titles in every call. It is read from the environment and never from a tool argument, so
// a prompt cannot talk the server into using somebody else's.
const TOKEN = process.env.GLORYMAP_TOKEN?.trim() || null;

async function api(path, init) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  if (!response.ok) {
    throw new Error(`${path} → ${response.status}: ${body?.error ?? text.slice(0, 200)}`);
  }
  return body;
}

const asText = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 1) }] });

// The same place, named twice by two sources, is the map contradicting itself — and an
// agent reading a list cannot see that "Frolic Room" and "Frolic Room, Hollywood Boulevard,
// Hollywood" are one bar. Observed on the first real call: six stops along Hollywood
// Boulevard were four places.
//
// `namesMatch` is the project's own rule and it REFUSES "National Gallery" against
// "National Portrait Gallery" on purpose. It also refuses **"Frolic Room"** against
// **"Frolic Room, Hollywood Boulevard, Hollywood"**, because it allows the longer name only
// ONE extra word — and that is correct where it is used, which is merging rows INTO the
// graph, where a wrong merge is a false claim about where something happened.
//
// Here the case is narrower and the risk is smaller. MovieLocations appends the address to
// the place name as a matter of format, so the second string is the first plus a tail; and
// this is a LIST handed to an agent, not a row written to the graph — a wrong grouping
// shows two films under one heading and is visible in the payload, where a wrong merge in
// the graph is not. So the extra rule is: one name is a prefix of the other, they are
// within 150 m, and nothing is written anywhere.
function sameSpotName(a, b) {
  if (namesMatch(a, b)) return true;
  const left = normalizePlaceName(a);
  const right = normalizePlaceName(b);
  if (!left || !right) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  // A real name, not "the" or "a" — a two-character prefix would match half the city.
  if (shorter.split(" ").length < 2) return false;
  return longer.startsWith(`${shorter} `);
}
function mergeSameSpot(points) {
  const kept = [];
  for (const point of points) {
    const twin = kept.find((other) => {
      const metres = metresApart(
        { lat: point.lat, lng: point.lng },
        { lat: other.lat, lng: other.lng },
      );
      return metres !== null && metres <= 150 && sameSpotName(point.place, other.place);
    });
    if (!twin) { kept.push({ ...point, also_named: [] }); continue; }
    // The films merge; the shorter name wins, because the long ones are sentences about
    // the scene rather than names of the place.
    const seen = new Set(twin.films.map((f) => `${f.title}:${f.year ?? ""}`));
    for (const film of point.films) {
      const key = `${film.title}:${film.year ?? ""}`;
      if (!seen.has(key)) { seen.add(key); twin.films.push(film); }
    }
    twin.film_count = twin.films.length;
    if (point.place.length < twin.place.length) {
      twin.also_named.push(twin.place);
      twin.place = point.place;
    } else if (!twin.also_named.includes(point.place)) {
      twin.also_named.push(point.place);
    }
    twin.studio_lot = twin.studio_lot ?? point.studio_lot;
  }
  return kept;
}

// A degree of latitude is ~111 km everywhere; a degree of longitude shrinks with the
// cosine of the latitude. Both matter at the scale of a walk, where 500 m is the question.
function boxAround(lat, lng, radiusM) {
  const dLat = radiusM / 111_000;
  const dLng = radiusM / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

function metresBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

// The sentence every answer carries. An agent reading a list of addresses has no hollow
// pin to look at, so the labelling has to be words — and the numbers are not incidental:
// in Los Angeles the graph holds ONE verified place against 5,266 queue rows.
const HONESTY = "Rows marked status=pending are CANDIDATES: a source named the place and "
  + "nobody on our side has verified it. Say so when you use them. `studio_lot` means the "
  + "camera was there and the scene is set somewhere else — do not send anybody to walk in.";

const server = new McpServer({ name: "glorymap", version: "1.0.0" });

server.tool(
  "places_near",
  "Film and TV places near a point — the fast lookup for 'what is around here'. Returns one "
    + "entry per distinct coordinate with every film listed at it, what was filmed there in "
    + "the source's own words, its IMDb score, and whether it sits inside a studio lot. Use "
    + "this to build a list of stops along a route.",
  {
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius_m: z.number().int().min(50).max(20_000).default(800)
      .describe("Metres around the point. 800 suits a walk; 5000 suits a district."),
    limit: z.number().int().min(1).max(100).default(25),
    min_imdb: z.number().min(0).max(10).default(0)
      .describe("Drop films rated below this. Unrated films are dropped too when above 0."),
  },
  async ({ lat, lng, radius_m: radiusM, limit, min_imdb: minImdb }) => {
    const box = boxAround(lat, lng, radiusM);
    const query = new URLSearchParams({
      west: String(box.west), east: String(box.east),
      south: String(box.south), north: String(box.north),
      z: "14", candidates: "1",
    });
    const body = await api(`/api/map/points?${query}`);

    const points = (body.candidates ?? [])
      .filter((f) => !f.properties?.cluster)
      .map((f) => {
        const [lo, la] = f.geometry.coordinates;
        const films = (f.properties.films ?? [])
          .filter((film) => !(minImdb > 0) || Number(film.imdb) >= minImdb)
          .map((film) => ({
            title: film.title, year: film.year, kind: film.kind,
            imdb: film.imdb ?? null, imdb_votes: film.imdb_votes ?? null,
            // What was filmed here, as the source wrote it — the thing an agent needs to
            // say anything about a stop beyond naming a film. Null where the source only
            // listed the address, and never filled in with a guess. See [[place-note]].
            scene: sceneNote(film.note, { placeName: f.properties.name }),
            said_by: film.source_kind ?? null, source_url: film.source_url ?? null,
            status: film.status ?? "pending",
          }));
        return {
          place: f.properties.name,
          area: f.properties.area_hint ?? null,
          lat: la, lng: lo,
          metres_away: metresBetween([lat, lng], [la, lo]),
          film_count: f.properties.work_count,
          studio_lot: f.properties.studio_lot?.name ?? null,
          studio_access: f.properties.studio_lot?.access ?? null,
          status: f.properties.status,
          films,
        };
      })
      .filter((p) => p.metres_away <= radiusM && p.films.length > 0)
      .sort((a, b) => a.metres_away - b.metres_away);

    const merged = mergeSameSpot(points).slice(0, limit);

    return asText({
      from: [lat, lng], radius_m: radiusM,
      returned: merged.length,
      truncated_by_server: body.candidates_truncated === true,
      note: HONESTY,
      points: merged,
    });
  },
);

server.tool(
  "places_along_route",
  "Places near a walking route: give the points you will pass and it returns what is worth "
    + "stopping for along the whole line, de-duplicated and ordered by where they fall on it. "
    + "This is the tool for 'build me a list for the route I am walking'.",
  {
    path: z.array(z.tuple([z.number(), z.number()])).min(2).max(25)
      .describe("The route as [lat, lng] points — corners are enough, not every metre."),
    corridor_m: z.number().int().min(50).max(3000).default(400)
      .describe("How far off the line still counts as on the way."),
    limit: z.number().int().min(1).max(120).default(40),
    min_imdb: z.number().min(0).max(10).default(0),
  },
  async ({ path, corridor_m: corridor, limit, min_imdb: minImdb }) => {
    const lats = path.map((p) => p[0]);
    const lngs = path.map((p) => p[1]);
    const box = boxAround((Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lngs) + Math.max(...lngs)) / 2, 0);
    const dLat = corridor / 111_000;
    const dLng = corridor / (111_000 * Math.max(0.2, Math.cos((box.south * Math.PI) / 180)));

    const query = new URLSearchParams({
      west: String(Math.min(...lngs) - dLng), east: String(Math.max(...lngs) + dLng),
      south: String(Math.min(...lats) - dLat), north: String(Math.max(...lats) + dLat),
      z: "14", candidates: "1",
    });
    const body = await api(`/api/map/points?${query}`);

    const stops = (body.candidates ?? [])
      .filter((f) => !f.properties?.cluster)
      .map((f) => {
        const [lo, la] = f.geometry.coordinates;
        // Distance to the nearest point ON the route, and how far along it that is, so the
        // agent can order stops the way somebody actually walks them.
        let nearest = Infinity;
        let atIndex = 0;
        path.forEach((point, index) => {
          const d = metresBetween(point, [la, lo]);
          if (d < nearest) { nearest = d; atIndex = index; }
        });
        const films = (f.properties.films ?? [])
          .filter((film) => !(minImdb > 0) || Number(film.imdb) >= minImdb)
          .map((film) => ({ title: film.title, year: film.year, imdb: film.imdb ?? null,
            scene: sceneNote(film.note, { placeName: f.properties.name }),
            said_by: film.source_kind ?? null, source_url: film.source_url ?? null }));
        return {
          place: f.properties.name, lat: la, lng: lo,
          metres_off_route: nearest, along_route_index: atIndex,
          film_count: f.properties.work_count,
          studio_lot: f.properties.studio_lot?.name ?? null,
          status: f.properties.status,
          films,
        };
      })
      .filter((s) => s.metres_off_route <= corridor && s.films.length > 0)
      .sort((a, b) => a.along_route_index - b.along_route_index || a.metres_off_route - b.metres_off_route);

    const merged = mergeSameSpot(stops).slice(0, limit);
    return asText({ corridor_m: corridor, returned: merged.length, note: HONESTY, stops: merged });
  },
);

server.tool(
  "film_places",
  "Everything we hold about one film: its places, the source that named each, whether "
    + "anybody checked it, and its external links. Search by title first if you lack an id.",
  { work_id: z.string().uuid().optional(), title: z.string().optional() },
  async ({ work_id: workId, title }) => {
    let id = workId;
    if (!id) {
      if (!title) throw new Error("give work_id or title");
      const found = await api(`/api/search?q=${encodeURIComponent(title)}&kind=film`);
      id = found?.suggestions?.[0]?.id ?? found?.suggestions?.[0]?.work_id;
      if (!id) return asText({ title, found: false, note: "No work matched that title." });
    }
    const body = await api(`/api/work?id=${encodeURIComponent(id)}`);
    return asText({
      work: body.work, links: body.links, ratings: body.ratings,
      verified_places: body.places,
      candidates: body.candidates,
      candidates_total: body.candidates_total,
      note: HONESTY,
    });
  },
);

server.tool(
  "place_details",
  "Everything we hold about one place: every film with a fact there, each fact's own "
    + "source, and the evidence behind it.",
  { place_id: z.string().uuid() },
  async ({ place_id: placeId }) => asText({
    ...(await api(`/api/place?id=${encodeURIComponent(placeId)}`)),
    note: HONESTY,
  }),
);

server.tool(
  "search_titles",
  "Find a film, series or book by title. Fast; use it to turn a name into an id.",
  {
    q: z.string().min(1),
    kind: z.enum(["film", "series", "book"]).default("film"),
  },
  async ({ q, kind }) => asText(await api(`/api/search?q=${encodeURIComponent(q)}&kind=${kind}`)),
);

server.tool(
  "plan_day",
  "A walkable day plan from the places in a bounding box: ordered stops, a walking route, "
    + "and a line stating how much of it is verified. Pass `library` to restrict it to the "
    + "traveller's own films — those titles are compared in memory and never stored.",
  {
    bbox: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
    // The route accepts three budgets and refuses anything else, so the tool offers the
    // three rather than letting an agent discover the rule from a 400.
    budget_minutes: z.union([z.literal(30), z.literal(60), z.literal(120)]).default(120),
    origin: z.tuple([z.number(), z.number()]).optional(),
    include_studio_lots: z.boolean().default(false),
    library: z.array(z.object({ title: z.string(), year: z.number().nullable().optional() }))
      .optional().describe("The traveller's own films, if the plan should be limited to them."),
    mine_only: z.boolean().default(false)
      .describe("Plan only from the films on the owner's account. Needs GLORYMAP_TOKEN in "
        + "the server's environment; fails loudly rather than quietly planning from "
        + "everything. Ignored when `library` is given."),
  },
  async ({ bbox, budget_minutes: budgetMinutes, origin, include_studio_lots: lots, library,
    mine_only: mineOnly }) => {
    if (mineOnly && !library && !TOKEN) {
      throw new Error("mine_only needs GLORYMAP_TOKEN set for this server — otherwise the "
        + "plan would come from the whole catalogue while claiming to be yours.");
    }
    return asText({
      ...(await api("/api/trip/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `bbox` is NESTED in the route's body and was spread flat here, so every call
        // answered 400 "Provide a bbox with west, south, east and north".
        body: JSON.stringify({
          bbox, budgetMinutes, origin, includeStudioLots: lots, library,
          useStoredLibrary: mineOnly === true,
        }),
      })),
      note: HONESTY,
    });
  },
);

server.tool(
  "my_library",
  "What the owner's account holds: how many titles, how many rated, and the five most "
    + "recent — enough to tell 'your films are not in this city' from 'your list never "
    + "arrived'. Needs GLORYMAP_TOKEN. Never returns the list itself.",
  {},
  async () => {
    if (!TOKEN) throw new Error("No GLORYMAP_TOKEN is set for this server.");
    return asText(await api("/api/library"));
  },
);

await server.connect(new StdioServerTransport());
