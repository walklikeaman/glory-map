import { guideSpeakingInstruction } from "./guide-language.mjs";

export const NARRATOR_PROFILES = {
  neutral: {
    label: "Warm guide",
    voice: "marin",
    instructions: "Speak as a warm, polished museum audio guide. Use natural pacing, clear pronunciation, and understated cinematic energy.",
  },
  archivist: {
    label: "Curious archivist",
    voice: "cedar",
    instructions: "Speak as an original curious city archivist. Sound observant, inviting, and lightly cinematic without imitating any real person.",
  },
  // Genre tones (#68). Each one steers manner, emotion and pace, and none of them is a
  // performer: "a hard-boiled narrator" is a register, never a named actor's voice.
  noir: {
    label: "Noir detective",
    genre: true,
    voice: "onyx",
    instructions: "Speak as an original hard-boiled noir narrator: low, unhurried, dry and a little weary, with short pauses after each sentence, as if recounting a case at night. Do not imitate any real actor or film character.",
  },
  suspense: {
    label: "Suspense",
    genre: true,
    voice: "ash",
    instructions: "Speak as an original suspense narrator: quiet, controlled and close to the listener, with slow tension-building pacing and a slight hush. Keep it atmospheric, never frightening for its own sake, and do not imitate any real person.",
  },
  epic: {
    label: "Epic storyteller",
    genre: true,
    voice: "fable",
    instructions: "Speak as an original epic storyteller: warm, resonant and full of wonder, with broad measured pacing as if opening a legend. Grand but not shouting, and never imitating any real actor.",
  },
  light: {
    label: "Light and playful",
    genre: true,
    voice: "coral",
    instructions: "Speak as an original light-hearted guide: bright, friendly and quick, with a smile in the voice and gentle comic timing. Do not imitate any real comedian or actor.",
  },
  tender: {
    label: "Tender",
    genre: true,
    voice: "shimmer",
    instructions: "Speak as an original gentle romantic narrator: soft, warm and unhurried, with an affectionate tone, like sharing a favourite memory. Do not imitate any real person.",
  },
};

// What "match the work" means when nothing about the work is known.
export const DEFAULT_PROFILE_ID = "neutral";

// TMDB genre names to a tone, first match wins. The order is the tactful part: a crime
// comedy reads as noir before it reads as slapstick, and a horror film gets suspense,
// not a scream. Drama, documentary and history match nothing and keep the warm guide:
// a documentary narrated "epically" would be the product telling the story wrong.
const GENRE_TONES = [
  ["noir", ["crime", "mystery", "film noir"]],
  ["suspense", ["thriller", "horror"]],
  ["epic", ["fantasy", "science fiction", "sci-fi & fantasy", "adventure", "action & adventure", "war", "war & politics", "western"]],
  ["tender", ["romance"]],
  ["light", ["comedy", "animation", "family", "kids"]],
];

export function genreProfileId(genres) {
  const names = new Set((Array.isArray(genres) ? genres : [])
    .map((genre) => String(genre?.name ?? genre ?? "").trim().toLowerCase())
    .filter(Boolean));
  for (const [profileId, matches] of GENRE_TONES) {
    if (matches.some((name) => names.has(name))) return profileId;
  }
  return null;
}

// The narrator actually used: an explicit choice wins, "auto" follows the genre, and an
// unknown or missing genre is the warm guide.
export function resolveNarrator(choice, genres) {
  if (choice && choice !== "auto" && NARRATOR_PROFILES[choice]) return choice;
  return genreProfileId(genres) ?? DEFAULT_PROFILE_ID;
}

export function narrationText({ location, story, spoilerFree }) {
  if (!location) return "";

  if (spoilerFree) {
    return `${location.place} is a verified screen or story location connected to ${location.film}. Look around for the setting, architecture, and street details that give this place its character.`;
  }

  return story?.trim() || location.description?.trim() ||
    `${location.place} is a screen or story location connected to ${location.film}.`;
}

export function createSpeechRequest({ text, profileId, model, language }) {
  const profile = NARRATOR_PROFILES[profileId];

  if (!profile || typeof text !== "string" || !text.trim() || text.length > 600) {
    throw new Error("Invalid narration request");
  }

  return {
    model: model || "gpt-4o-mini-tts",
    voice: profile.voice,
    input: text.trim(),
    // The narrator's manner, then the language: the profile is how it sounds, the
    // language line only says what it speaks.
    instructions: [profile.instructions, guideSpeakingInstruction(language)].filter(Boolean).join(" "),
    response_format: "mp3",
  };
}
