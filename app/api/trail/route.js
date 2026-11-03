import { createClient } from "@supabase/supabase-js";

import { normalizeTrailPlace } from "../../lib/story-trail.mjs";
import {
  distinctStops,
  findPlotSection,
  plotSectionFromWikitext,
  placeInPlot,
  plotPositionInput,
  plotPositionInstructions,
  plotPositionSchema,
  scenesFromPlacement,
} from "../../lib/plot-order.mjs";
import { sceneNote } from "../../lib/place-note.mjs";
import {
  articleTitleFromEntity,
  buildEntitiesUrl,
  buildSectionUrl,
  buildTocUrl,
  cleanWikitext,
  permalink,
} from "../../lib/wikipedia-source.mjs";
import { enrichGuard } from "../../lib/enrich-auth.mjs";
import { createModelClient, parseStructured, TIERS } from "../../lib/model-client.mjs";
import { USER_AGENT } from "../../lib/user-agent.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const WIKIPEDIA = { "User-Agent": USER_AGENT };

// Three passes over the same plot. Each quote is checked against the text, so their union
// cannot add a claim the plot does not support — it only recovers what one pass missed.
// Measured: two runs of two passes each over the same 17 films found different subsets —
// Love Actually placed Selfridges and Elliott School in one and neither in the other —
// so recall, not precision, is what more passes buy. A pass costs about half a cent.
export const PLOT_PASSES = 3;

// The model that copies quotes. Measured on 2026-10-02: gpt-5-nano returned one quote for
// thirteen locations and that one was not in the text; gpt-5-mini returned six, all
// verbatim. The free OpenRouter model configured for the cheap tier cannot take a JSON
// schema at all.
export const DEFAULT_TRAIL_MODEL = "gpt-5-mini";
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function defaultCreateStore(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    async loadWork(workId) {
      const { data, error } = await client
        .from("works")
        .select("id, title, kind, year, wikidata_id")
        .eq("id", workId)
        .maybeSingle();
      if (error) throw new Error(`work load failed: ${error.message}`);
      return data;
    },
    // The places we already hold for this work, each with what the location guide says it
    // plays in this work — "Appears as 'Grand Hotel (exterior)'". The guide line is what
    // lets the plot be searched for the scene at all.
    async workPlaces(workId) {
      const { data, error } = await client
        .from("work_place_links")
        .select("place_id, places ( id, name, lat, lng, geocode_precision )")
        .eq("work_id", workId)
        .is("scene_id", null);
      if (error) throw new Error(`work places load failed: ${error.message}`);
      const places = (data ?? [])
        .map((row) => row.places)
        .filter((place) => place && place.lat !== null && place.lng !== null);

      const { data: notes, error: notesError } = await client
        .from("location_submissions")
        .select("place_id, source_sentence")
        .eq("work_id", workId)
        .not("place_id", "is", null);
      if (notesError) throw new Error(`guide lines load failed: ${notesError.message}`);
      const plays = new Map();
      for (const row of notes ?? []) {
        const note = sceneNote(row.source_sentence, { limit: 160 });
        if (note && !plays.has(row.place_id)) plays.set(row.place_id, note);
      }
      return places.map((place) => ({ ...place, plays: plays.get(place.id) ?? null }));
    },
    // The film's plot as Wikipedia tells it: the text the order is read from.
    async plotOf(work) {
      if (!work?.wikidata_id) return null;
      const entities = await (await fetch(buildEntitiesUrl([work.wikidata_id], ["en"]), { headers: WIKIPEDIA })).json();
      const title = articleTitleFromEntity(entities?.entities?.[work.wikidata_id], "en");
      if (!title) return null;
      const tocResponse = await fetch(buildTocUrl(title, "en"), { headers: WIKIPEDIA });
      let wikitext;
      let revid;
      if (tocResponse.ok) {
        const toc = await tocResponse.json();
        const index = findPlotSection(toc?.parse?.tocdata);
        if (!index) return null;
        const section = await (await fetch(buildSectionUrl(title, index, "en"), { headers: WIKIPEDIA })).json();
        wikitext = section?.parse?.wikitext ?? "";
        // The revision, so the evidence points at the text that was read, not whatever the
        // article says later.
        revid = toc?.parse?.revid ?? null;
      } else {
        // The action API rate-limits shared egress (429); the REST source is the same text.
        const page = await fetch(
          `https://en.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(title.replace(/ /g, "_"))}`,
          { headers: WIKIPEDIA },
        );
        if (!page.ok) throw new Error(`wikipedia ${tocResponse.status}, rest ${page.status}`);
        const body = await page.json();
        wikitext = plotSectionFromWikitext(body?.source) ?? "";
        revid = body?.latest?.id ?? null;
      }
      const plot = cleanWikitext(wikitext);
      return plot ? { title, text: plot, url: revid ? permalink(title, revid, "en") : `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` } : null;
    },
    // A scene is set ON the link that says the work was filmed at the place — never a new
    // link beside it, which the evidence trigger refuses and which would read as "the
    // story is set here". The quote that placed it goes in as its evidence, in the same
    // transaction (see place_scene_on_link).
    async linkScenes(workId, links) {
      let linked = 0;
      for (const link of links) {
        const { data, error } = await client.rpc("place_scene_on_link", {
          p_work_id: workId,
          p_place_id: link.place_id,
          p_scene_id: link.scene_id,
          p_order: link.sequence_index,
          p_source_url: link.source_url,
          p_quote: link.quote,
          p_model: link.model ?? null,
        });
        if (error) throw new Error(`scene link failed: ${error.message}`);
        if (data) linked += 1;
      }
      return linked;
    },
    // The cache IS the scenes table: if a work already has a trail, there is nothing
    // to extract and no model call to pay for.
    async existingScenes(workId) {
      const { data, error } = await client
        .from("scenes")
        .select("id, sequence_index, act_or_chapter, plot_beat, safe_teaser, spoiler_tier, is_fictional_setting")
        .eq("work_id", workId)
        .order("sequence_index", { ascending: true });
      if (error) throw new Error(`scenes load failed: ${error.message}`);
      return data ?? [];
    },
    async saveScenes(workId, scenes) {
      const rows = scenes.map((scene) => ({
        work_id: workId,
        sequence_index: scene.sequence_index,
        act_or_chapter: scene.place_name,
        plot_beat: scene.plot_beat,
        safe_teaser: scene.safe_teaser,
        spoiler_tier: scene.spoiler_tier,
        is_fictional_setting: scene.is_fictional_setting,
      }));
      const { data, error } = await client.from("scenes").insert(rows).select("id, sequence_index");
      if (error) throw new Error(`scenes insert failed: ${error.message}`);
      return data ?? [];
    },
  };
}

// POST /api/trail { work_id }
//
// Put a work's known locations in STORY order, so the map can be walked as the story
// goes rather than by geographic convenience.
//
// The order is read from the plot as Wikipedia tells it, never from a model's memory — see
// plot-order.mjs for what that cost to learn. The model only copies the passage where each
// location's scene happens; this route finds the passage in the text, and its position is
// the order. Every stop is one of our places, chosen from a closed list, so a trail can only
// ever point at somewhere we already hold. Cached in the scenes table: the plot does not
// change, so a second request costs nothing.
// Nothing to order is an honest answer, not an error — and it must not be cached as if
// it were a trail, or the work would be marked as having no story for good.
function notYet(workId, reason) {
  return Response.json({ work_id: workId, cached: false, scenes: [], reason }, { headers: noStoreHeaders });
}

export function createTrailHandler({
  env = process.env,
  createRuntime = (env) => createModelClient(
    { ...env, OPENAI_MODEL: env.OPENAI_TRAIL_MODEL || DEFAULT_TRAIL_MODEL },
    { tier: TIERS.CAREFUL },
  ),
  createStore,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeStore = createStore ?? (() => defaultCreateStore(env));

  return async function POST(request) {
    // Before anything is read, parsed, or paid for.
    const refusal = enrichGuard(request, env);
    if (refusal) return refusal;

    const body = await request.json().catch(() => null);
    const workId = body?.work_id;
    if (!workId || !UUID.test(workId)) return jsonError("Provide a work_id", 400);

    const store = makeStore(env);
    if (!store) return jsonError("Trail extraction is not configured", 503);

    try {
      const cached = await store.existingScenes(workId);
      if (cached.length > 0) {
        return Response.json(
          { work_id: workId, cached: true, scenes: cached },
          { headers: noStoreHeaders },
        );
      }

      const work = await store.loadWork(workId);
      if (!work) return jsonError("No such work", 404);
      const runtime = createRuntime(env);
      if (!runtime) return jsonError("No model key is configured.", 503);

      // Neither of these is cached: a work gains places and an article gains a plot.
      const knownPlaces = await store.workPlaces(workId);
      if (knownPlaces.length === 0) return notYet(workId, "no_known_places");
      const plot = await store.plotOf(work);
      if (!plot?.text) return notYet(workId, "no_plot_to_order_by");

      const locations = knownPlaces.map((place) => (
        place.plays ? { location: place.name, appears_as: place.plays } : { location: place.name }));
      const passes = [];
      for (let pass = 0; pass < PLOT_PASSES; pass += 1) {
        const result = await parseStructured({
          runtime,
          schema: plotPositionSchema,
          schemaName: "plot_positions",
          instructions: plotPositionInstructions(),
          input: plotPositionInput({ title: work.title, year: work.year, locations, plot: plot.text }),
          maxTokens: 12000,
        });
        // One pass failing is a smaller trail, not a lost one; both failing is an error.
        if (result.ok) passes.push(result.parsed);
      }
      if (passes.length === 0) throw new Error("Trail extraction: no pass succeeded");

      const placed = distinctStops(
        placeInPlot(plot.text, passes, locations),
        new Map(knownPlaces.map((place) => [place.name, {
          lat: place.lat, lng: place.lng, precision: place.geocode_precision,
        }])),
      );
      if (placed.length === 0) return notYet(workId, "nothing_placed_in_plot");

      const scenes = scenesFromPlacement(placed, { title: plot.title });
      const saved = await store.saveScenes(workId, scenes);

      // Every scene names one of OUR places by construction; the lookup is exact.
      const placeByKey = new Map(
        knownPlaces.map((place) => [normalizeTrailPlace(place.name), place.id]),
      );
      const sceneIdByIndex = new Map(saved.map((row) => [row.sequence_index, row.id]));
      const links = scenes
        .map((scene) => ({
          place_id: placeByKey.get(normalizeTrailPlace(scene.known_place)),
          scene_id: sceneIdByIndex.get(scene.sequence_index),
          sequence_index: scene.sequence_index,
          source_url: plot.url ?? null,
          quote: scene.quote,
          model: runtime.model ?? null,
        }))
        .filter((link) => link.place_id && link.scene_id);

      let linked = 0;
      try {
        linked = await store.linkScenes(workId, links);
      } catch (error) {
        // The scenes are saved and useful on their own; a failed link is a missing
        // pin, not a reason to lose the extraction.
        logError("trail: scene linking failed", { message: error?.message });
      }

      return Response.json(
        { work_id: workId, cached: false, extracted: saved.length, linked, known: knownPlaces.length, scenes },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Trail extraction failed", { message: error?.message });
      return jsonError("Could not extract the story trail", 502);
    }
  };
}

export const POST = createTrailHandler();
