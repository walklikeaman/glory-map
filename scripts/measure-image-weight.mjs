#!/usr/bin/env node
// What the images actually weigh, asked of the servers that serve them (#198).
//
//   node scripts/measure-image-weight.mjs
//   node scripts/measure-image-weight.mjs --origin http://localhost:3000
//
// `test/image-budget.test.mjs` holds the code to a budget using numbers written down in
// `app/lib/image-budget.mjs`. This is where those numbers come from, and the reason it is
// a script rather than a test: it goes out to image.tmdb.org, commons.wikimedia.org and
// the live app, which is the wrong thing to do on every commit and the right thing to do
// before changing a budget.
//
// It reports four things:
//
//   1. the size ladder — mean bytes per rung, over real files, per shape;
//   2. the live map — what a viewport's worth of places actually carries;
//   3. the drift — each budgeted surface measured against what it is allowed;
//   4. the JavaScript — the shared first-load bundle, if this checkout has been built.
//
// A rung that moves by a few percent is the CDN recompressing; a rung that moves by a
// factor is a policy change upstream and the table in image-budget.mjs is now a lie.

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import process from "node:process";

import {
  SURFACES, TMDB_BYTES, commonsBucket, commonsFileUrl, measuredBytes, surfaceCost,
} from "../app/lib/image-budget.mjs";

const args = process.argv.slice(2);
const ORIGIN = args.includes("--origin")
  ? args[args.indexOf("--origin") + 1]
  : "https://codex-hackathon-starter.vercel.app";

// Contactable, because that is what Wikimedia asks of anything fetching originals — and
// this script is the only thing here that still does.
const UA = "GloryMap/1.0 (image weight measurement; https://github.com/walklikeaman/glory-map)";

// Real files, not synthetic ones: a 2:3 poster and a 16:9 frame compress differently and
// the difference is the whole point of keeping two tables.
const POSTERS = [
  "/7QPeVsr9rcFU9Gl90yg0gTOTpVv.jpg", "/wuMc08IPKEatf9rnMNXvIDxqP4W.jpg",
  "/8lI9dmz1RH20FAqltkGelY1v4BE.jpg", "/63N9uy8nd9j7Eog2axPQ8lbr3Wj.jpg",
  "/1avD1JeaRiJX5M4ahPdZPypGoGN.jpg", "/d0IVecFQvsGdSbnMAHqiYsNYaJT.jpg",
  "/3jCLmYDIIiSMPujbwygNpqdpM8N.jpg", "/hHRIf2XHeQMbyRb3HUx19SF5Ujw.jpg",
  "/1M876KPjulVwppEpldhdc8V4o68.jpg", "/sQckQRt17VaWbo39GIu0TMOiszq.jpg",
];
const FRAMES = [
  "/l4VlSCmsGHuGyQf7juLZbG5kb5v.jpg", "/mqcqAE8yefvezVJ78FINJCiV6n3.jpg",
  "/gZmEjHoqXUcC7D8ix0aFQwvknYQ.jpg", "/qdBCI2bZSM4efxVPNDm9ztde8NE.jpg",
  "/vBaWJhjT8uLoBGGdAwIwq7FtF8M.jpg", "/egyi9TQjLhNEQuEsK1dXovdHOHL.jpg",
  "/6NpaRVGd4I9Z2hdARNVqc8Z1ldx.jpg", "/f4VUSI3drkdM7LEktreTM23RKc.jpg",
  "/m6vwJF7rAhSgdvsPH5vGjrkxuHE.jpg", "/erq91NG71GT1SWG2uzuxrEBgP5K.jpg",
];
// A central-London viewport: the busiest ground the product holds, so the worst case.
const VIEWPORT = "south=51.49&west=-0.16&north=51.53&east=-0.09&kind=film&limit=60";

const kB = (bytes) => `${Math.round(bytes / 1024)} kB`;

// HEAD, because the size is the answer and the pixels are not. A source that refuses HEAD
// reports null rather than being guessed at — a mean over "the ones that answered" is
// still a mean, and saying how many answered is what keeps it honest.
async function byteSize(url) {
  try {
    const response = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length"));
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}

async function meanSize(urls) {
  const sizes = [];
  for (const url of urls) {
    const size = await byteSize(url);
    if (size) sizes.push(size);
  }
  if (sizes.length === 0) return null;
  sizes.sort((left, right) => left - right);
  return {
    n: sizes.length,
    of: urls.length,
    mean: Math.round(sizes.reduce((total, size) => total + size, 0) / sizes.length),
    max: sizes[sizes.length - 1],
  };
}

// The rungs are read off the written-down table, so a rung added there is measured here
// without editing this file.
async function ladder() {
  console.log("\n— the size ladder, mean bytes per rung —\n");
  for (const [shape, paths] of [["poster", POSTERS], ["frame", FRAMES]]) {
    for (const width of Object.keys(TMDB_BYTES[shape])) {
      const measured = await meanSize(paths.map((path) => `https://image.tmdb.org/t/p/w${width}${path}`));
      if (!measured) { console.log(`  ${shape} w${width}: nothing answered`); continue; }
      const written = measuredBytes(shape, Number(width));
      const drift = written ? Math.round((measured.mean / written - 1) * 100) : null;
      console.log(
        `  ${shape.padEnd(6)} w${String(width).padEnd(5)} ${kB(measured.mean).padStart(8)}`
        + `  (written down: ${written ? kB(written) : "—"}${drift === null ? "" : `, ${drift >= 0 ? "+" : ""}${drift}%`})`,
      );
    }
  }
}

async function liveMap() {
  console.log(`\n— what a London viewport carries, from ${ORIGIN} —\n`);
  let rows;
  try {
    const response = await fetch(`${ORIGIN}/api/locations?${VIEWPORT}`);
    rows = (await response.json())?.locations ?? [];
  } catch (error) {
    console.log(`  could not reach ${ORIGIN}: ${error.message}`);
    return;
  }
  const photos = rows.map((row) => row.commons_image).filter(Boolean);
  const unbounded = photos.filter((url) => !/[?&]width=\d+/.test(url));
  console.log(`  ${rows.length} places, ${photos.length} with a photo`);
  console.log(unbounded.length
    ? `  ${unbounded.length} carry NO width — each one is the full original upload`
      + "  ← this is the #198 regression, and it is back"
    : "  every one of them carries a width");

  const measured = await meanSize(photos.slice(0, 10).map((url) => url.replace(/^http:\/\//, "https://")));
  if (measured) {
    console.log(`  as served: ${kB(measured.mean)} mean, ${kB(measured.max)} worst, over ${measured.n} of ${measured.of}`);
  }
  // Both rungs the surface offers: the stored one, which is what a desktop loads, and
  // the larger one a phone picks out of the srcset.
  const names = photos.slice(0, 10)
    .map((url) => url.match(/\/Special:FilePath\/([^?#]+)/)?.[1])
    .filter(Boolean)
    .map((name) => decodeURIComponent(name));
  for (const [label, box] of [["stored (desktop)", SURFACES.placePhoto.box], ["phone", SURFACES.placePhoto.phoneBox]]) {
    const bucket = commonsBucket(box * 2);
    const at = await meanSize(names.map((name) => commonsFileUrl(name, { width: bucket })));
    if (at) console.log(`  at the ${label} bucket (width=${bucket}): ${kB(at.mean)} mean, over ${at.n} of ${at.of}`);
  }
}

function budgets() {
  console.log("\n— every surface against its budget —\n");
  for (const key of Object.keys(SURFACES)) {
    const cost = surfaceCost(key);
    const verdict = cost.over > 0 ? `OVER by ${kB(cost.over)}` : `${kB(-cost.over)} to spare`;
    console.log(
      `  ${key.padEnd(18)} ${String(SURFACES[key].box).padStart(4)} css px`
      + `  → w${String(cost.width).padEnd(5)} ${kB(cost.bytes).padStart(8)}`
      + `  of ${kB(cost.budgetBytes).padStart(8)}   ${verdict}`,
    );
  }
}

// The other half of "lightweight" (#198). Read off `.next` rather than asserted in a
// test, because a test in a fresh checkout has no build to look at — and a budget that
// passes because the thing it measures is absent is worse than no budget.
//
// Gzipped, because that is what crosses the network and what `next build` prints. 103 kB
// is what this shipped at when the budget was written; maplibre-gl is another ~800 kB,
// loaded lazily for the map alone, which is why it is not in this number.
const JS_FIRST_LOAD_BUDGET = 130_000;

function javascript() {
  console.log("\n— the shared first-load bundle —\n");
  const manifestPath = path.join(process.cwd(), ".next", "build-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.log("  no .next here — run `npm run build` first");
    return;
  }
  // `npm run dev` writes a .next too, and its chunks are unminified with the whole HMR
  // client in them — measuring those would report a number four times the truth and
  // blame it on the product. A production build writes BUILD_ID; a dev one does not.
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    console.log("  this .next is a dev build — run `npm run build` to measure what ships");
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const shared = new Set(manifest.rootMainFiles ?? []);
  let total = 0;
  for (const file of shared) {
    const onDisk = path.join(process.cwd(), ".next", file);
    if (fs.existsSync(onDisk)) total += zlib.gzipSync(fs.readFileSync(onDisk)).length;
  }
  const verdict = total > JS_FIRST_LOAD_BUDGET ? `OVER by ${kB(total - JS_FIRST_LOAD_BUDGET)}` : `${kB(JS_FIRST_LOAD_BUDGET - total)} to spare`;
  console.log(`  ${shared.size} files, ${kB(total)} of ${kB(JS_FIRST_LOAD_BUDGET)}   ${verdict}`);
}

await ladder();
await liveMap();
budgets();
javascript();
console.log("");
