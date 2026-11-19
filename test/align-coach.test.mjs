import assert from "node:assert/strict";
import test from "node:test";

import { createCoachHandlers } from "../app/api/coach/route.js";
import {
  coachSentence,
  coachShot,
  createCoachLimiter,
  dailyLimitFrom,
  DEFAULT_COACH_DAILY_LIMIT,
  movesFromMeasure,
  parseCoach,
  parseImageDataUrl,
} from "../app/lib/align-coach.mjs";

const JPEG = `data:image/jpeg;base64,${Buffer.from("not really a jpeg").toString("base64")}`;

test("a scene sitting left means turn left; lower means tilt down; bigger means step back", () => {
  assert.deepEqual(movesFromMeasure({ dx: -0.2, dy: 0, scale: 1 }), [{ move: "pan", direction: "left", amount: "a bit" }]);
  assert.deepEqual(movesFromMeasure({ dx: 0, dy: 0.1, scale: 1 }), [{ move: "tilt", direction: "down", amount: "slightly" }]);
  assert.deepEqual(movesFromMeasure({ dy: -0.4 }), [{ move: "tilt", direction: "up", amount: "a lot" }]);
  assert.deepEqual(movesFromMeasure({ scale: 1.5 }), [{ move: "step", direction: "back", amount: "a bit" }]);
  assert.deepEqual(movesFromMeasure({ scale: 0.4 }), [{ move: "step", direction: "forward", amount: "a lot" }]);
});

test("small differences are not worth a move, and the biggest move comes first", () => {
  assert.deepEqual(movesFromMeasure({ dx: 0.03, dy: -0.02, scale: 1.05 }), []);
  assert.deepEqual(
    movesFromMeasure({ dx: -0.07, scale: 2 }).map((item) => item.move),
    ["step", "pan"],
  );
});

test("the model's JSON is clamped, and a different place gives no moves", () => {
  const coach = parseCoach('Sure! {"same_place": true, "match": 140, "dx": -5, "dy": "x", "scale": 1.3}');
  assert.equal(coach.match, 100);
  assert.deepEqual(coach.measure, { dx: -1, dy: 0, scale: 1.3 });
  assert.deepEqual(coach.moves.map((item) => item.move), ["pan", "step"]);

  const other = parseCoach('{"same_place": false, "match": 3, "dx": 0.4}');
  assert.equal(other.samePlace, false);
  assert.deepEqual(other.moves, []);

  assert.equal(parseCoach("no json here"), null);
});

test("the sentence joins the moves, or says the shot is there", () => {
  assert.equal(
    coachSentence({ samePlace: true, moves: [
      { move: "pan", direction: "left", amount: "a bit" },
      { move: "step", direction: "back", amount: "slightly" },
    ] }),
    "Turn left a bit and step back slightly.",
  );
  assert.match(coachSentence({ samePlace: true, moves: [] }), /got the shot/);
  assert.match(coachSentence({ samePlace: false, moves: [] }), /same place/);
  assert.equal(coachSentence(null), null);
});

test("only small inline images are accepted", () => {
  assert.deepEqual(parseImageDataUrl(JPEG)?.mediaType, "image/jpeg");
  assert.equal(parseImageDataUrl("https://example.com/a.jpg"), null);
  assert.equal(parseImageDataUrl("data:image/gif;base64,AAAA"), null);
  assert.equal(parseImageDataUrl(`data:image/jpeg;base64,${"A".repeat(600_000)}`), null);
});

test("the limiter caps an account and the whole day, and resets the next day", () => {
  const limiter = createCoachLimiter({ perUser: 2, perDay: 3 });
  const day = new Date("2026-11-19T10:00:00Z");
  assert.equal(limiter.take("a", day).ok, true);
  assert.equal(limiter.take("a", day).left, 0);
  assert.deepEqual(limiter.take("a", day), { ok: false, reason: "user" });
  assert.equal(limiter.take("b", day).ok, true);
  assert.deepEqual(limiter.take("c", day), { ok: false, reason: "day" });
  assert.equal(limiter.take("a", new Date("2026-11-20T00:01:00Z")).ok, true);
  assert.equal(dailyLimitFrom("10"), 10);
  assert.equal(dailyLimitFrom("nope"), DEFAULT_COACH_DAILY_LIMIT);
});

test("coachShot sends both images, then the prompt, at low effort", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"same_place":true,"match":80,"dx":-0.2,"dy":0,"scale":1}' }] }));
  };
  const image = parseImageDataUrl(JPEG);
  const { coach } = await coachShot({ reference: image, camera: image, apiKey: "k", fetchImpl });
  assert.deepEqual(sent.messages[0].content.map((part) => part.type), ["image", "image", "text"]);
  assert.equal(sent.output_config.effort, "low");
  assert.equal(coach.moves[0].direction, "left");
  await assert.rejects(coachShot({ reference: image, camera: image, apiKey: "" }));
});

const request = (body, token = "good") => new Request("http://x/api/coach", {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

function handlers(overrides = {}) {
  const calls = [];
  const { POST } = createCoachHandlers({
    env: { ANTHROPIC_API_KEY: "k" },
    getUser: async (token) => (token === "good" ? { id: "u1" } : null),
    coach: async (input) => {
      calls.push(input);
      return { coach: parseCoach('{"same_place":true,"match":70,"dx":0.2,"dy":0,"scale":0.7}') };
    },
    limiter: createCoachLimiter({ perUser: 1, perDay: 10 }),
    logError: () => {},
    ...overrides,
  });
  return { POST, calls };
}

test("the route answers a signed-in person with moves and a sentence", async () => {
  const { POST, calls } = handlers();
  const response = await POST(request({ reference: JPEG, camera: JPEG }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sentence, "Turn right a bit and step forward a bit.");
  assert.equal(body.left, 0);
  assert.equal(calls.length, 1);
});

test("the route refuses strangers, bad bodies and the second call over the cap", async () => {
  const { POST, calls } = handlers();
  assert.equal((await POST(request({ reference: JPEG, camera: JPEG }, null))).status, 401);
  assert.equal((await POST(request({ reference: JPEG, camera: JPEG }, "bad"))).status, 401);
  assert.equal((await POST(request({ reference: JPEG }))).status, 400);
  assert.equal((await POST(request({ reference: JPEG, camera: JPEG }))).status, 200);
  assert.equal((await POST(request({ reference: JPEG, camera: JPEG }))).status, 429);
  assert.equal(calls.length, 1);
});

test("without a key the coach is off, and a failed call is a 502", async () => {
  assert.equal((await handlers({ env: {} }).POST(request({ reference: JPEG, camera: JPEG }))).status, 503);
  const broken = handlers({ coach: async () => { throw new Error("boom"); } });
  assert.equal((await broken.POST(request({ reference: JPEG, camera: JPEG }))).status, 502);
});
