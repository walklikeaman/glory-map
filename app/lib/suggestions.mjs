// "Add a place" (#22): a reader's suggestion.
//
// The owner's decision (12.10.2026): a signed-in reader's suggestion goes to the database
// for review, and nobody else sees it until it is checked. It lands in its own table,
// `reader_place_suggestions`, not in the queue the map draws as "unchecked places", and
// row-level security lets a reader insert only as themselves, only as pending, and read
// only their own. Without an account a suggestion stays on this device, and says so.

export const SUGGESTIONS_KEY = "scenemap-suggestions";
export const SUGGESTIONS_TABLE = "reader_place_suggestions";
export const SUGGESTION_STATUS = Object.freeze({
  savedHere: "saved_here",
  inReview: "in_review",
  sendFailed: "send_failed",
  limitReached: "limit_reached",
});

const MAX_SUGGESTIONS = 100;
const MAX_TEXT = 200;

const text = (value) => String(value ?? "").trim().slice(0, MAX_TEXT);

// Returns { suggestion } or { errors: { field: sentence } }.
export function validateSuggestion(input, { now = Date.now() } = {}) {
  const errors = {};
  const place = text(input?.place);
  const work = text(input?.work);
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  let sourceUrl = text(input?.sourceUrl) || null;

  if (place.length < 2) errors.place = "Name the place.";
  if (work.length < 1) errors.work = "Name the film, series or book.";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    errors.position = "Choose where it is: the map's centre or your location.";
  }
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (!/^https?:$/.test(url.protocol)) throw new Error("not a web link");
      sourceUrl = url.toString();
    } catch {
      errors.sourceUrl = "A source is a web link, starting with https://.";
    }
  }
  if (Object.keys(errors).length) return { errors };

  return {
    suggestion: {
      id: `s-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      place,
      work,
      scene: text(input?.scene) || null,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      sourceUrl,
      status: SUGGESTION_STATUS.savedHere,
      at: now,
    },
  };
}

export function loadSuggestions(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SUGGESTIONS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry?.id && entry?.place && Number.isFinite(entry?.at)).slice(0, MAX_SUGGESTIONS)
      : [];
  } catch {
    return [];
  }
}

export function saveSuggestions(storage, list) {
  try {
    storage?.setItem(SUGGESTIONS_KEY, JSON.stringify(list.slice(0, MAX_SUGGESTIONS)));
  } catch {
    // Storage refused: the suggestion lasts for this visit only.
  }
}

const STATUS_LABELS = {
  [SUGGESTION_STATUS.savedHere]: "Saved on this device · sign in to send it for review",
  [SUGGESTION_STATUS.inReview]: "Sent for review · only you can see it until it is checked",
  [SUGGESTION_STATUS.sendFailed]: "Couldn't send it · saved on this device",
  [SUGGESTION_STATUS.limitReached]: "Today's limit of 20 is reached · saved on this device",
};

export function suggestionStatusLabel(status) {
  return STATUS_LABELS[status] ?? "Unknown";
}

// The row the database takes. `user_id` is left to the column default, auth.uid(), so the
// browser cannot name somebody else; the insert policy checks it as well.
export function suggestionRow(suggestion) {
  return {
    client_id: suggestion.id,
    place_name: suggestion.place,
    work_title: suggestion.work,
    scene: suggestion.scene ?? null,
    lat: suggestion.lat,
    lng: suggestion.lng,
    source_url: suggestion.sourceUrl ?? null,
  };
}

// What became of an insert. A duplicate key is this same suggestion sent twice (a retry
// after a lost response), so it IS in review.
export function statusAfterSend(error) {
  if (!error) return SUGGESTION_STATUS.inReview;
  if (error.code === "23505") return SUGGESTION_STATUS.inReview;
  if (/daily suggestion limit/i.test(error.message ?? "") || error.hint === "reader_place_suggestions_daily_cap") {
    return SUGGESTION_STATUS.limitReached;
  }
  return SUGGESTION_STATUS.sendFailed;
}

// Send one suggestion under the reader's own session. Never throws: the suggestion comes
// back with the status it ended in, and is kept on the device whatever happened.
export async function sendSuggestion(client, suggestion) {
  let error = null;
  try {
    ({ error } = await client.from(SUGGESTIONS_TABLE).insert(suggestionRow(suggestion)));
  } catch (thrown) {
    error = { message: thrown?.message ?? "network" };
  }
  return { ...suggestion, status: statusAfterSend(error) };
}

// Which saved suggestions a signed-in reader can still send: the ones kept here because
// there was no account, or because sending failed. A reached limit waits for a new day.
export function unsentSuggestions(list) {
  return (Array.isArray(list) ? list : []).filter((entry) => (
    entry?.status === SUGGESTION_STATUS.savedHere || entry?.status === SUGGESTION_STATUS.sendFailed
    || entry?.status === SUGGESTION_STATUS.limitReached
  ));
}
