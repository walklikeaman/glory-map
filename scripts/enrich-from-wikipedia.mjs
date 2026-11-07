#!/usr/bin/env node
//
// Read filming locations out of Wikipedia prose and queue them for review (#47).
//
//   node scripts/enrich-from-wikipedia.mjs [--limit 5] [--dry-run] [--work <uuid>]
//                                          [--languages 3]
//
// Deliberately a script and not a route. It is slow by design — one request a second
// to Wikimedia, five seconds between Wikidata queries — because the pacing is the
// difference between being a good citizen of two free services and being blocked by
// them. Nothing about this needs to happen while somebody waits.
//
// Nothing it produces reaches the map. Every location lands in `location_submissions`
// as `pending`, which is the queue #48's review gate was built for.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  apiError,
  articleTitleFromEntity,
  buildEntitiesUrl,
  MAX_ENTITIES_PER_REQUEST,
  buildRawUrl,
  buildSectionUrl,
  buildTocUrl,
  sectionFromWikitext,
  tocFromWikitext,
  chooseSection,
  cleanWikitext,
  languagesForWork,
  MAX_LANGUAGES_PER_WORK,
  isRetryableApiError,
  isQueryServiceLag,
  withoutMaxlag,
  MAX_RETRY_ATTEMPTS,
  MIN_REQUEST_GAP_MS,
  retryAfterMs,
  USER_AGENT,
  wikipediaAttribution,
} from "../app/lib/wikipedia-source.mjs";
import {
  acceptExtraction,
  buildExtractionInput,
  extractionInstructions,
  wikipediaLocationsSchema,
} from "../app/lib/wikipedia-extract.mjs";
import { WIKIDATA_LICENSE } from "../app/lib/geocode-wikidata.mjs";
import { createGeocoder } from "../app/lib/geocode-client.mjs";
import { samePlaceWritten } from "../app/lib/place-name-head.mjs";
import { normalizePlaceName } from "../app/lib/place-dedup.mjs";
import { createModelClient, createThrottle, dailyQuotaSpent, parseStructured } from "../app/lib/model-client.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tokens a paid provider reported, printed at the end so a run's cost is in front of
// whoever decides on the next, bigger one.
const spent = { input: 0, output: 0, calls: 0 };
process.on("exit", () => {
  if (spent.calls) console.log(`\nmodel usage: ${spent.calls} calls, ${spent.input} input + ${spent.output} output tokens`);
});

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number.parseInt(arg("limit", "5"), 10) || 5;
const ONE_WORK = arg("work", null);
// Books and films are enriched from differently-named sections, so a run is usually one
// kind at a time — `--kind book` reads the nine books, which no run could reach before.
const KIND = arg("kind", null);
// Re-read works that have already been attempted. For when the extractor itself has
// changed and the old verdicts are worth revisiting — not for ordinary runs.
const AGAIN = process.argv.includes("--again");
// Only the works one ingest created — `--source wikidata` reads the Israeli catalogue
// (scripts/ingest-country-works.mjs) without touching the 6,000 harvested before it.
const SOURCE = arg("source", null);
// Read articles through `index.php?action=raw` instead of the action API, which answers the
// cloud egress with 429 on every call (07.11.2026). See buildRawUrl.
const RAW = process.argv.includes("--raw");

// The exit status that tells scripts/enrich-loop.sh "the model's daily allowance is spent —
// start again after it resets", as distinct from a crash (1) or a finished catalogue (0).
// 75 is EX_TEMPFAIL: a temporary failure, try later.
const QUOTA_SPENT_EXIT = 75;
let quotaSpent = false;

// Extraction outcomes that say nothing about the article and so leave the work open.
const TRANSIENT_EXTRACTION = new Set(["request_failed", "rate_limited"]);
// How many network failures in a row mean "offline" rather than "one bad request".
const OUTAGE_AFTER_FAILURES = 6;
const OUTAGE_PROBE_MS = 30_000;
const LANGUAGES = Number.parseInt(arg("languages", ""), 10) || MAX_LANGUAGES_PER_WORK;

const headers = { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" };

// The latest revision of an article, from the query service's MediaWiki bridge — the one
// Wikimedia path that answers when the action API does not.
async function latestRevision(title, language) {
  const safe = title.replace(/["\\]/g, "");
  const query = `SELECT ?rev WHERE { SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "${language}.wikipedia.org"; wikibase:api "Generator";
      mwapi:generator "allpages"; mwapi:gapfrom "${safe}"; mwapi:gapto "${safe}"; mwapi:prop "info" .
    ?rev wikibase:apiOutput "@lastrevid" . } }`;
  const response = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
    headers: { ...headers, Accept: "application/sparql-results+json" },
  });
  if (!response.ok) throw new Error(`query service HTTP ${response.status}`);
  const rev = (await response.json()).results.bindings[0]?.rev?.value;
  if (!rev) throw new Error("missingtitle: no such article (or a redirect)");
  return rev;
}

// The `--raw` stand-in for the two parse calls: one raw read, pinned to that revision.
async function rawArticle(title, language) {
  const revid = await latestRevision(title, language);
  let response;
  // The page path is limited too, only more loosely: a burst of reads earns a 429 with a
  // Retry-After, and waiting it out is enough.
  for (let attempt = 1; ; attempt += 1) {
    response = await fetch(buildRawUrl(title, revid, language), { headers });
    if (response.status !== 429 || attempt > MAX_RETRY_ATTEMPTS) break;
    const wait = retryAfterMs(response, 30_000) * attempt;
    console.log(`   waiting ${wait / 1000}s (429)`);
    await sleep(wait);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const wikitext = await response.text();
  await sleep(MIN_REQUEST_GAP_MS);
  return { revid: Number(revid), wikitext, tocdata: tocFromWikitext(wikitext) };
}

async function wikimedia(url, attempt = 1) {
  const response = await fetch(url, { headers });
  // 429/503 carry Retry-After and it is the source of truth, not a guess of ours.
  if ((response.status === 429 || response.status === 503) && attempt <= MAX_RETRY_ATTEMPTS) {
    const wait = retryAfterMs(response, 60_000);
    console.log(`   waiting ${wait / 1000}s (${response.status})`);
    await sleep(wait);
    return wikimedia(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();

  // Wikimedia answers BOTH a missing page and a lagged replica with 200 and an error
  // body, and only one of them is worth asking about again. We send maxlag=5 on every
  // request, so being told the replicas are behind is the API honouring that — not a
  // failure, and certainly not a reason to abandon the run.
  // **A lagged Query Service is not a lagged read.** Asked again without `maxlag`, the
  // very same request answers in full — see `isQueryServiceLag`. Done once per URL:
  // `withoutMaxlag` answers null when there is nothing left to drop, so this cannot loop,
  // and the attempt counter is left alone because no retry has been spent.
  const withoutTheLagCheck = isQueryServiceLag(payload) ? withoutMaxlag(url) : null;
  if (withoutTheLagCheck) {
    console.log(`   ${apiError(payload)} — that is the query service, which this run never reads; asking again without maxlag`);
    await sleep(MIN_REQUEST_GAP_MS);
    return wikimedia(withoutTheLagCheck, attempt);
  }

  if (isRetryableApiError(payload) && attempt <= MAX_RETRY_ATTEMPTS) {
    // Retry-After is a floor, not a promise. Repeating it unchanged against a lag that
    // is not moving just asks the same question five times; each attempt waits longer.
    const wait = retryAfterMs(response) * attempt;
    console.log(`   ${apiError(payload)} — retrying in ${wait / 1000}s`);
    await sleep(wait);
    return wikimedia(url, attempt + 1);
  }

  const error = apiError(payload);
  if (error) throw new Error(error);
  await sleep(MIN_REQUEST_GAP_MS);
  return payload;
}

// The same geocoder the discovery route uses. Two implementations of "turn a name into
// a point" would drift, and the one that drifted would be the one inventing coordinates.
// Anything it refuses stays without a coordinate rather than being guessed at — the
// submission is still a real claim.
const geocode = createGeocoder({ onNote: (note) => console.log(`   ${note}`) });

async function main() {
  const env = process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  // Naming BOTH when only one is missing sends someone to check the variable that was
  // already fine. Say which, and where it goes.
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(", ")}`);
    console.error("Add it to .env.local and run with:");
    console.error("  node --env-file=.env.local scripts/enrich-from-wikipedia.mjs");
    console.error("Edit the file in an editor rather than echoing the value —");
    console.error("a secret typed into a shell stays in your history.");
    process.exit(1);
  }
  const runtime = createModelClient(env);
  if (!runtime && !DRY_RUN) {
    console.error("No model key configured. Add OPENROUTER_API_KEY (free models) or");
    console.error("OPENAI_API_KEY to .env.local, or pass --dry-run to fetch prose only.");
    process.exit(1);
  }
  if (runtime) console.log(`model: ${runtime.model} via ${runtime.provider}`);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  // Free endpoints share one per-account bucket. Pacing here is cheaper than learning
  // the limit by breaching it, and this job has no deadline.
  const throttle = createThrottle(Number(env.MODEL_REQUESTS_PER_MINUTE) || 12);

  // **Continue, rather than repeat.** This query had no ordering and no record of what had
  // already been read, so a second run did the first run's works again. That was invisible
  // while the pipeline could see 28 works; after the IMDb→Wikidata backfill it can see
  // 5,480, and "run it for the next batch" silently meant "run it again".
  //
  // `wikipedia_enriched_at` is stamped whether or not a work yields anything, because most
  // yield nothing — no production section, or nothing that survives the gates — and those
  // are exactly the works that must not be retried forever.
  let query = db.from("works").select("id, title, kind, year, wikidata_id")
    .not("wikidata_id", "is", null)
    .order("id", { ascending: true });
  if (!AGAIN) query = query.is("wikipedia_enriched_at", null);
  if (ONE_WORK) query = query.eq("id", ONE_WORK);
  if (KIND) query = query.eq("kind", KIND);
  if (SOURCE) query = query.eq("source", SOURCE);
  const { data: works, error } = await query.limit(LIMIT);
  if (error) throw new Error(error.message);
  if (!works?.length) { console.log("Nothing to enrich."); return; }

  // **The API allows 50 ids per request, and the run has to respect that itself.**
  //
  // This asked for all of them in one call. `buildEntitiesUrl` answers null above the
  // ceiling — correctly, rather than building a URL that would be refused — and the null
  // arrived at `fetch` as *"Failed to parse URL from null"*, which names neither the limit
  // nor the caller. It had never shown up because the default limit is five works; the run
  // that first asked for 200 died on its first call.
  const entities = { entities: {} };
  const ids = works.map((work) => work.wikidata_id);
  for (let from = 0; from < ids.length; from += MAX_ENTITIES_PER_REQUEST) {
    const url = buildEntitiesUrl(ids.slice(from, from + MAX_ENTITIES_PER_REQUEST));
    if (!url) continue;
    const page = await wikimedia(url);
    Object.assign(entities.entities, page?.entities ?? {});
  }

  // The stamp's own write can fail, and on the run that exposed this it did, silently,
  // hundreds of times. Now it says so.
  async function stamp(work) {
    if (DRY_RUN) return;
    const { error: stampError } = await db.from("works")
      .update({ wikipedia_enriched_at: new Date().toISOString() }).eq("id", work.id);
    if (stampError) console.log(`   stamp failed: ${stampError.message} — the next run will ask again`);
  }

  // **An outage is waited out rather than marched through.** Consecutive network failures
  // mean the machine is offline — asleep, or its connection gone — and every work visited
  // meanwhile is a work read from nowhere. After a run of them, stop and probe until the
  // network answers, rather than burning through the catalogue in a stretch of 185 works
  // that cannot be read.
  let consecutiveNetworkFailures = 0;
  function heardFromTheNetwork() { consecutiveNetworkFailures = 0; }
  async function waitOutAnOutage(failure) {
    if (!/fetch failed|terminated|ECONN|ENOTFOUND|ETIMEDOUT|socket|network/i.test(String(failure?.message ?? ""))) return;
    consecutiveNetworkFailures += 1;
    if (consecutiveNetworkFailures < OUTAGE_AFTER_FAILURES) return;
    console.log(`   ${consecutiveNetworkFailures} network failures in a row — waiting for the network`);
    for (let waited = 0; ; waited += OUTAGE_PROBE_MS) {
      await sleep(OUTAGE_PROBE_MS);
      try {
        const probe = await fetch("https://en.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json",
          { headers, signal: AbortSignal.timeout(15_000) });
        if (probe.ok) {
          console.log(`   network back after ${Math.round((waited + OUTAGE_PROBE_MS) / 1000)}s`);
          heardFromTheNetwork();
          return;
        }
      } catch { /* still down */ }
    }
  }

  for (const work of works) {
    // Checked at the top, so the work that met the refusal still writes what its earlier
    // editions produced; it stays unstamped and is read again tomorrow.
    if (quotaSpent) break;
    console.log(`\n${work.title}`);
    const entity = entities.entities?.[work.wikidata_id];
    const languages = languagesForWork(entity, { limit: LANGUAGES });
    if (languages.length === 0) {
      console.log("   no article in any edition we read — skipped");
      // A real verdict, not a failure: the article does not exist in any edition we read,
      // and asking again tomorrow will say the same. Before, this `continue` sat above the
      // stamp, so these works were selected again on every run and never left the queue.
      await stamp(work);
      continue;
    }
    console.log(`   editions: ${languages.join(", ")}`);

    // One accepted list per work, merged across editions. Reading more than one is not
    // redundancy: French carries "Lieux de tournage" and Japanese "ロケーション", sections
    // English does not have, so each edition names places the others summarise away.
    // Whichever edition mentioned a place first keeps its citation — the sentence and
    // the article it came from must stay together.
    const accepted = [];
    // Across editions as well as within one. The French article calls Toronto
    // "Toronto, au Canada" and the English one "Toronto, Ontario, Canada"; keyed on the
    // written string they are two places, and the reviewer meets the city twice.
    const kept = [];
    const credits = new Map();
    // Set when an edition could not be READ, as opposed to read and found wanting. A work
    // with any such edition is not stamped, so the next run asks again.
    let unreadEdition = false;

    for (const language of languages) {
      const title = articleTitleFromEntity(entity, language);

      let toc;
      try {
        toc = RAW
          ? await rawArticle(title, language).then((article) => ({ parse: { ...article } }))
          : await wikimedia(buildTocUrl(title, language));
      } catch (failure) {
        console.log(`   ${language}: ${failure.message}`);
        unreadEdition = true;
        await waitOutAnOutage(failure);
        continue;
      }

      const section = chooseSection(toc.parse?.tocdata, language, { kind: work.kind });
      if (!section) { console.log(`   ${language}: no production section`); continue; }

      const revid = toc.parse?.revid;
      // Guarded like the table of contents above it. It was not, and a network error here
      // would have thrown out of the loop and ended a two-day run on whatever work it hit.
      let raw;
      try {
        raw = RAW
          ? { parse: { wikitext: sectionFromWikitext(toc.parse.wikitext, section.index) } }
          : await wikimedia(buildSectionUrl(title, section.index, language));
      } catch (failure) {
        console.log(`   ${language}: section ${failure.message}`);
        unreadEdition = true;
        await waitOutAnOutage(failure);
        continue;
      }
      heardFromTheNetwork();
      const prose = cleanWikitext(raw.parse?.wikitext ?? "");
      console.log(`   ${language}: "${section.line}" → ${prose.length} chars (rev ${revid})`);

      if (DRY_RUN || !runtime) continue;

      await throttle();
      const extraction = await parseStructured({
        runtime,
        schema: wikipediaLocationsSchema,
        schemaName: "wikipedia_locations",
        instructions: extractionInstructions(),
        input: buildExtractionInput({ ...work, prose }),
        // 25 locations with a quoted sentence each runs past 4000 and the answer comes
        // back as JSON cut off mid-string. Budget for the cap the schema allows.
        // The endpoint truncated a 25-location answer at well under this, so the
        // budget is not the binding constraint — but leaving headroom costs nothing
        // and a truncated reply is a total loss.
        maxTokens: 20_000,
        timeout: 180_000, // a free endpoint took 27s on a short passage; give it room
      });

      // A weak model answering with prose, refusing, or running out of tokens is an
      // ordinary outcome of asking a free endpoint. Record it and take the next
      // edition — dying here would abandon every work still queued behind this one.
      if (!extraction.ok) {
        console.log(`   ${language}: extraction ${extraction.reason}`
          + (extraction.detail ? `: ${extraction.detail}` : ""));
        // A dropped connection or a rate limit says nothing about the article. A refusal
        // or a truncated answer does — asking the same model the same thing again is not
        // a retry, it is a repeat — so only the first kind leaves the work open.
        if (TRANSIENT_EXTRACTION.has(extraction.reason)) unreadEdition = true;
        // The day's allowance is gone: every further call gets this answer, and every work
        // read meanwhile is a Wikipedia fetch thrown away. This work stays unstamped, and
        // the attempt ends here — see dailyQuotaSpent.
        if (dailyQuotaSpent(extraction)) { quotaSpent = true; break; }
        continue;
      }

      if (extraction.usage) {
        spent.input += extraction.usage.input_tokens ?? 0;
        spent.output += extraction.usage.output_tokens ?? 0;
        spent.calls += 1;
      }
      const result = acceptExtraction(extraction.parsed, { prose, article: { title, revid } });
      let fresh = 0;
      for (const location of result.accepted) {
        if (kept.some((earlier) => samePlaceWritten(earlier, location.place_name))) continue;
        kept.push(location.place_name);
        accepted.push({ ...location, language });
        fresh += 1;
      }
      credits.set(language, wikipediaAttribution({ title, revid, language }));
      console.log(`   ${language}: ${result.accepted.length} accepted, ${fresh} new`
        + (result.rejected.length ? `, ${result.rejected.length} dropped` : ""));
    }

    // **Stamped only when every edition was actually read.**
    //
    // A work that yielded nothing is still recorded as read — the alternative retries every
    // barren work on every pass and never reaches the rest of the catalogue. But "yielded
    // nothing" and "could not be read" are different, and this used to treat them the same.
    //
    // Measured on the first long run, 16.09: of 802 works attempted, **575 had every
    // edition fail with `fetch failed`**, in unbroken stretches of 185, 123 and 95 — the
    // machine asleep, not a flaky API. Only 3 were stamped as done, and only by luck: the
    // same outage took the database down, so the stamp failed too. Had Wikimedia failed
    // alone, all 575 would have been recorded as read and never asked about again.
    if (!unreadEdition) await stamp(work);
    else console.log("   not stamped: an edition could not be read, so the next run asks again");


    if (accepted.length === 0) continue;

    // The area the prose put each place in, carried to the gazetteer. It cannot choose a
    // candidate — only refuse one that is in a different country, which is what Bognor
    // needed: the hint said England and the only candidate was Bognor, Ontario.
    const areas = new Map(accepted.map((location) => [location.place_name, location.area_hint]));
    // And the edition each name came from. A French article names Griffith Observatory
    // "observatoire Griffith", which is nothing in English and is itself in French.
    const placeLanguages = new Map(accepted.map((location) => [location.place_name, location.language]));
    const located = await geocode(accepted.map((location) => location.place_name), { areas, languages: placeLanguages });

    // **A row without its credit cannot be stored, and must not be dropped silently.**
    //
    // `source_url` and `source_license` are NOT NULL, and a location whose edition
    // produced no attribution has neither. Sending null is what broke this pipeline for
    // five weeks (see below); skipping the row without saying so would be the quieter
    // version of the same bug.
    const uncredited = accepted.filter((location) => !credits.get(location.language)?.permalink);
    if (uncredited.length) {
      console.log(`   ${uncredited.length} dropped: no attribution for their edition`);
    }
    const creditable = accepted.filter((location) => credits.get(location.language)?.permalink);
    if (creditable.length === 0) continue;

    const rows = creditable.map((location) => {
      const chosen = located.get(location.place_name);
      const credit = credits.get(location.language);
      return {
        work_id: work.id,
        place_name: location.place_name,
        area_hint: location.area_hint,
        source_sentence: location.source_sentence,
        // Filming, or somewhere the author made the work. Both belong on the map and a
        // reviewer must not have to re-read the sentence to tell which is which.
        relation_kind: location.relation_kind,
        source_title: location.article_title,
        source_revid: location.article_revid,
        // The credit points at the edition the sentence was copied from. A French
        // quote under an en.wikipedia permalink credits the wrong authors.
        source_url: credit.permalink,
        // **NOT NULL with no default, and this script never set it.** The
        // `provenance_is_required` migration of 04.08 dropped the default that had been
        // covering the omission, and every run since wrote nothing: each work failed with
        // `null value in column "source_license"`, the failure was logged per work, and
        // the run continued and looked successful. The last row this pipeline stored is
        // dated 03.08 — five weeks of a dead source that reported no error of its own.
        //
        // The licence belongs to the EDITION the sentence came from, which is why it is
        // taken off the same credit as the permalink rather than hardcoded here.
        source_license: credit.license,
        ...(chosen?.place
          ? {
            lat: chosen.place.lat,
            lng: chosen.place.lng,
            geocode_source: "wikidata",
            geocode_source_id: chosen.place.wikidata_id,
            geocode_license: WIKIDATA_LICENSE.name,
            geocode_reason: chosen.reason,
          }
          : { geocode_reason: chosen?.reason ?? "not_attempted" }),
      };
    });

    const { error: writeError } = await db
      .from("location_submissions")
      .upsert(rows, { onConflict: "work_id,place_key" });

    if (writeError) console.log(`   write failed: ${writeError.message}`);
    else {
      const placed = rows.filter((row) => row.lat !== undefined).length;
      console.log(`   queued ${rows.length} as pending (${placed} with coordinates)`);
    }
  }

  if (quotaSpent) {
    console.log("\nThe model's daily allowance is spent — stopping here, to start again once it resets.");
    process.exitCode = QUOTA_SPENT_EXIT;
  }
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
