import assert from "node:assert/strict";
import test from "node:test";

import { createStillsEnrichHandler, DEFAULT_WORK_LIMIT, MAX_WORK_LIMIT } from "../app/api/enrich/stills/route.js";
import {
  acceptedStillIndexes,
  buildClassificationContent,
  buildClaudeClassificationContent,
  inlineImage,
  classificationInstructions,
  imageBatches,
  MAX_IMAGES_PER_CALL,
  MAX_IMAGES_PER_WORK,
  stillClassificationSchema,
  verdictRows,
} from "../app/lib/still-classify.mjs";

const frame = (index) => ({ index, isPhotographicFrame: true, hasTitleOrLogo: false, isPromotional: false });

// --- the gate ------------------------------------------------------------------

test("only a photographic, untitled, non-promotional image is a frame", () => {
  const kept = acceptedStillIndexes({ verdicts: [
    frame(0),
    { index: 1, isPhotographicFrame: false, hasTitleOrLogo: false, isPromotional: false }, // artwork
    { index: 2, isPhotographicFrame: true, hasTitleOrLogo: true, isPromotional: false },  // title card
    { index: 3, isPhotographicFrame: true, hasTitleOrLogo: false, isPromotional: true },  // press shot
  ] }, 4);
  assert.deepEqual([...kept], [0]);
});

test("a posed cast portrait is a photograph but not a frame from the film", () => {
  // The gun-barrel art failed the metadata filter precisely because it is textless;
  // a press shot fails for the mirror reason — it is photographic but not a scene.
  const kept = acceptedStillIndexes({ verdicts: [
    { index: 0, isPhotographicFrame: true, hasTitleOrLogo: false, isPromotional: true },
  ] }, 1);
  assert.equal(kept.size, 0);
});

test("an index the model invented is ignored", () => {
  const kept = acceptedStillIndexes({ verdicts: [frame(0), frame(99), frame(-1)] }, 1);
  assert.deepEqual([...kept], [0]);
});

test("a malformed or missing verdict drops its image rather than passing it", () => {
  // "We could not tell" and "it is a frame" must not produce the same gallery.
  assert.equal(acceptedStillIndexes({ verdicts: [{ index: 0 }] }, 1).size, 0);
  assert.equal(acceptedStillIndexes({ verdicts: [{ index: "0", isPhotographicFrame: true }] }, 1).size, 0);
  assert.equal(acceptedStillIndexes(null, 3).size, 0);
  assert.equal(acceptedStillIndexes({}, 3).size, 0);
});

// --- what gets stored ----------------------------------------------------------

const candidates = [
  { file_path: "/a.jpg", width: 1920, height: 1080 },
  { file_path: "/b.jpg", width: 1920, height: 1080 },
  { file_path: "/c.jpg" },
];

test("rejections are stored too, or the same poster is re-judged forever", () => {
  const rows = verdictRows("w1", candidates, { verdicts: [
    frame(0),
    { index: 1, isPhotographicFrame: false, hasTitleOrLogo: true, isPromotional: true },
    frame(2),
  ] });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.is_frame), [true, false, true]);
  assert.equal(rows[0].work_id, "w1");
  assert.equal(rows[0].file_path, "/a.jpg");
});

test("an image the model never mentioned is left unjudged, not rejected", () => {
  // One truncated response would otherwise permanently hide a real frame.
  const rows = verdictRows("w1", candidates, { verdicts: [frame(0)] });
  assert.deepEqual(rows.map((row) => row.file_path), ["/a.jpg"]);
});

test("missing dimensions become null rather than undefined", () => {
  const [, , third] = verdictRows("w1", candidates, {
    verdicts: [frame(0), frame(1), frame(2)],
  });
  assert.equal(third.width, null);
  assert.equal(third.height, null);
});

// --- the prompt ----------------------------------------------------------------

test("the instructions name the exact things that fooled the metadata filter", () => {
  const instructions = classificationInstructions();
  assert.match(instructions, /silhouette/i);   // the gun-barrel art
  assert.match(instructions, /title card/i);
  assert.match(instructions, /posed cast portraits/i);
});

test("text inside an image is treated as picture, not as instruction", () => {
  // A poster is mostly words, and a frame can contain a sign. Neither is a prompt.
  assert.match(classificationInstructions(), /never instructions/i);
});

test("each image is numbered so a verdict can be checked against what we sent", () => {
  const content = buildClassificationContent(["https://a", "https://b"]);
  const text = content.filter((part) => part.type === "input_text").map((part) => part.text).join(" ");
  assert.match(text, /Image 0:/);
  assert.match(text, /Image 1:/);
  assert.equal(content.filter((part) => part.type === "input_image").length, 2);
});

test("a batch is bounded", () => {
  const many = Array.from({ length: MAX_IMAGES_PER_CALL + 8 }, (_, i) => `https://${i}`);
  const images = buildClassificationContent(many).filter((part) => part.type === "input_image");
  assert.equal(images.length, MAX_IMAGES_PER_CALL);
  assert.deepEqual(buildClassificationContent(null), [
    { type: "input_text", text: "There are 0 images, numbered from 0." },
  ]);
});

test("the schema accepts a well-formed classification", () => {
  assert.equal(stillClassificationSchema.safeParse({ verdicts: [frame(0)] }).success, true);
  assert.equal(stillClassificationSchema.safeParse({ verdicts: [{ index: 0 }] }).success, false);
});

// --- the route -----------------------------------------------------------------

const WORK = { id: "w1", title: "Skyfall", kind: "film", tmdb_id: "37724" };

function handlerWith(overrides = {}) {
  const calls = { saved: [], vision: 0 };
  const handler = createStillsEnrichHandler({
    env: { ENRICH_TOKEN: "test-token", OPENAI_API_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "s",
      TMDB_API_READ_ACCESS_TOKEN: "t", ...overrides.env },
    createStore: overrides.createStore ?? (() => ({
      pendingWorks: async (limit) => { calls.limit = limit; return overrides.works ?? [WORK]; },
      loadWork: async () => ("work" in overrides ? overrides.work : WORK),
      saveVerdicts: async (rows) => {
        if (overrides.saveThrows) throw new Error("db down");
        calls.saved.push(...rows);
        return rows.length;
      },
    })),
    createOpenAIClient: () => ({
      responses: {
        parse: async () => {
          calls.vision += 1;
          return overrides.response ?? {
            status: "completed",
            output_parsed: { verdicts: [
              frame(0),
              { index: 1, isPhotographicFrame: false, hasTitleOrLogo: true, isPromotional: true },
            ] },
          };
        },
      },
    }),
    fetchImpl: overrides.fetchImpl ?? (async () => ({
      ok: true,
      json: async () => ({ backdrops: overrides.backdrops ?? [
        { file_path: "/frame.jpg", vote_count: 9 },
        { file_path: "/poster.jpg", vote_count: 40 },
      ] }),
    })),
    logError: () => {},
  });
  return { handler, calls };
}

const request = (body) => new Request("http://localhost/api/enrich/stills", {
  method: "POST", headers: { "Content-Type": "application/json", "x-enrich-token": "test-token" }, body: JSON.stringify(body),
});

test("a gallery is judged once and both verdicts are kept", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(request({}))).json();

  assert.equal(body.works[0].frames, 1);
  assert.equal(body.works[0].rejected, 1);
  assert.equal(calls.saved.length, 2);
  assert.equal(calls.vision, 1);
});

test("a refused or truncated response writes NOTHING", async () => {
  // Storing its silence would mark every real frame as rejected, permanently.
  const { handler, calls } = handlerWith({ response: { status: "incomplete", output_parsed: null } });
  const body = await (await handler(request({}))).json();

  assert.equal(calls.saved.length, 0);
  assert.equal(body.works[0].reason, "vision_failed");
});

test("a film with no images costs no model call", async () => {
  const { handler, calls } = handlerWith({
    fetchImpl: async () => ({ ok: true, json: async () => ({ backdrops: [] }) }),
  });
  const body = await (await handler(request({}))).json();
  assert.equal(calls.vision, 0);
  assert.equal(body.works[0].reason, "no_images");
});

test("one failing film does not abandon the batch", async () => {
  const works = [WORK, { ...WORK, id: "w2", title: "Notting Hill" }];
  let first = true;
  const { handler } = handlerWith({
    works,
    fetchImpl: async () => {
      if (first) { first = false; throw new Error("tmdb down"); }
      return { ok: true, json: async () => ({ backdrops: [{ file_path: "/f.jpg", vote_count: 1 }] }) };
    },
  });
  const body = await (await handler(request({}))).json();
  assert.equal(body.works.length, 2);
  assert.equal(body.works[0].reason, "no_images");
  assert.equal(body.works[1].frames, 1);
});

test("a save failure is reported, not silently counted as done", async () => {
  const { handler } = handlerWith({ saveThrows: true });
  const body = await (await handler(request({}))).json();
  assert.equal(body.works[0].reason, "save_failed");
});

test("the batch is bounded so one call cannot spend without limit", async () => {
  const { handler, calls } = handlerWith();
  await handler(request({ limit: 9999 }));
  assert.equal(calls.limit, MAX_WORK_LIMIT);
  await handler(request({}));
  assert.equal(calls.limit, DEFAULT_WORK_LIMIT);
});

test("without vision configured the route says so instead of half-working", async () => {
  const { handler } = handlerWith({ env: { OPENAI_API_KEY: undefined } });
  assert.equal((await handler(request({}))).status, 503);
});

test("nothing left to classify is a clean answer", async () => {
  const { handler, calls } = handlerWith({ works: [] });
  const body = await (await handler(request({}))).json();
  assert.deepEqual(body, { classified: 0, works: [] });
  assert.equal(calls.vision, 0);
});

test("the response reports how many images existed, not just how many were judged", async () => {
  // The cap is the interesting number: a film with 60 backdrops judged 12 deep may
  // never be offered the wide location shot that a match needs.
  const many = Array.from({ length: 40 }, (_, i) => ({ file_path: `/i${i}.jpg`, vote_count: i }));
  const { handler } = handlerWith({ backdrops: many });
  const body = await (await handler(request({}))).json();
  assert.equal(body.works[0].available, 40);
  assert.ok(body.works[0].judged <= MAX_IMAGES_PER_WORK);
});

test("a gallery is judged in batches, going deeper than one call allows", () => {
  // Twelve was far too shallow. Skyfall has 98 images and the top twelve by votes are
  // posters and cast hero shots; the wide establishing shots that show a LOCATION sit
  // further down, so scene matching was never offered anything to match.
  const many = Array.from({ length: 98 }, (_, i) => ({ file_path: `/i${i}.jpg` }));
  const batches = imageBatches(many);
  assert.equal(batches.length, MAX_IMAGES_PER_WORK / MAX_IMAGES_PER_CALL);
  assert.equal(batches.flat().length, MAX_IMAGES_PER_WORK);
  assert.ok(batches.every((batch) => batch.length <= MAX_IMAGES_PER_CALL));
});

test("indices stay local to their batch, so a verdict maps to the right image", () => {
  // verdictRows is given ONE batch and the model numbered from 0 within it; handing it
  // the whole gallery would attribute batch 2's verdicts to batch 1's images.
  const many = Array.from({ length: 20 }, (_, i) => ({ file_path: `/i${i}.jpg` }));
  const [, second] = imageBatches(many);
  assert.equal(second[0].file_path, "/i12.jpg");
});

test("a short gallery still produces one batch", () => {
  assert.equal(imageBatches([{ file_path: "/a.jpg" }]).length, 1);
  assert.deepEqual(imageBatches([]), []);
  assert.deepEqual(imageBatches(null), []);
});

test("one failed batch loses its own images, not the whole gallery", async () => {
  const many = Array.from({ length: 24 }, (_, i) => ({ file_path: `/i${i}.jpg`, vote_count: 24 - i }));
  let call = 0;
  const { handler, calls } = handlerWith({
    backdrops: many,
    createOpenAIClient: undefined,
  });
  // Rebuild with a client that fails the first batch only.
  const handler2 = createStillsEnrichHandler({
    env: { ENRICH_TOKEN: "test-token", OPENAI_API_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "s", TMDB_API_KEY: "t" },
    createStore: () => ({
      pendingWorks: async () => [WORK],
      loadWork: async () => WORK,
      saveVerdicts: async (rows) => { calls.saved.push(...rows); return rows.length; },
    }),
    createOpenAIClient: () => ({
      responses: {
        parse: async () => {
          call += 1;
          if (call === 1) throw new Error("batch down");
          return { status: "completed", output_parsed: { verdicts: [frame(0)] } };
        },
      },
    }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ backdrops: many }) }),
    logError: () => {},
  });
  const body = await (await handler2(request({}))).json();
  assert.ok(body.works[0].judged >= 1, "the surviving batch still contributes");
});

test("Claude gets the same numbered gallery as URL image blocks", () => {
  const content = buildClaudeClassificationContent(["https://a", "https://b"]);
  assert.equal(content[0].text, "There are 2 images, numbered from 0.");
  assert.deepEqual(content.filter((part) => part.type === "image").map((part) => part.source),
    [{ type: "url", url: "https://a" }, { type: "url", url: "https://b" }]);
  assert.equal(content[3].text, "Image 1:");
});

test("Claude takes downloaded images as inline base64 blocks", async () => {
  const image = await inlineImage("https://img/x.jpg", async () => ({
    ok: true,
    headers: { get: () => "image/jpeg" },
    arrayBuffer: async () => new TextEncoder().encode("abc").buffer,
  }));
  assert.deepEqual(image, { media_type: "image/jpeg", data: "YWJj" });
  const content = buildClaudeClassificationContent([image]);
  assert.deepEqual(content[2].source, { type: "base64", media_type: "image/jpeg", data: "YWJj" });
});
