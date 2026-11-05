#!/usr/bin/env node
//
// TMDB ratings for the works we already hold an IMDb id for (#224).
//
//   node scripts/ingest-tmdb-ratings.mjs            # everything missing a TMDB rating
//   node scripts/ingest-tmdb-ratings.mjs --limit 50 # a sample first
//   node scripts/ingest-tmdb-ratings.mjs --dry-run  # ask TMDB, write nothing
//
// Needs TMDB_API_READ_ACCESS_TOKEN (preferred) or TMDB_API_KEY.
//
// **Why TMDB and not Rotten Tomatoes.** #224 opens by saying Rotten Tomatoes is already
// ingested and the map simply cannot see it. Measured 20.09.2026, that is not the shape of
// the problem: RT covers 10 works of 7,063 and Metacritic 10, while IMDb covers 5,495. The
// map can see the only source that has coverage.
//
// What IMDb does not have is a licence. Its published dataset is non-commercial use only,
// and every "Known for" list, rating filter and sort rests on it. TMDB's terms allow
// commercial use with attribution, and TMDB is already integrated here for posters — so
// the replacement is not a better number, it is a number we are allowed to keep using.
//
// The obstacle was never the API. It was the key: a TMDB id is recorded on 12 works, an
// IMDb id on 6,044. `/find/{imdb_id}?external_source=imdb_id` turns one into the other, so
// this script buys coverage rather than a new dependency.

import { createClient } from "@supabase/supabase-js";

import { ratingFromTmdb, tmdbFindResult, tmdbFindUrl } from "../app/lib/work-ratings.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const DRY_RUN = flag("--dry-run");
const LIMIT = Number(value("--limit", "0")) || null;
// TMDB asks for no more than about 50 requests a second and answers in ~100 ms. Eight in
// flight is a tenth of that ceiling — this is a backfill nobody is waiting on, and being
// rate-limited halfway through is more expensive than being slow.
const CONCURRENCY = Number(value("--concurrency", "8"));
const PAGE = 1000;

function env(name) {
  const found = process.env[name];
  if (found) return found;
  throw new Error(`${name} is not set — run with it in the environment (see .env.local)`);
}

// The v4 read token goes in a header; the v3 key in the query string. Either will do, and
// the cloud environment holds only the token.
const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
const apiKey = token ? null : env("TMDB_API_KEY");
const tmdbHeaders = token ? { Authorization: `Bearer ${token}`, Accept: "application/json" } : {};
const client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

// Works with an IMDb id and no TMDB rating yet. Read in pages, because 6,044 rows is more
// than one PostgREST response carries and a partial backfill that silently stops at 1,000
// is the failure this project has shipped once already.
async function worksToAsk() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("works")
      .select("id, title, kind, imdb_id, tmdb_id, work_ratings!left(source)")
      .not("imdb_id", "is", null)
      .neq("kind", "book")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`works read failed: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const rated = (row.work_ratings ?? []).some((rating) => rating.source === "tmdb");
      if (!rated) rows.push(row);
    }
    if (data.length < PAGE) break;
    if (LIMIT && rows.length >= LIMIT) break;
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

// One work: ask TMDB, and return what to write. A 404 is an answer — TMDB does not hold
// every title — and is counted rather than retried.
async function askTmdb(work) {
  const url = tmdbFindUrl(work.imdb_id, { apiKey });
  if (!url) return { work, outcome: "bad_imdb_id" };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { headers: tmdbHeaders, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (attempt === 2) return { work, outcome: "network", detail: error?.message };
      continue;
    }
    // Their own header says how long to wait; guessing would either hammer them or idle.
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after")) || 2;
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (response.status === 404) return { work, outcome: "not_in_tmdb" };
    if (!response.ok) {
      if (attempt === 2) return { work, outcome: "http", detail: String(response.status) };
      continue;
    }

    const found = tmdbFindResult(await response.json(), work.kind);
    if (!found) return { work, outcome: "not_in_tmdb" };

    const rating = ratingFromTmdb(
      { vote_average: found.voteAverage, vote_count: found.voteCount },
      found.tmdbId,
    );
    // A record with no votes is not a rating. The id is still worth keeping: it is what
    // fetches the poster.
    return { work, outcome: rating ? "rated" : "unrated", tmdbId: found.tmdbId, rating };
  }
  return { work, outcome: "rate_limited" };
}

async function inBatches(items, size, worker) {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(worker)));
    if (index && index % 500 === 0) {
      process.stdout.write(`  …${index} of ${items.length}\n`);
    }
  }
  return results;
}

async function writeRatings(rows) {
  if (!rows.length) return;
  const { error } = await client
    .from("work_ratings")
    .upsert(rows, { onConflict: "work_id, source" });
  if (error) throw new Error(`ratings upsert failed: ${error.message}`);
}

// `works.tmdb_id` is unique, and two of our rows can resolve to one TMDB record — which is
// not a TMDB problem, it is two works in our table that are the same film. Measured on the
// first full run: the backfill died at row ~6,000 on `works_tmdb_uidx` after writing every
// rating, because one id was already taken.
//
// So a taken id is COUNTED, not forced. Overwriting the other row's id would make our
// duplicate invisible; failing the run would throw away 5,000 good ratings for 20 bad rows.
async function writeTmdbIds(pairs) {
  let written = 0;
  const collisions = [];

  for (const [id, tmdbId] of pairs) {
    const { data: taken, error: readError } = await client
      .from("works").select("id").eq("tmdb_id", tmdbId).neq("id", id).maybeSingle();
    if (readError) throw new Error(`tmdb_id check failed: ${readError.message}`);
    if (taken) { collisions.push([id, tmdbId, taken.id]); continue; }

    const { error } = await client.from("works").update({ tmdb_id: tmdbId }).eq("id", id);
    // A race with another writer is the same answer as a collision, not a reason to stop.
    if (error?.code === "23505") { collisions.push([id, tmdbId, null]); continue; }
    if (error) throw new Error(`tmdb_id update failed: ${error.message}`);
    written += 1;
  }

  return { written, collisions };
}

const works = await worksToAsk();
console.log(`${works.length} works with an IMDb id and no TMDB rating${DRY_RUN ? " (dry run)" : ""}`);

const answers = await inBatches(works, CONCURRENCY, askTmdb);

const counts = {};
for (const answer of answers) counts[answer.outcome] = (counts[answer.outcome] ?? 0) + 1;

const ratings = answers
  .filter((answer) => answer.outcome === "rated")
  .map((answer) => ({
    work_id: answer.work.id,
    ...answer.rating,
    retrieved_at: new Date().toISOString(),
  }));

// Only where it is missing: an id we already recorded is not this script's to overwrite.
const ids = answers
  .filter((answer) => answer.tmdbId && !answer.work.tmdb_id)
  .map((answer) => [answer.work.id, answer.tmdbId]);

let written = { written: 0, collisions: [] };
if (!DRY_RUN) {
  for (let index = 0; index < ratings.length; index += 500) {
    await writeRatings(ratings.slice(index, index + 500));
  }
  written = await writeTmdbIds(ids);
}

console.log(`\noutcomes: ${JSON.stringify(counts)}`);
console.log(`${DRY_RUN ? "would write" : "wrote"} ${ratings.length} ratings`
  + ` and ${DRY_RUN ? ids.length : written.written} tmdb ids`);
if (written.collisions.length) {
  // Worth reading: each one is two rows in `works` that are the same film.
  console.log(`${written.collisions.length} ids were already held by another work:`);
  for (const [id, tmdbId, other] of written.collisions.slice(0, 10)) {
    console.log(`  ${id} → tmdb ${tmdbId}, already on ${other ?? "another row"}`);
  }
}
