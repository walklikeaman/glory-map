import assert from "node:assert/strict";
import test from "node:test";

import {
  apiError,
  isRetryableApiError,
  isQueryServiceLag,
  withoutMaxlag,
  MAX_DATABASE_LAG_SECONDS,
  MAX_RETRY_ATTEMPTS,
  retryAfterMs,
  articleTitleFromEntity,
  buildEntitiesUrl,
  buildSectionUrl,
  buildTocUrl,
  chooseSection,
  sectionRankFor,
  SUPPORTED_LANGUAGES,
  MAX_ENTITIES_PER_REQUEST,
  languagesForWork,
  preferredLanguages,
  cleanWikitext,
  isStorableQuote,
  MAX_QUOTE_WORDS,
  MIN_REQUEST_GAP_MS,
  permalink,
  stripNonFreeQuotes,
  USER_AGENT,
  wikipediaAttribution,
  WIKIPEDIA_LICENSE,
} from "../app/lib/wikipedia-source.mjs";

// --- identity -------------------------------------------------------------------

test("the User-Agent names a real contact, because Wikimedia 403s anything less", () => {
  // Verified live: a missing or library-default agent is refused outright, not slowed.
  assert.match(USER_AGENT, /https?:\/\//);
  assert.match(USER_AGENT, /@/);
  assert.equal(/example\./i.test(USER_AGENT), false);
  assert.equal(/^(curl|python-requests|node-fetch|axios)\//i.test(USER_AGENT), false);
});

test("the pace is well under the documented ceiling", () => {
  // The 200/min limit carries a "subject to change" note, and nothing here is urgent.
  assert.ok(MIN_REQUEST_GAP_MS >= 1000);
});

// --- the calls ------------------------------------------------------------------

test("entity lookups respect the API's own batch ceiling", () => {
  assert.match(buildEntitiesUrl(["Q1", "Q2"]), /ids=Q1%7CQ2/);
  assert.match(buildEntitiesUrl(["Q1"]), /sitefilter=enwiki/);
  assert.match(buildEntitiesUrl(["Q1"]), /maxlag=/);
  assert.equal(buildEntitiesUrl(Array.from({ length: 51 }, (_, i) => `Q${i + 1}`)), null);
  assert.equal(buildEntitiesUrl(["not-a-qid"]), null);
  assert.equal(buildEntitiesUrl([]), null);
});

test("a work with no English article is skipped, never guessed at", () => {
  // A constructed title lands on the wrong page or a disambiguation, and looks
  // exactly like a real answer.
  assert.equal(articleTitleFromEntity({ sitelinks: { enwiki: { title: "Skyfall" } } }), "Skyfall");
  assert.equal(articleTitleFromEntity({ sitelinks: {} }), null);
  assert.equal(articleTitleFromEntity(null), null);
});

test("the section list uses tocdata, not the deprecated sections prop", () => {
  const url = buildTocUrl("Skyfall");
  assert.match(url, /prop=tocdata/);
  assert.equal(/prop=sections/.test(url), false);
  assert.match(url, /redirects=1/);
});

test("a section is fetched by index, and only by an index", () => {
  assert.match(buildSectionUrl("Skyfall", "8"), /section=8/);
  // A name is not a valid section selector anywhere in the Action API.
  assert.equal(buildSectionUrl("Skyfall", "Production"), null);
  assert.equal(buildSectionUrl("", "8"), null);
});

// --- choosing the section --------------------------------------------------------

const toc = (sections) => ({ sections });

test("the h2 Production wins over its Filming child", () => {
  // MediaWiki returns the whole subtree, so the parent brings Development, Filming
  // and Locations in one call; asking for the child throws its siblings away.
  const chosen = chooseSection(toc([
    { line: "Plot", index: "1", hLevel: 2 },
    { line: "Production", index: "4", hLevel: 2 },
    { line: "Filming", index: "6", hLevel: 3 },
  ]));
  assert.equal(chosen.index, "4");
});

test("index is returned, never number — they differ and the number is silently wrong", () => {
  // On "Lost in Translation (film)" Production is index 8, number 4. Passing the
  // number returns different prose, which is worse than an error.
  const chosen = chooseSection(toc([
    { line: "Production", index: "8", number: "4", hLevel: 2 },
  ]));
  assert.equal(chosen.index, "8");
});

test("a differently-named section is still found by rank", () => {
  const chosen = chooseSection(toc([
    { line: "Plot", index: "1", hLevel: 2 },
    { line: "Principal photography", index: "5", hLevel: 3 },
  ]));
  assert.equal(chosen.index, "5");
});

test("an article with no production section is skipped cleanly", () => {
  // Real articles have none; this is a normal outcome, not a failure.
  assert.equal(chooseSection(toc([{ line: "Plot", index: "1", hLevel: 2 }])), null);
  assert.equal(chooseSection(toc([])), null);
  assert.equal(chooseSection(null), null);
});

test("a section with no usable index is refused", () => {
  assert.equal(chooseSection(toc([{ line: "Production", index: "", hLevel: 2 }])), null);
});

// --- errors ----------------------------------------------------------------------

test("an error arriving with HTTP 200 is still an error", () => {
  // Wikimedia answers a missing page with 200 and an error body; checking the status
  // code alone reports success for an article that does not exist.
  assert.match(apiError({ error: { code: "missingtitle", info: "no page" } }), /missingtitle/);
  assert.equal(apiError({ parse: { revid: 1 } }), null);
  assert.equal(apiError(null), null);
});

// --- text ------------------------------------------------------------------------

test("third-party quoted material is removed before anything is considered", () => {
  // Wikipedia carries these under its OWN fair-use policy — they are not CC BY-SA, so
  // the licence gives us nothing for them.
  const text = stripNonFreeQuotes(
    'Filming began. <blockquote>"We shot it all in Glencoe," said Mendes.</blockquote> Later, Istanbul.',
  );
  assert.equal(text.includes("Mendes"), false);
  assert.ok(text.includes("Istanbul"));

  const templated = stripNonFreeQuotes("Before {{Quote|A borrowed line.}} after");
  assert.equal(templated.includes("borrowed line"), false);
});

test("wikitext becomes prose a person could read aloud", () => {
  const clean = cleanWikitext(
    "Filming took place at [[Glencoe|Glencoe, Scotland]]<ref name=\"a\" /> and "
    + "[[Hashima Island]].{{rp|13}} [[File:Set.jpg|thumb|The set]] '''Bold''' text.",
  );
  assert.ok(clean.includes("Glencoe, Scotland"));
  assert.ok(clean.includes("Hashima Island"));
  assert.equal(/<ref|\{\{|\[\[|File:/.test(clean), false, "no markup may survive");
  assert.equal(clean.includes("Bold text"), true);
});

test("nested templates are stripped rather than half-stripped", () => {
  const clean = cleanWikitext("Shot in Rome {{efn|see {{harvnb|Smith|2001}} for detail}} in 1953.");
  assert.equal(/\{\{|\}\}/.test(clean), false);
  assert.ok(clean.includes("Rome"));
  assert.ok(clean.includes("1953"));
});

// --- quotes ----------------------------------------------------------------------

test("a stored quote is one short sentence, not a passage", () => {
  assert.equal(isStorableQuote("Filming took place at Hankley Common in Surrey."), true);
  assert.equal(isStorableQuote(`${"word ".repeat(MAX_QUOTE_WORDS + 5)}.`), false);
  assert.equal(isStorableQuote("One sentence. And then a second one."), false);
  assert.equal(isStorableQuote(""), false);
  assert.equal(isStorableQuote(null), false);
});

// --- attribution ------------------------------------------------------------------

test("attribution carries both halves the licence requires", () => {
  // Crediting the author and giving the licensing notice are SEPARATE obligations;
  // "Source: Wikipedia" plus a link satisfies only the first.
  const credit = wikipediaAttribution({ title: "Skyfall", revid: 123456 });
  assert.match(credit.notice, /Wikipedia \(en\), "Skyfall"/);
  assert.match(credit.notice, /CC BY-SA 4\.0/);
  assert.equal(credit.license_url, WIKIPEDIA_LICENSE.url);
  assert.match(credit.article_url, /en\.wikipedia\.org\/wiki\/Skyfall/);
});

test("the credit points at the edition the text was copied from", () => {
  // Once the extractor reads French and Japanese articles, an en.wikipedia link is not
  // a slightly wrong URL — it credits the wrong authors for the sentence we stored.
  const credit = wikipediaAttribution({ title: "Skyfall", revid: 123456, language: "fr" });
  assert.match(credit.article_url, /fr\.wikipedia\.org/);
  assert.match(credit.permalink, /fr\.wikipedia\.org/);
  assert.equal(credit.language, "fr");

  // An edition we have no section rules for falls back rather than building a URL for
  // a wiki we never read.
  assert.equal(wikipediaAttribution({ title: "X", revid: 1, language: "xx" }).language, "en");
});

test("the exact revision is pinned, which is what settles the licence version", () => {
  // A revision after 7 June 2023 is unambiguously 4.0; without oldid the credit
  // points at text that may since have changed entirely.
  assert.match(permalink("Lost in Translation (film)", 987654), /oldid=987654/);
  assert.match(permalink("Lost in Translation (film)", 987654), /title=Lost_in_Translation/);
  assert.equal(permalink("Skyfall", null), null);
});

test("a trimmed quote says so", () => {
  const credit = wikipediaAttribution({ title: "Skyfall", revid: 1, modified: true });
  assert.match(credit.notice, /\(modified\)/);
  assert.equal(credit.modified, true);
});

test("no title means no attribution, and therefore nothing to publish", () => {
  assert.equal(wikipediaAttribution({ title: null, revid: 1 }), null);
});

// --- a lagged replica is not a missing page -------------------------------------------

test("a temporary failure and a permanent one are told apart", () => {
  // Both arrive as HTTP 200 with an error body. Treating them alike abandoned a whole
  // enrichment run because a Wikimedia replica was eight seconds behind.
  assert.equal(isRetryableApiError({ error: { code: "maxlag", info: "Waiting for wdqs1013" } }), true);
  assert.equal(isRetryableApiError({ error: { code: "readonly" } }), true);
  assert.equal(isRetryableApiError({ error: { code: "ratelimited" } }), true);

  assert.equal(isRetryableApiError({ error: { code: "missingtitle" } }), false);
  assert.equal(isRetryableApiError({ error: { code: "invalidtitle" } }), false);
  assert.equal(isRetryableApiError({}), false);
  assert.equal(isRetryableApiError(null), false);
});

test("we ask for maxlag, so we must be able to honour the answer", () => {
  // Sending maxlag and then treating the reply as fatal is asking a question and
  // punishing the service for answering it.
  for (const url of [buildTocUrl("Skyfall"), buildSectionUrl("Skyfall", "8"), buildEntitiesUrl(["Q4941"])]) {
    assert.match(url, new RegExp(`maxlag=${MAX_DATABASE_LAG_SECONDS}`));
  }
  assert.equal(isRetryableApiError({ error: { code: "maxlag" } }), true);
});

test("the query service lagging is not this job's lag", () => {
  // Measured 20.09: wbgetentities refused with queryserviceLag 31,650 — nearly nine hours
  // — and the identical request without maxlag answered in full. Wikidata folds the SPARQL
  // service's lag into maxlag so that EDITS let it catch up; this run makes none, and the
  // entity JSON it reads does not come from there. Five retries are 30+60+90+120+150s, and
  // they would have been spent on the entity batch that precedes the first work.
  const queryService = {
    error: { code: "maxlag", info: "Waiting for wdqs1013: 527.5 seconds lagged.",
             host: "wdqs1013", lag: 527.5, type: "wikibase-queryservice", queryserviceLag: 31650 },
  };
  assert.equal(isQueryServiceLag(queryService), true);

  // Replication lag says the READ would be stale, and is still obeyed.
  assert.equal(isQueryServiceLag({ error: { code: "maxlag", info: "Waiting for db1183: 6.2 seconds lagged." } }), false);
  assert.equal(isQueryServiceLag({ error: { code: "readonly", type: "wikibase-queryservice" } }), false);
  assert.equal(isQueryServiceLag({}), false);
  assert.equal(isQueryServiceLag(null), false);

  // Both are retryable; what differs is whether the wait is the answer.
  assert.equal(isRetryableApiError(queryService), true);
});

test("asking again without maxlag happens once, never in a circle", () => {
  const asked = buildEntitiesUrl(["Q4941"]);
  const again = withoutMaxlag(asked);
  assert.ok(again && !again.includes("maxlag"));
  // Everything else about the request survives — it is the same question.
  assert.match(again, /action=wbgetentities/);
  assert.match(again, /ids=Q4941/);

  // The second call is the caller's stop sign: nothing left to drop.
  assert.equal(withoutMaxlag(again), null);
  assert.equal(withoutMaxlag("not a url"), null);
  assert.equal(withoutMaxlag(null), null);
});

test("the lag threshold reflects a read job, and still backs off from an incident", () => {
  // Five seconds is the value for a bot making EDITS, and measured live the routine lag
  // sits at 8 — so five turned this job away for a staleness that cannot affect it.
  // A real incident runs to minutes, which this still refuses.
  assert.ok(MAX_DATABASE_LAG_SECONDS > 8);
  assert.ok(MAX_DATABASE_LAG_SECONDS <= 60);
});

test("the wait comes from the response, not from a guess", () => {
  const withHeader = { headers: { get: (name) => (name === "retry-after" ? "12" : null) } };
  assert.equal(retryAfterMs(withHeader), 12_000);

  // No header, a nonsensical one, or none at all still yields a real delay rather than
  // a tight loop.
  assert.equal(retryAfterMs({ headers: { get: () => null } }), 5000);
  assert.equal(retryAfterMs({ headers: { get: () => "soon" } }), 5000);
  assert.equal(retryAfterMs(null, 60_000), 60_000);
});

test("retrying is bounded, so an indefinitely lagged service fails loudly", () => {
  assert.ok(MAX_RETRY_ATTEMPTS >= 3 && MAX_RETRY_ATTEMPTS <= 10);
});

// --- more than one edition, because they do not say the same things --------------------

test("each edition finds its own production heading", () => {
  const one = (line) => ({ sections: [{ index: "4", line, hLevel: 2 }] });

  assert.equal(chooseSection(one("Tournage"), "fr").index, "4");
  assert.equal(chooseSection(one("Localizaciones"), "es").index, "4");
  assert.equal(chooseSection(one("ロケーション"), "ja").index, "4");
  assert.equal(chooseSection(one("Работа над картиной"), "ru").index, "4");
  assert.equal(chooseSection(one("Dreharbeiten"), "de").index, "4");
  assert.equal(chooseSection(one("Zdjęcia"), "pl").index, "4");
});

test("the parent heading wins in every language, not just English", () => {
  // MediaWiki returns the whole subtree. Verified on Skyfall: French "Tournage",
  // Spanish "Localizaciones", Japanese "ロケーション" and Polish "Zdjęcia" are all
  // children of the production heading above them, so preferring the child throws
  // away the siblings that carry the location prose.
  const nested = (parent, child) => ({ sections: [
    { index: "3", line: parent, hLevel: 2 },
    { index: "5", line: child, hLevel: 3 },
  ] });

  assert.equal(chooseSection(nested("Production", "Tournage"), "fr").index, "3");
  assert.equal(chooseSection(nested("Producción", "Localizaciones"), "es").index, "3");
  assert.equal(chooseSection(nested("製作", "ロケーション"), "ja").index, "3");
  assert.equal(chooseSection(nested("Produkcja", "Zdjęcia"), "pl").index, "3");
});

test("a heading about where the STORY happens is not one about where it was shot", () => {
  // French Skyfall carries "Lieux de l'action" — 105 characters about the plot's
  // settings — above the "Tournage" section that describes the shoot. Ranking them
  // together picked the wrong one, and this project is built on that distinction.
  const both = { sections: [
    { index: "3", line: "Lieux de l'action", hLevel: 2 },
    { index: "7", line: "Tournage", hLevel: 2 },
  ] };
  assert.equal(chooseSection(both, "fr").index, "7");
});

test("a section list is never applied to the wrong language", () => {
  // "Production" is an English heading; matching it inside a Russian article would
  // pick whatever happened to contain the substring.
  assert.equal(chooseSection({ sections: [{ index: "4", line: "Production", hLevel: 2 }] }, "ru"), null);
  assert.equal(chooseSection({ sections: [{ index: "4", line: "Tournage", hLevel: 2 }] }, "xx"), null);
});

test("only editions we can actually read are requested", () => {
  const url = buildEntitiesUrl(["Q4941"]);
  assert.match(url, /sitefilter=enwiki/);
  assert.match(url, /frwiki/);
  assert.equal(buildTocUrl("Skyfall", "xx"), null);
  assert.equal(buildSectionUrl("Skyfall", "4", "xx"), null);
  assert.match(buildTocUrl("Skyfall", "ja"), /ja\.wikipedia\.org/);
});

test("English leads, the work's own language follows, and the list is bounded", () => {
  // English is the best-covered edition, so a work whose home edition is a stub must
  // not lose it to the cap.
  const entity = { sitelinks: {
    enwiki: { title: "Skyfall" }, frwiki: { title: "Skyfall" },
    dewiki: { title: "Skyfall" }, jawiki: { title: "007 スカイフォール" },
  } };

  assert.deepEqual(languagesForWork(entity, { preferred: "ja", limit: 3 }), ["en", "ja", "fr"]);
  assert.deepEqual(languagesForWork(entity, { limit: 1 }), ["en"]);
  assert.deepEqual(languagesForWork({ sitelinks: { frwiki: { title: "Skyfall" } } }), ["fr"]);
  assert.deepEqual(languagesForWork({ sitelinks: {} }), []);
});

test("a prefix reverses the meaning, so an exact heading wins over a containing one", () => {
  // "vorproduktion".includes("produktion") is true, and a plain substring test duly
  // picked the German PRE-production section over the article's real
  // "Entstehungsgeschichte". The same trap waits in "Nachproduktion" and
  // "Postprodukcja".
  const german = { sections: [
    { index: "2", line: "Entstehungsgeschichte", hLevel: 2 },
    { index: "3", line: "Vorproduktion", hLevel: 2 },
    { index: "6", line: "Nachproduktion und Marketing", hLevel: 2 },
  ] };
  assert.equal(chooseSection(german, "de").index, "2");

  // With no exact match anywhere, a containing heading is still better than nothing.
  assert.equal(chooseSection({ sections: [{ index: "3", line: "Vorproduktion", hLevel: 2 }] }, "de").index, "3");
});


// --- the edition in the work's own language --------------------------------------------

const claim = (id) => ({ mainsnak: { datavalue: { value: { id } } } });
const FOUR_EDITIONS = { enwiki: { title: "X" }, dewiki: { title: "X" }, ruwiki: { title: "X" }, frwiki: { title: "X" } };

test("the work's own language is read from P364, and there can be several", () => {
  // Verified against the live API 12.09: Der Untergang carries Q188, Q7737 and Q9067 —
  // German, Russian and Hungarian. Hungarian is not an edition we read and drops out.
  const entity = { sitelinks: FOUR_EDITIONS, claims: { P364: [claim("Q188"), claim("Q7737"), claim("Q9067")] } };
  assert.deepEqual(preferredLanguages(entity), ["de", "ru"]);
  // English still leads — it is the best-covered edition — then the work's own, in the
  // order the work states them rather than the order SUPPORTED_LANGUAGES happens to list.
  assert.deepEqual(languagesForWork(entity, { limit: 3 }), ["en", "de", "ru"]);
});

test("country of origin is the fallback when there is no P364", () => {
  const entity = { sitelinks: FOUR_EDITIONS, claims: { P495: [claim("Q142")] } };
  assert.deepEqual(preferredLanguages(entity), ["fr"]);
  assert.deepEqual(languagesForWork(entity, { limit: 2 }), ["en", "fr"]);
});

test("a multilingual country is left alone rather than guessed at", () => {
  // Switzerland and Belgium say nothing about which edition to read, and both are real
  // cases in a film catalogue. An empty answer is correct, not a gap.
  for (const country of ["Q39", "Q31"]) {
    assert.deepEqual(preferredLanguages({ claims: { P495: [claim(country)] } }), []);
  }
});

test("no signal at all is an ordinary answer", () => {
  assert.deepEqual(preferredLanguages({ claims: {} }), []);
  assert.deepEqual(preferredLanguages({}), []);
  // and the order is then whatever is available, English first.
  assert.deepEqual(languagesForWork({ sitelinks: FOUR_EDITIONS, claims: {} }, { limit: 2 }), ["en", "fr"]);
});

test("an explicit preferred still wins, and a bare string still works", () => {
  const entity = { sitelinks: FOUR_EDITIONS, claims: { P364: [claim("Q188")] } };
  assert.deepEqual(languagesForWork(entity, { preferred: "ru", limit: 2 }), ["en", "ru"]);
});

test("the entities request asks for the claims those properties live in", () => {
  // Without claims in props, preferredLanguages has nothing to read and the whole thing is
  // silently inert — which is exactly how the dead `preferred` argument survived this long.
  const url = buildEntitiesUrl(["Q1"]);
  assert.match(decodeURIComponent(url), /props=sitelinks\/urls\|claims/);
});


// --- a book is not made on a set -------------------------------------------------------

test("a book article is read from the section a book actually has", () => {
  // Measured 12.09 across the nine books in the catalogue: Crime and Punishment leads with
  // "Background", Finnegans Wake with "Background and composition", The Lord of the Rings
  // carries "Concept and creation". None appear in the film table, so before this every
  // book resolved to "no production section" and all nine were unreachable.
  const toc = { sections: [
    { line: "Background", index: "1" },
    { line: "Plot", index: "2" },
    { line: "Production", index: "3" },
  ] };
  assert.equal(chooseSection(toc, "en", { kind: "book" }).line, "Background");
  // The same article read as a film picks the film section, so the two tables cannot
  // shadow each other.
  assert.equal(chooseSection(toc, "en", { kind: "film" }).line, "Production");
});

test("the most specific book section wins over the vaguest", () => {
  const toc = { sections: [
    { line: "Background", index: "1" },
    { line: "Concept and creation", index: "2" },
  ] };
  // "Background" is real but thin; "Concept and creation" is where the writing is described.
  assert.equal(chooseSection(toc, "en", { kind: "book" }).line, "Concept and creation");
});

test("a book with no composition section is an ordinary answer", () => {
  // Mrs Dalloway and Roughing It genuinely have none.
  const toc = { sections: [{ line: "Plot summary", index: "1" }, { line: "Themes", index: "2" }] };
  assert.equal(chooseSection(toc, "en", { kind: "book" }), null);
});

test("every edition we read has a book vocabulary too", () => {
  // A language present for films and absent for books would silently skip every book in
  // that edition.
  for (const language of SUPPORTED_LANGUAGES) {
    assert.ok(sectionRankFor(language, "book")?.length, `${language} has no book sections`);
    assert.ok(sectionRankFor(language, "film")?.length, `${language} has no film sections`);
  }
  assert.equal(sectionRankFor("xx", "book"), null);
});

test("a series is read like a film, not like a book", () => {
  const toc = { sections: [{ line: "Background", index: "1" }, { line: "Filming", index: "2" }] };
  assert.equal(chooseSection(toc, "en", { kind: "series" }).line, "Filming");
});


test("above the API's batch ceiling the builder refuses, and says so by its type", () => {
  // A caller asking for more than the endpoint allows gets null, not a URL that would be
  // rejected on arrival. The caller has to chunk — and the run that first asked for 200
  // works discovered this as "Failed to parse URL from null", which names neither the
  // limit nor the caller. It had never appeared because the default limit is five.
  const many = Array.from({ length: MAX_ENTITIES_PER_REQUEST + 1 }, (_, i) => `Q${i + 1}`);
  assert.equal(buildEntitiesUrl(many), null);
  assert.ok(buildEntitiesUrl(many.slice(0, MAX_ENTITIES_PER_REQUEST)));
  assert.equal(buildEntitiesUrl([]), null);
  assert.equal(MAX_ENTITIES_PER_REQUEST, 50);
});

test("Hebrew: an Israeli work reads its Hebrew article, and the production heading is found", () => {
  // Shtisel, as read 07.11.2026: the location prose sits under "יצירת הסדרה".
  const entity = {
    sitelinks: { enwiki: { title: "Shtisel" }, hewiki: { title: "שטיסל" } },
    claims: { P364: [{ mainsnak: { datavalue: { value: { id: "Q9288" } } } }] },
  };
  assert.deepEqual(preferredLanguages(entity), ["he"]);
  assert.deepEqual(languagesForWork(entity), ["en", "he"]);
  const toc = { sections: [
    { line: "עלילה", index: "1", hLevel: 2 },
    { line: "יצירת הסדרה", index: "2", hLevel: 2 },
    { line: "אתרי צילום", index: "3", hLevel: 3 },
  ] };
  assert.equal(chooseSection(toc, "he").line, "יצירת הסדרה");
  // Beaufort has only "רקע", and that is still read.
  assert.equal(chooseSection({ sections: [{ line: "רקע", index: "1" }] }, "he").line, "רקע");
});
