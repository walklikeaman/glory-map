// The first run (#15), cut down after the owner tried it on a phone (2026-11-07): one
// welcome screen for a guest, and a short deck of posters for somebody signed in.
//
// A guest sees every story on the map; picking "my films" belongs to an account. The deck
// does not build a second filter beside the library: a work swiped right goes into the
// same library an import fills, and "Only my films" — which the deck switches on — is what
// makes the choice filter the map. A left swipe is remembered so the card is not dealt
// again, and changes nothing else.

import { RATING_SCALE } from "./media-sources.mjs";

export const ONBOARDING_KEY = "scenemap-onboarding";

// The one screen a guest sees. Four screens of features was a tour nobody asked for.
export const WELCOME = Object.freeze({
  title: "Places from films, series and books",
  text: "Every pin is a spot where a story was filmed or set. The map shows all of them. Sign in to pick your own films and see only those.",
});

// How many posters the deck deals. Sixty was a chore; twenty is a minute.
export const DECK_SIZE = 20;

// "known" and "saved" are no longer offered, but records from the four-way deck still
// carry them and they still mean "this one is mine".
export const CHOICE = Object.freeze({ like: "like", skip: "skip", known: "known", saved: "saved" });

// Two answers, like a dating app: left is "not for me", right is "on my map".
export const CHOICES = Object.freeze([
  { id: CHOICE.skip, label: "Not for me", swipe: "left", key: "ArrowLeft" },
  { id: CHOICE.like, label: "On my map", swipe: "right", key: "ArrowRight" },
]);

const INTERESTED = new Set([CHOICE.like, CHOICE.known, CHOICE.saved]);

export function emptyOnboarding() {
  return { done: false, deckOffered: false, decisions: {} };
}

export function loadOnboarding(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(ONBOARDING_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const decisions = Object.fromEntries(Object.entries(parsed.decisions ?? {})
      .filter(([, decision]) => decision && Object.values(CHOICE).includes(decision.choice) && decision.title));
    return { done: parsed.done === true, deckOffered: parsed.deckOffered === true, decisions };
  } catch {
    return null;
  }
}

export function saveOnboarding(storage, state) {
  try {
    storage?.setItem(ONBOARDING_KEY, JSON.stringify(state));
  } catch {
    // Refused storage: the choices last for this visit only.
  }
}

// The welcome is shown by itself only to a new guest: no record of a first run, nothing
// in any library on this device, and no sign of an account. A reader with 2,422 imported
// films has told the map already, and a signed-in reader has been here before — the
// owner signed in on his phone and was walked through the whole tour a second time.
export function shouldOfferOnboarding(record, storedLibraryCount, signedIn = false) {
  return record === null && !(storedLibraryCount > 0) && !signedIn;
}

// Whether this page load belongs to an account, known before the session is: a Supabase
// session in storage, or the sign-in link / OAuth redirect landing with its token.
// Supabase reads the session asynchronously, and the welcome must not flash first.
export function looksSignedIn(storage, href = "") {
  try {
    const keys = storage ? Object.keys(storage) : [];
    if (keys.some((key) => /^sb-.+-auth-token$/.test(key))) return true;
  } catch {
    // Storage refused: fall through to the address.
  }
  return /[?#&](code|access_token|token_hash)=/.test(String(href));
}

// The deck is offered by itself once, to somebody signed in whose library is still empty —
// "you have an account now, which films are yours?". Never again on this device after.
export function shouldOfferDeck(record, libraryCount) {
  return !record?.deckOffered && !(libraryCount > 0);
}

// Films and series by fame, as the server sent them, with a book dealt every sixth card
// so the deck is not all one kind of story — and no more than DECK_SIZE of them.
export function orderDeck(cards, size = DECK_SIZE) {
  const list = Array.isArray(cards) ? cards : [];
  const books = list.filter((card) => card.kind === "book");
  const screen = list.filter((card) => card.kind !== "book");
  const deck = [];
  for (const card of screen) {
    deck.push(card);
    if (deck.length % 6 === 5 && books.length) deck.push(books.shift());
  }
  return [...deck, ...books].slice(0, size);
}

export function remainingCards(cards, state) {
  return (Array.isArray(cards) ? cards : []).filter((card) => !state?.decisions?.[card.id]);
}

export function decide(state, card, choice, now = Date.now()) {
  if (!card?.id || !Object.values(CHOICE).includes(choice)) return state;
  return {
    ...state,
    decisions: { ...state.decisions, [card.id]: { choice, title: card.title, year: card.year ?? null, kind: card.kind ?? null, at: now } },
  };
}

export function undoLast(state) {
  const last = Object.entries(state?.decisions ?? {}).sort((left, right) => right[1].at - left[1].at)[0];
  if (!last) return state;
  const decisions = { ...state.decisions };
  delete decisions[last[0]];
  return { ...state, decisions };
}

// The entries the library takes: the same shape an import produces, unrated, from
// "interests" — so they merge, match the catalogue and filter the map like any other.
export function libraryFromDecisions(state) {
  return Object.entries(state?.decisions ?? {})
    .filter(([, decision]) => INTERESTED.has(decision.choice))
    .map(([id, decision]) => ({
      id: `interests:${id}`,
      title: decision.title,
      year: decision.year,
      rating: null,
      ratingScale: RATING_SCALE,
      imdbId: null,
      sources: ["interests"],
    }));
}

// A sideways drag that went far enough; null for a nudge or a mostly vertical drag.
export const SWIPE_THRESHOLD_PX = 90;

export function choiceForSwipe(dx, dy, threshold = SWIPE_THRESHOLD_PX) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (Math.abs(x) < threshold || Math.abs(y) > Math.abs(x)) return null;
  return x > 0 ? CHOICE.like : CHOICE.skip;
}
