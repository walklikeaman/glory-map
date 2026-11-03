import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDE_LANGUAGES,
  guideLanguage,
  guideLanguageCode,
  guideLanguageFromLocales,
  guideSpeakingInstruction,
  guideWritingInstruction,
} from "../app/lib/guide-language.mjs";
import { createSpeechRequest } from "../app/lib/voice-guide.mjs";
import { ttsCacheKey } from "../app/lib/tts-cache.mjs";

test("the list offers 50+ languages, each once, English first", () => {
  assert.ok(GUIDE_LANGUAGES.length >= 50);
  assert.equal(GUIDE_LANGUAGES[0].code, "en");
  assert.equal(new Set(GUIDE_LANGUAGES.map((language) => language.code)).size, GUIDE_LANGUAGES.length);
});

test("a locale is read by its language part, and aliases find their home", () => {
  assert.equal(guideLanguageCode("pt-BR"), "pt");
  assert.equal(guideLanguageCode("zh_Hant"), "zh");
  assert.equal(guideLanguageCode("nb-NO"), "no");
  assert.equal(guideLanguageCode("fil"), "tl");
  assert.equal(guideLanguageCode("xx"), null);
  assert.equal(guideLanguageCode(null), null);
});

test("the default is the first preferred language we speak, else English", () => {
  assert.equal(guideLanguageFromLocales(["gsw-CH", "de-CH", "en"]), "de");
  assert.equal(guideLanguageFromLocales(["xx"]), "en");
  assert.equal(guideLanguageFromLocales(undefined), "en");
  assert.equal(guideLanguageFromLocales("ru-RU"), "ru");
});

test("an unknown code is English, never an error", () => {
  assert.equal(guideLanguage("klingon").code, "en");
  assert.equal(guideLanguage("FR").code, "fr");
});

test("the prompts name the language and keep proper names as the data spells them", () => {
  assert.match(guideWritingInstruction("ja"), /in Japanese\. Keep place names/);
  assert.match(guideWritingInstruction("zz"), /in English\./);
  assert.equal(guideSpeakingInstruction("en"), null);
  assert.match(guideSpeakingInstruction("es"), /Speak in Spanish/);
});

test("the voice keeps its manner and adds the language; English is unchanged", () => {
  const english = createSpeechRequest({ text: "Hello", profileId: "neutral" });
  const legacy = createSpeechRequest({ text: "Hello", profileId: "neutral", language: "en" });
  assert.equal(english.instructions, legacy.instructions);
  assert.doesNotMatch(english.instructions, /Speak in/);

  const french = createSpeechRequest({ text: "Bonjour", profileId: "neutral", language: "fr" });
  assert.ok(french.instructions.startsWith(english.instructions));
  assert.match(french.instructions, /Speak in French/);
});

test("the cache key changes with the language, and English keeps its old key", () => {
  const base = { text: "Hello", voice: "marin", model: "gpt-4o-mini-tts" };
  assert.equal(ttsCacheKey(base), ttsCacheKey({ ...base, language: "en" }));
  assert.notEqual(ttsCacheKey(base), ttsCacheKey({ ...base, language: "fr" }));
});
