// The language the guide speaks (#67).
//
// The tour text is written by the model and spoken by TTS, so a language is one line in
// two prompts, not a translated tour. What this module owns is the list we offer, the
// default a phone suggests, and the sentence each prompt carries.
//
// English is the language of our own data (place names, scene notes, the scripted guide).
// It is the default, and it is what anything falls back to: a guide in English is always
// better than no guide.

export const DEFAULT_GUIDE_LANGUAGE = "en";
export const GUIDE_LANGUAGE_KEY = "scenemap-guide-language";

// The languages gpt-4o-mini-tts speaks well, by ISO 639-1 code. The native name is what a
// reader looks for in a list; the English name is what the prompt uses.
export const GUIDE_LANGUAGES = [
  ["en", "English", "English"],
  ["af", "Afrikaans", "Afrikaans"],
  ["ar", "Arabic", "العربية"],
  ["hy", "Armenian", "Հայերեն"],
  ["az", "Azerbaijani", "Azərbaycan"],
  ["be", "Belarusian", "Беларуская"],
  ["bs", "Bosnian", "Bosanski"],
  ["bg", "Bulgarian", "Български"],
  ["ca", "Catalan", "Català"],
  ["zh", "Chinese", "中文"],
  ["hr", "Croatian", "Hrvatski"],
  ["cs", "Czech", "Čeština"],
  ["da", "Danish", "Dansk"],
  ["nl", "Dutch", "Nederlands"],
  ["et", "Estonian", "Eesti"],
  ["fi", "Finnish", "Suomi"],
  ["fr", "French", "Français"],
  ["gl", "Galician", "Galego"],
  ["de", "German", "Deutsch"],
  ["el", "Greek", "Ελληνικά"],
  ["he", "Hebrew", "עברית"],
  ["hi", "Hindi", "हिन्दी"],
  ["hu", "Hungarian", "Magyar"],
  ["is", "Icelandic", "Íslenska"],
  ["id", "Indonesian", "Bahasa Indonesia"],
  ["it", "Italian", "Italiano"],
  ["ja", "Japanese", "日本語"],
  ["kn", "Kannada", "ಕನ್ನಡ"],
  ["kk", "Kazakh", "Қазақ"],
  ["ko", "Korean", "한국어"],
  ["lv", "Latvian", "Latviešu"],
  ["lt", "Lithuanian", "Lietuvių"],
  ["mk", "Macedonian", "Македонски"],
  ["ms", "Malay", "Bahasa Melayu"],
  ["mr", "Marathi", "मराठी"],
  ["mi", "Maori", "Māori"],
  ["ne", "Nepali", "नेपाली"],
  ["no", "Norwegian", "Norsk"],
  ["fa", "Persian", "فارسی"],
  ["pl", "Polish", "Polski"],
  ["pt", "Portuguese", "Português"],
  ["ro", "Romanian", "Română"],
  ["ru", "Russian", "Русский"],
  ["sr", "Serbian", "Српски"],
  ["sk", "Slovak", "Slovenčina"],
  ["sl", "Slovenian", "Slovenščina"],
  ["es", "Spanish", "Español"],
  ["sw", "Swahili", "Kiswahili"],
  ["sv", "Swedish", "Svenska"],
  ["tl", "Tagalog", "Tagalog"],
  ["ta", "Tamil", "தமிழ்"],
  ["th", "Thai", "ไทย"],
  ["tr", "Turkish", "Türkçe"],
  ["uk", "Ukrainian", "Українська"],
  ["ur", "Urdu", "اردو"],
  ["vi", "Vietnamese", "Tiếng Việt"],
  ["cy", "Welsh", "Cymraeg"],
].map(([code, name, nativeName]) => ({ code, name, nativeName }));

const BY_CODE = new Map(GUIDE_LANGUAGES.map((language) => [language.code, language]));

// Browsers say "nb-NO" for Norwegian Bokmål and "fil" for Filipino; both have a home here.
const ALIASES = { nb: "no", nn: "no", fil: "tl", iw: "he", in: "id" };

// A supported code, or null. Accepts a full locale ("pt-BR", "zh_Hant") and reads its
// language part only: the model writes one Portuguese, not a regional variant.
export function guideLanguageCode(value) {
  if (typeof value !== "string") return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  const code = ALIASES[base] ?? base;
  return BY_CODE.has(code) ? code : null;
}

export function guideLanguage(code) {
  return BY_CODE.get(guideLanguageCode(code) ?? DEFAULT_GUIDE_LANGUAGE);
}

// The first of the phone's preferred languages we can speak, else English.
export function guideLanguageFromLocales(locales) {
  const list = Array.isArray(locales) ? locales : [locales];
  for (const locale of list) {
    const code = guideLanguageCode(locale);
    if (code) return code;
  }
  return DEFAULT_GUIDE_LANGUAGE;
}

// The sentence the tour prompt carries. Proper names stay as the data spells them: a
// translated street name is one nobody on the street will recognise.
export function guideWritingInstruction(code) {
  const language = guideLanguage(code);
  return `Write the title, intro and every narration in ${language.name}. Keep place names, street names and work titles as they appear in the data.`;
}

// The sentence the voice carries. Null for English, so English clips keep the
// instructions (and the cache keys) they were made with.
export function guideSpeakingInstruction(code) {
  const language = guideLanguage(code);
  if (language.code === DEFAULT_GUIDE_LANGUAGE) return null;
  return `Speak in ${language.name}, with natural native pronunciation.`;
}
