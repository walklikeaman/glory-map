// Reading filming locations out of Wikipedia prose (#47).
//
// Wikidata's P915 covers a few thousand films. Thousands more describe where they were
// shot only in the "Production" section of their article. That is a large, legal
// expansion — and it is also the first path where a place enters our graph without a
// canonical statement behind it, so everything here is built to arrive as `pending`.
//
// The constraints below were verified against the live APIs and the licence texts, not
// recalled. Several are the opposite of what a reasonable guess would be:
//
//   * A missing or library-default User-Agent gets HTTP 403 from Wikimedia. Not a
//     throttle — a refusal.
//   * `action=parse&section=` takes the section's `index`, and `index` is NOT `number`.
//     On "Lost in Translation (film)" Production is index 8 and number 4; passing the
//     number silently returns different prose, which is worse than an error.
//   * Wikimedia returns errors with HTTP 200 and an `error` key in the body, so
//     checking the status code alone reports success on a missing article.
//   * `prop=sections` is deprecated in favour of `prop=tocdata`.

import { integerOrNull } from "./numbers.mjs";
import { CONTACT_USER_AGENT } from "./user-agent.mjs";

// One identity for every outbound call. Wikimedia requires a real contact; a
// placeholder domain is itself a policy violation, and copying a browser's UA is
// treated as malicious rather than merely rude.
export const USER_AGENT = CONTACT_USER_AGENT;

// How far behind a replica may be before we agree to be turned away.
//
// maxlag exists so that bots stop hammering the databases during trouble, and honouring
// it is not optional. But five seconds — the value for a bot making EDITS — turns this
// job away for a reason that protects nothing: we read article titles and sitelinks,
// which change on the scale of years, so a replica eight seconds behind serves us data
// that is byte-for-byte what a fresh one would. Measured live, routine lag sits around
// 8s (x-database-lag: 8, retry-after: 5) and never clears at five.
//
// A real incident is minutes behind, not seconds, and this still backs off from that.
export const MAX_DATABASE_LAG_SECONDS = 30;

// 30% of the documented 200/min ceiling. The ceiling itself carries a "subject to
// change" note, so it is deliberately not hardcoded as the target — and this job has
// no deadline that justifies running near a limit.
export const REQUESTS_PER_MINUTE = 60;
export const MIN_REQUEST_GAP_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE);

export const WIKIPEDIA_LICENSE = Object.freeze({
  name: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
});

// Sections worth reading, best first, per language edition.
//
// Read off real articles rather than translated from the English list, and the payoff
// is bigger than "the same thing in another language": SEVERAL EDITIONS HAVE A
// DEDICATED LOCATIONS SECTION THAT ENGLISH LACKS. On Skyfall, French carries "Lieux de
// l'action", Spanish "Localizaciones", Japanese "ロケーション" — while English buries the
// same material inside "Production" and Russian folds the whole thing into one
// "Работа над картиной".
//
// So this is not redundancy. An article in the film's own language routinely names
// streets and buildings the English one summarises as "on location in the city".
//
// The h2 is preferred over its child because MediaWiki returns the whole subtree —
// asking for the child throws away the siblings that usually carry the location prose.
// A heading that means "where the story happens" is NOT one that means "where it was
// shot", and this project is built on exactly that distinction. Both were in this list
// once, and French duly picked "Lieux de l'action" — 105 characters about the plot's
// settings — over the "Tournage" section further down that actually describes the
// shoot. Narrative headings are excluded here; they belong to a different claim.
// The PARENT production heading comes first in every edition, for the reason the
// English list already had: MediaWiki returns the whole subtree, so asking for the
// child throws away the siblings that carry the location prose. Verified on Skyfall —
// French "Tournage", Spanish "Localizaciones", Japanese "ロケーション" and Polish "Zdjęcia"
// are all children of the production heading above them. The specific filming headings
// are the fallback for articles that have no parent, which is the usual German shape.
const SECTION_RANK_BY_LANGUAGE = Object.freeze({
  en: ["production", "filming", "principal photography", "filming locations",
    "locations and sets", "pre-production", "development"],
  fr: ["production", "tournage", "lieux de tournage", "développement"],
  de: ["produktion", "entstehungsgeschichte", "dreharbeiten", "drehorte", "vorproduktion"],
  ru: ["работа над картиной", "производство", "создание", "съёмки", "места съёмок"],
  es: ["producción", "rodaje", "filmación", "localizaciones", "desarrollo"],
  it: ["produzione", "riprese", "luoghi delle riprese", "sviluppo"],
  ja: ["製作", "制作", "撮影", "ロケ地", "ロケーション"],
  pl: ["produkcja", "zdjęcia", "plenery", "miejsca zdjęć", "powstanie"],
});

// **A book is not made on a set, and its article says so in different words.**
//
// Measured 12.09 across the nine books in the catalogue: Crime and Punishment leads with
// "Background", Finnegans Wake with "Background and composition", The Lord of the Rings
// carries "Concept and creation", "Background" and "Writing". None of those appear in the
// film table, so before this every book article resolved to "no production section" and the
// nine of them were unreachable.
//
// This is where an author place comes from — the room the book was written in, the street
// it was drawn from, the graveyard a name was taken off. [[three-axes]] calls that the
// common shape of the best material.
//
// Mrs Dalloway and Roughing It have no such section at all, and that is an ordinary answer
// rather than a gap to paper over.
const BOOK_SECTION_RANK_BY_LANGUAGE = Object.freeze({
  en: ["concept and creation", "background and composition", "composition", "writing",
    "writing and publication", "genesis", "creation", "background", "origins", "inspiration"],
  fr: ["genèse", "écriture", "rédaction", "création", "contexte"],
  de: ["entstehung", "entstehungsgeschichte", "hintergrund"],
  ru: ["история создания", "создание", "написание", "замысел", "работа над романом"],
  es: ["génesis", "escritura", "creación", "composición", "contexto"],
  it: ["genesi", "stesura", "composizione", "contesto"],
  ja: ["成立", "執筆", "背景"],
  pl: ["geneza", "powstanie", "tło"],
});

// Which table a work's article should be read with. A series is shot like a film; anything
// else that is written rather than filmed reads like a book.
export function sectionRankFor(language, kind = "film") {
  const table = kind === "book" ? BOOK_SECTION_RANK_BY_LANGUAGE : SECTION_RANK_BY_LANGUAGE;
  return table[language] ?? null;
}

// Ordered by how much production prose the edition tends to carry. English first
// because it is the best-covered; after that an article in the work's own language is
// usually the richest, and the caller decides which those are.
export const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(SECTION_RANK_BY_LANGUAGE));

// Each language costs a model call, so the batch is bounded per work rather than per
// run. Three covers English plus the work's own language plus one more.
export const MAX_LANGUAGES_PER_WORK = 3;

// **The edition in the work's own language is the one that names its own places**, and
// until now nothing asked for it. `languagesForWork` has taken a `preferred` argument since
// it was written — the comment above it even explains why that edition goes second — and
// the caller never passed one, so the parameter was dead and a French film's French article
// was read only if it happened to fall into the arbitrary remainder.
//
// Wikidata answers it directly. **P364 is the original language of the work**, verified
// 12.09 against the live API: Der Untergang carries Q188, Q7737 and Q9067 — German, Russian
// and Hungarian — so a work can have several and all of them count, in the order stated.
// P495 (country of origin) is the fallback for the many works that have no P364.
const LANGUAGE_BY_WIKIDATA_ID = Object.freeze({
  Q1860: "en", Q150: "fr", Q188: "de", Q7737: "ru",
  Q1321: "es", Q652: "it", Q5287: "ja", Q809: "pl",
});

// Only where the country implies ONE of the editions we can read. A multilingual country
// says nothing useful here: Switzerland and Belgium are deliberately absent rather than
// guessed at, and both are real cases in a film catalogue.
const LANGUAGE_BY_COUNTRY_ID = Object.freeze({
  Q30: "en", Q145: "en", Q408: "en", Q16: "en",   // US, UK, Australia, Canada
  Q142: "fr", Q183: "de", Q40: "de", Q159: "ru",  // France, Germany, Austria, Russia
  Q29: "es", Q96: "es", Q414: "es",               // Spain, Mexico, Argentina
  Q38: "it", Q17: "ja", Q36: "pl",                // Italy, Japan, Poland
});

function claimIds(entity, property) {
  return (entity?.claims?.[property] ?? [])
    .map((statement) => statement?.mainsnak?.datavalue?.value?.id)
    .filter((id) => typeof id === "string");
}

// The editions this work is most likely to describe in its own terms, best first. An empty
// list is an ordinary answer — most works give no usable signal, and English leads anyway.
export function preferredLanguages(entity) {
  const fromLanguage = claimIds(entity, "P364").map((id) => LANGUAGE_BY_WIKIDATA_ID[id]);
  const fromCountry = claimIds(entity, "P495").map((id) => LANGUAGE_BY_COUNTRY_ID[id]);
  return [...new Set([...fromLanguage, ...fromCountry].filter(Boolean))];
}

// The API's own batch ceiling. A caller with more ids than this must ask more than once —
// `buildEntitiesUrl` answers null rather than building a URL that would be refused, and the
// null is what a caller passing 200 ids discovers as "Failed to parse URL from null".
export const MAX_ENTITIES_PER_REQUEST = 50;

export function buildEntitiesUrl(qids, languages = SUPPORTED_LANGUAGES) {
  const ids = [...new Set(qids ?? [])].filter((id) => /^Q[1-9]\d*$/.test(id));
  if (ids.length === 0 || ids.length > MAX_ENTITIES_PER_REQUEST) return null;
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", ids.join("|"));
  // `claims` as well as the sitelinks: P364 and P495 are what say which edition is the
  // work's own, and without them `preferredLanguages` has nothing to read.
  url.searchParams.set("props", "sitelinks/urls|claims");
  url.searchParams.set("sitefilter", languages.map((code) => `${code}wiki`).join("|"));
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("maxlag", String(MAX_DATABASE_LAG_SECONDS));
  return url.toString();
}

export function articleTitleFromEntity(entity, language = "en") {
  const title = entity?.sitelinks?.[`${language}wiki`]?.title;
  // No article means skip the work. A constructed title would land on the wrong page
  // or a disambiguation, and be indistinguishable from a real answer.
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

// Which editions to read for one work, best first and bounded.
//
// `preferred` is the language of the work's own country of origin. It goes second
// rather than first: English is the best-covered edition and the one whose section
// names we have exercised most, and a work whose home edition is a stub should not
// lose the English article to the cap.
export function languagesForWork(entity, { preferred = null, limit = MAX_LANGUAGES_PER_WORK } = {}) {
  const available = SUPPORTED_LANGUAGES.filter((code) => articleTitleFromEntity(entity, code));
  // A work can be in more than one language — Der Untergang is German, Russian and
  // Hungarian — so this takes a list. A single code still works, and no argument at all
  // falls back to what the entity itself says.
  const wanted = (Array.isArray(preferred) ? preferred : [preferred].filter(Boolean));
  const home = (wanted.length ? wanted : preferredLanguages(entity)).filter((code) => code !== "en");

  const ordered = [
    ...available.filter((code) => code === "en"),
    // In the order the work states them, not in the order SUPPORTED_LANGUAGES happens to
    // list them: a German-Russian co-production should read German before Russian.
    ...home.filter((code) => available.includes(code)),
    ...available.filter((code) => code !== "en" && !home.includes(code)),
  ];
  return [...new Set(ordered)].slice(0, Math.max(1, limit));
}

export function buildTocUrl(title, language = "en") {
  if (typeof title !== "string" || !title.trim()) return null;
  if (!SUPPORTED_LANGUAGES.includes(language)) return null;
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", title.trim());
  // `revid` must be asked for explicitly. The docs read as though action=parse
  // returns it anyway; it does not, and without it the permalink cannot be pinned —
  // which is the one field that fixes which licence version the text was under.
  url.searchParams.set("prop", "tocdata|revid"); // `sections` is deprecated
  url.searchParams.set("redirects", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("maxlag", String(MAX_DATABASE_LAG_SECONDS));
  return url.toString();
}

export function buildSectionUrl(title, index, language = "en") {
  const sectionIndex = String(index ?? "").trim();
  if (!title || !/^\d+$/.test(sectionIndex)) return null;
  if (!SUPPORTED_LANGUAGES.includes(language)) return null;
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", title);
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("section", sectionIndex);
  url.searchParams.set("redirects", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("maxlag", String(MAX_DATABASE_LAG_SECONDS));
  return url.toString();
}

// Which section to read. Returns the `index`, never the `number` — see the header.
export function chooseSection(tocdata, language = "en", { kind = "film" } = {}) {
  const sections = tocdata?.sections;
  if (!Array.isArray(sections) || sections.length === 0) return null;
  const ranked = sectionRankFor(language, kind);
  if (!ranked) return null;

  // An exact heading beats one that merely CONTAINS a listed word, and the difference
  // is not cosmetic: "vorproduktion".includes("produktion") is true, so a plain
  // substring test picked the German pre-production section over the article's real
  // "Entstehungsgeschichte". The same trap waits in "Nachproduktion" and
  // "Postprodukcja" — a prefix reverses what the heading means.
  const scoreOf = (line) => {
    const text = String(line ?? "").toLowerCase().trim();
    const exact = ranked.indexOf(text);
    if (exact !== -1) return { exactness: 0, rank: exact };
    const contains = ranked.findIndex((name) => text.includes(name));
    return contains === -1 ? null : { exactness: 1, rank: contains };
  };

  // An h2 outranks a deeper heading with the same name, because its subtree contains
  // everything below it.
  const best = sections
    .map((section) => ({ section, score: scoreOf(section.line), level: Number(section.hLevel) || 9 }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => (a.score.exactness - b.score.exactness)
      || (a.score.rank - b.score.rank)
      || (a.level - b.level))[0];

  if (!best) return null;
  const index = String(best.section.index ?? "");
  return /^\d+$/.test(index)
    ? { index, line: best.section.line, level: best.level }
    : null;
}

// Wikimedia answers a missing page with HTTP 200 and an `error` object, so a status
// check alone reports success for an article that does not exist.
export function apiError(payload) {
  const error = payload?.error;
  if (!error) return null;
  return error.code ? `${error.code}: ${error.info ?? ""}`.trim() : "unknown api error";
}

// Not every 200-with-an-error-body means the same thing, and treating them alike threw
// away a whole enrichment run over eight seconds of replica lag.
//
//   * missingtitle, invalidtitle — permanent. The page does not exist; asking again
//     produces the same answer, so the work is skipped.
//   * maxlag, readonly, ratelimited — temporary, and in the maxlag case it is the API
//     answering the politeness WE asked for: we send maxlag ourselves, so being told a
//     replica is behind is the signal to come back shortly, not a failure.
const RETRYABLE_API_ERRORS = new Set(["maxlag", "readonly", "ratelimited"]);

export function isRetryableApiError(payload) {
  const code = payload?.error?.code;
  return typeof code === "string" && RETRYABLE_API_ERRORS.has(code);
}

// **A maxlag refusal can be about a service this project never asks anything of.**
// Wikidata folds the Query Service's lag into `maxlag` so that EDITS back off and let
// SPARQL catch up. We make no edits, and `wbgetentities` reads the entity out of the
// MediaWiki database, which serves it in full whether or not WDQS is behind.
//
// Measured 20.09, and it is why this exists: `queryserviceLag` was **31,650 seconds** —
// nearly nine hours — while the identical request with `maxlag` removed answered
// immediately and completely. Honouring that number would have parked a sixty-hour run
// until the next day, and the five retries (30+60+90+120+150s) would have run out on the
// entity batch that happens BEFORE the first work is read, so the run would have ended
// having done nothing at all.
//
// Replication lag is a different answer and is still obeyed: it carries no `type`, or a
// type naming the database, and it means the read itself would be stale.
export function isQueryServiceLag(payload) {
  return payload?.error?.code === "maxlag"
    && payload?.error?.type === "wikibase-queryservice";
}

// The same request, minus the politeness that did not apply to it. Returns null when
// there was no `maxlag` to drop, which is the caller's signal that it has already asked
// this way once and must not loop.
export function withoutMaxlag(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (!parsed.searchParams.has("maxlag")) return null;
  parsed.searchParams.delete("maxlag");
  return parsed.toString();
}

// How long to wait, taken from the response rather than guessed. Wikimedia sends
// Retry-After with a maxlag breach and with 429/503, and it is the source of truth.
export function retryAfterMs(response, fallbackMs = 5000) {
  const header = Number(response?.headers?.get?.("retry-after"));
  return Number.isFinite(header) && header > 0 ? header * 1000 : fallbackMs;
}

// A bound, so a service that is lagged indefinitely fails loudly instead of looping.
export const MAX_RETRY_ATTEMPTS = 5;

// --- text ---------------------------------------------------------------------

// Third-party quoted material Wikipedia carries under its OWN fair-use policy. It is
// NOT CC BY-SA, so the licence gives us nothing for it — a director's interview quote
// republished in a commercial app has no permission behind it at all. Removed before
// any sentence is considered, rather than filtered at display time.
const NON_FREE_BLOCKS = [
  /<blockquote[\s\S]*?<\/blockquote>/gi,
  /\{\{\s*(?:quote|blockquote|cquote|quotation)\b[\s\S]*?\}\}/gi,
];

export function stripNonFreeQuotes(wikitext) {
  let text = String(wikitext ?? "");
  for (const pattern of NON_FREE_BLOCKS) text = text.replace(pattern, " ");
  return text;
}

// Wikitext → readable prose. Order matters: references and files must go before
// template stripping, or their contents leak out as loose text.
export function cleanWikitext(wikitext) {
  let text = stripNonFreeQuotes(wikitext);

  text = text
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<ref[\s\S]*?<\/ref>/gi, " ")
    .replace(/\{\|[\s\S]*?\|\}/g, " ");        // tables

  // File links contain nested [[…]] in their captions, so a lazy match stops at the
  // FIRST closing pair and leaves a stray "]]" in the prose — seen live on
  // "Lost in Translation (film)". Consume them innermost-first instead.
  for (let pass = 0; pass < 6 && /\[\[(?:File|Image):/i.test(text); pass += 1) {
    text = text.replace(/\[\[(?:File|Image):(?:[^[\]]|\[\[[^\]]*\]\])*\]\]/gi, " ");
  }

  // Templates nest, so strip repeatedly until it settles rather than once.
  for (let pass = 0; pass < 6 && /\{\{/.test(text); pass += 1) {
    text = text.replace(/\{\{[^{}]*\}\}/g, " ");
  }

  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")  // [[A|B]] → B
    .replace(/\[\[([^\]]+)\]\]/g, "$1")             // [[A]]   → A
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/'''?/g, "")
    // Headings are their own line. Stripping the = marks in place glued the next
    // heading onto the previous one — "ProductionDevelopment" — which then reads as
    // one word to both a person and a model.
    .replace(/^\s*={2,}\s*(.+?)\s*={2,}\s*$/gm, "\n$1.\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A quote may be stored, but kept short: ONE SENTENCE. This is not a legal safe
// harbour — no word count creates one — it simply keeps every quote obviously inside
// any quotation exception, so the attribution we render is belt-and-braces.
//
// The single-sentence rule is the real bound; the word count only catches a run-on.
// It was 30, and on the first live run that threw away legitimate evidence: a
// Production section writes "Filming took place at X, which stood in for Y, with the
// production using a purpose-built set at Z" as one 40-word sentence. The quote exists
// so a reviewer can VERIFY the claim against the article, and a sentence cut off by an
// arbitrary word count cannot be verified — the cap was defeating its own purpose.
export const MAX_QUOTE_WORDS = 45;

// Why a quote cannot be stored, or null if it can. Two different rules failed under one
// name before, so a log saying "quote_too_long" could equally have meant "the model
// joined two sentences" — different problems with different fixes.
export function quoteRejection(quote) {
  const text = String(quote ?? "").trim();
  if (!text) return "quote_empty";
  if ((text.match(/[.!?](\s|$)/g) ?? []).length > 1) return "quote_multiple_sentences";
  if (text.split(/\s+/).length > MAX_QUOTE_WORDS) return "quote_too_long";
  return null;
}

export function isStorableQuote(quote) {
  return quoteRejection(quote) === null;
}

// --- attribution ----------------------------------------------------------------

// Pinning the revision is the highest-value field here: it makes the credit point at
// the exact text copied, and it settles which licence version applies — revisions
// after 7 June 2023 are unambiguously 4.0.
//
// `integerOrNull` rather than `Number.isInteger(Number(revid))`: `Number(null)` is 0
// and 0 is an integer, so the naive check happily builds `oldid=null` — the same
// coercion that put places at Null Island four times before numbers.mjs existed.
export function permalink(title, revid, language = "en") {
  const revision = integerOrNull(revid);
  if (!title || revision === null || revision <= 0) return null;
  if (!SUPPORTED_LANGUAGES.includes(language)) return null;
  const url = new URL(`https://${language}.wikipedia.org/w/index.php`);
  url.searchParams.set("title", String(title).replace(/ /g, "_"));
  url.searchParams.set("oldid", String(revision));
  return url.toString();
}

// Both halves are required and are separate obligations: crediting the author (the
// article) and giving the licensing notice (naming CC BY-SA and linking it). Shipping
// only "Source: Wikipedia" plus a link is the common failure and is non-compliant.
export function wikipediaAttribution({ title, revid, modified = false, language = "en" }) {
  if (!title) return null;
  // The credit must point at the edition the text was actually copied from. Once the
  // extractor reads French and Japanese articles, an en.wikipedia link is not a
  // slightly wrong URL — it credits the wrong authors for the sentence we stored.
  const edition = SUPPORTED_LANGUAGES.includes(language) ? language : "en";
  return {
    source: "wikipedia",
    label: `Wikipedia (${edition}), "${title}"`,
    article_url: `https://${edition}.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, "_"))}`,
    permalink: permalink(title, revid, edition),
    revid: integerOrNull(revid),
    license: WIKIPEDIA_LICENSE.name,
    license_url: WIKIPEDIA_LICENSE.url,
    modified: Boolean(modified),
    // Rendered wherever the quote is shown — not on an About page, because public
    // display is what the licence calls Sharing.
    language: edition,
    notice: `Source: Wikipedia (${edition}), "${title}" — ${WIKIPEDIA_LICENSE.name}${modified ? " (modified)" : ""}`,
  };
}

// **The page-view path, for when the action API refuses.** Measured 07.11.2026 from the
// cloud egress: every `w/api.php` and `rest_v1` call answers 429 at once, while
// `w/index.php?action=raw` answers 200. The raw wikitext is the same text `action=parse`
// returns a section of, so the table of contents and the section are rebuilt from it here.
//
// Pinned by `oldid`, so the text read is exactly the revision the permalink cites. The
// revision id comes from the Wikidata query service's MediaWiki bridge (`@lastrevid`),
// which is not rate-limited the same way.
export function buildRawUrl(title, revid, language = "en") {
  if (typeof title !== "string" || !title.trim()) return null;
  if (!SUPPORTED_LANGUAGES.includes(language)) return null;
  const url = new URL(`https://${language}.wikipedia.org/w/index.php`);
  url.searchParams.set("title", title.trim());
  url.searchParams.set("action", "raw");
  if (/^\d+$/.test(String(revid ?? ""))) url.searchParams.set("oldid", String(revid));
  return url.toString();
}

const HEADING = /^(={2,6})\s*(.+?)\s*\1\s*$/;

// Headings of a wikitext, numbered the way MediaWiki numbers sections: 1 is the first
// heading, 0 the lead. Only `== … ==` lines count; a heading inside a comment does not
// exist for the parser either, so comments are dropped first.
function headingLines(wikitext) {
  const lines = String(wikitext ?? "").replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const headings = [];
  lines.forEach((text, at) => {
    const match = HEADING.exec(text.trim());
    if (match) headings.push({ at, level: match[1].length, line: match[2].replace(/'''?/g, "").trim() });
  });
  return { lines, headings };
}

// The shape `chooseSection` reads from `action=parse&prop=tocdata`.
export function tocFromWikitext(wikitext) {
  const { headings } = headingLines(wikitext);
  return {
    sections: headings.map((heading, position) => ({
      index: String(position + 1), line: heading.line, hLevel: heading.level,
    })),
  };
}

// Section `index` with its subsections, heading included — what `prop=wikitext&section=`
// returns — so `cleanWikitext` sees the same input either way.
export function sectionFromWikitext(wikitext, index) {
  const { lines, headings } = headingLines(wikitext);
  const position = Number(index) - 1;
  const start = headings[position];
  if (!start) return "";
  const next = headings.slice(position + 1).find((heading) => heading.level <= start.level);
  return lines.slice(start.at, next ? next.at : lines.length).join("\n");
}
