import assert from "node:assert/strict";
import test from "node:test";

import {
  loadSuggestions, saveSuggestions, sendSuggestion, statusAfterSend, SUGGESTION_STATUS, SUGGESTIONS_KEY,
  SUGGESTIONS_TABLE, suggestionRow, suggestionStatusLabel, unsentSuggestions, validateSuggestion,
} from "../app/lib/suggestions.mjs";

const good = { place: " Leadenhall Market ", work: "Harry Potter", scene: "Diagon Alley", lat: 51.51278, lng: -0.08347, sourceUrl: "https://example.com/hp" };

test("a complete suggestion is saved here, and says how to send it for review", () => {
  const { suggestion, errors } = validateSuggestion(good, { now: 1000 });
  assert.equal(errors, undefined);
  assert.equal(suggestion.place, "Leadenhall Market");
  assert.equal(suggestion.status, SUGGESTION_STATUS.savedHere);
  assert.equal(suggestion.at, 1000);
  assert.match(suggestionStatusLabel(suggestion.status), /sign in to send it for review/);
});

test("each missing or bad field is named, so the form can say what to fix", () => {
  const { errors } = validateSuggestion({ place: "x", work: "", lat: 0, lng: 0, sourceUrl: "javascript:alert(1)" });
  assert.deepEqual(Object.keys(errors).sort(), ["place", "position", "sourceUrl", "work"]);
  assert.ok(validateSuggestion({ ...good, sourceUrl: "" }).suggestion, "a source is optional");
  assert.ok(validateSuggestion({ ...good, lat: 95 }).errors.position);
});

test("suggestions survive a reload, and broken storage reads as none", () => {
  const values = {};
  const storage = { getItem: (key) => values[key] ?? null, setItem: (key, value) => { values[key] = value; } };
  const { suggestion } = validateSuggestion(good);
  saveSuggestions(storage, [suggestion]);
  assert.deepEqual(loadSuggestions(storage), [suggestion]);
  assert.deepEqual(loadSuggestions({ getItem: () => "{oops" }), []);
  assert.deepEqual(loadSuggestions({ getItem: () => JSON.stringify([{ place: "no id" }]) }), []);
  assert.equal(SUGGESTIONS_KEY, "scenemap-suggestions");
});

function fakeClient(result) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        insert: async (row) => {
          calls.push({ table, row });
          if (result instanceof Error) throw result;
          return { error: result };
        },
      };
    },
  };
}

test("the row sent names no user: the database fills it from the session", () => {
  const { suggestion } = validateSuggestion(good, { now: 1000 });
  const row = suggestionRow(suggestion);
  assert.equal(row.user_id, undefined);
  assert.equal(row.status, undefined, "status is the column default, pending");
  assert.deepEqual(row, {
    client_id: suggestion.id,
    place_name: "Leadenhall Market",
    work_title: "Harry Potter",
    scene: "Diagon Alley",
    lat: 51.51278,
    lng: -0.08347,
    source_url: "https://example.com/hp",
  });
});

test("a sent suggestion is in review, and only its author is told it exists", async () => {
  const { suggestion } = validateSuggestion(good);
  const client = fakeClient(null);
  const sent = await sendSuggestion(client, suggestion);
  assert.equal(sent.status, SUGGESTION_STATUS.inReview);
  assert.equal(client.calls[0].table, SUGGESTIONS_TABLE);
  assert.match(suggestionStatusLabel(sent.status), /only you can see it/);
});

test("a failed send keeps the suggestion on the device and never throws", async () => {
  const { suggestion } = validateSuggestion(good);
  const failed = await sendSuggestion(fakeClient({ code: "42501", message: "permission denied" }), suggestion);
  assert.equal(failed.status, SUGGESTION_STATUS.sendFailed);
  const offline = await sendSuggestion(fakeClient(new Error("Failed to fetch")), suggestion);
  assert.equal(offline.status, SUGGESTION_STATUS.sendFailed);
  assert.equal(offline.place, suggestion.place);
});

test("a retry of the same suggestion counts as sent; the daily cap is named", () => {
  assert.equal(statusAfterSend({ code: "23505", message: "duplicate key" }), SUGGESTION_STATUS.inReview);
  assert.equal(statusAfterSend({ code: "P0001", message: "daily suggestion limit reached" }), SUGGESTION_STATUS.limitReached);
  assert.match(suggestionStatusLabel(SUGGESTION_STATUS.limitReached), /limit/);
});

test("only suggestions kept here can be sent again", () => {
  const list = [
    { id: "a", status: SUGGESTION_STATUS.savedHere },
    { id: "b", status: SUGGESTION_STATUS.inReview },
    { id: "c", status: SUGGESTION_STATUS.sendFailed },
    { id: "d", status: SUGGESTION_STATUS.limitReached },
  ];
  assert.deepEqual(unsentSuggestions(list).map((entry) => entry.id), ["a", "c", "d"]);
  assert.deepEqual(unsentSuggestions(null), []);
});
