"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

// One box, two kinds of answer, two latencies — and the whole design of this component
// is the refusal to average them (#145).
//
// `/api/search` is one indexed query against our own database. `/api/cities/suggest` is
// Wikidata over the network. Awaiting them together would make the fast half as slow as
// the slow one on every keystroke, so they are two independent requests with two
// debounces, and each group paints when it has rows. Films are listed FIRST for the same
// reason: a group that arrives late must grow the list downward, never push the row the
// cursor is on.
const WORK_DEBOUNCE_MS = 140;
// A gazetteer over the network deserves a longer pause than an index lookup: a pause
// this long turns a typed word into one query instead of six.
const CITY_DEBOUNCE_MS = 320;
const CITY_MIN_LENGTH = 2;

// A dropdown source. Returns what it last successfully answered for a query it was
// actually asked about — never a stale answer to an older one.
function useSuggestions({ value, endpoint, debounceMs, minLength, read }) {
  const [state, setState] = useState({ rows: [], status: "idle", unavailable: false, held: null });
  const controllerRef = useRef(null);
  const serialRef = useRef(0);

  const load = useCallback(async (query) => {
    controllerRef.current?.abort();
    // A request that outlives its keystroke must never be able to answer. Aborting is
    // most of that; the serial is the rest, because an abort and a resolve can race and
    // the loser still calls setState.
    const serial = serialRef.current + 1;
    serialRef.current = serial;

    if (query.trim().length < minLength) {
      setState({ rows: [], status: "idle", unavailable: false, held: null });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const response = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${endpoint} responded ${response.status}`);
      const body = await response.json();
      if (serial !== serialRef.current) return;
      setState({
        rows: read(body),
        status: "ready",
        unavailable: Boolean(body.unavailable),
        // Only the catalogue says this; the gazetteer never does, and null means "not asked".
        held: typeof body.held === "boolean" ? body.held : null,
      });
    } catch (error) {
      if (error?.name === "AbortError") return; // superseded by a later keystroke
      if (serial !== serialRef.current) return;
      setState({ rows: [], status: "ready", unavailable: true, held: null });
    }
  }, [endpoint, minLength, read]);

  useEffect(() => {
    const timer = setTimeout(() => load(value), debounceMs);
    return () => clearTimeout(timer);
  }, [value, load, debounceMs]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return state;
}

const readWorks = (body) => (Array.isArray(body.suggestions) ? body.suggestions : []);
const readCities = (body) => (Array.isArray(body.suggestions) ? body.suggestions : []);

// Split a name around the matched characters so the typed part can be emphasised —
// the thing that makes an IMDb-style dropdown feel like it is answering *you*.
function NameWithMatch({ name, match }) {
  if (!match) return <>{name}</>;
  return (
    <>
      {name.slice(0, match.start)}
      <mark>{name.slice(match.start, match.end)}</mark>
      {name.slice(match.end)}
    </>
  );
}

function cityDetail(city) {
  if (city.description) return city.description;
  if (Number.isFinite(city.population)) {
    return `${new Intl.NumberFormat("en").format(city.population)} people`;
  }
  return "Place";
}

export default function SearchBox({
  value,
  onChange,
  onPickWork,
  onPickCity,
  onLookupPlace,
  onSubmit,
  // The text field, for a caller that opens the box from elsewhere (the phone's search on
  // the map, UX-3) and must focus it inside the same tap.
  inputRef = null,
  children,
}) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(null);
  const boxRef = useRef(null);
  const listId = useId();
  // The live lookup is a SUBMIT, and its button lives in the dropdown rather than inside the
  // <form>, so it names the form it submits.
  const formId = `${listId}-form`;

  const works = useSuggestions({
    value,
    endpoint: "/api/search",
    debounceMs: WORK_DEBOUNCE_MS,
    minLength: 1,
    read: readWorks,
  });
  const cities = useSuggestions({
    value,
    endpoint: "/api/cities/suggest",
    debounceMs: CITY_DEBOUNCE_MS,
    minLength: CITY_MIN_LENGTH,
    read: readCities,
  });

  const query = value.trim();
  // Wikidata knows about most places and not all of them, and it can be down. Either
  // way there is still one thing left to try, and it is the search that existed before
  // this box did: one Nominatim lookup, asked for deliberately rather than on every
  // keystroke, which is the only way that service may be used at all.
  const offerLookup = query.length >= CITY_MIN_LENGTH
    && cities.status === "ready"
    && (cities.unavailable || cities.rows.length === 0);

  const options = useMemo(() => [
    ...works.rows.map((row) => ({ kind: "work", key: `work:${row.work_id}`, row })),
    ...cities.rows.map((row) => ({ kind: "city", key: `city:${row.wikidata_id}`, row })),
    ...(offerLookup ? [{ kind: "lookup", key: "lookup", row: null }] : []),
  ], [works.rows, cities.rows, offerLookup]);

  // The cursor is held by KEY, not by index. The two groups arrive independently, and an
  // index would silently point at a different row the moment the slower one landed.
  const activeIndex = options.findIndex((option) => option.key === activeKey);
  // The groups are rendered where they belong on screen, so each row needs to know its
  // position in the ONE list the keyboard walks.
  const indexOfKey = useMemo(
    () => new Map(options.map((option, index) => [option.key, index])),
    [options],
  );

  useEffect(() => {
    if (activeKey && activeIndex === -1) setActiveKey(null);
  }, [activeKey, activeIndex]);

  // A dropdown that survives a click elsewhere is a dropdown in the way.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, [open]);

  const choose = useCallback((option) => {
    setOpen(false);
    setActiveKey(null);
    if (option.kind === "work") onPickWork?.(option.row);
    else if (option.kind === "city") onPickCity?.(option.row);
    else onLookupPlace?.(query);
  }, [onPickWork, onPickCity, onLookupPlace, query]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveKey(null);
      return;
    }
    if (!open || options.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); // otherwise the caret jumps inside the input
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = activeIndex === -1
        ? (step === 1 ? 0 : options.length - 1)
        : (activeIndex + step + options.length) % options.length;
      setActiveKey(options[next].key);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault(); // pick the highlighted row instead of submitting
      choose(options[activeIndex]);
    }
  }

  const showList = open && query.length > 0
    && (options.length > 0 || works.status !== "idle" || cities.status !== "idle");

  const optionProps = (option) => {
    const index = indexOfKey.get(option.key) ?? -1;
    return {
      "aria-selected": index === activeIndex,
      className: `search-suggestion${index === activeIndex ? " is-active" : ""}`,
      id: `${listId}-${index}`,
      key: option.key,
      onMouseEnter: () => setActiveKey(option.key),
      role: "option",
    };
  };

  return (
    <div className="work-search-box" ref={boxRef}>
      <form
        className="work-search"
        id={formId}
        onSubmit={(event) => {
          setOpen(false);
          onSubmit?.(event);
        }}
        role="search"
      >
        {children}
        <input
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={showList ? listId : undefined}
          aria-expanded={showList}
          aria-label="A film, series or book title, or a city"
          autoComplete="off"
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Film, series, book or city"
          ref={inputRef}
          role="combobox"
          type="text"
          value={value}
        />
      </form>

      {showList && (
        <ul className="search-suggestions" id={listId} role="listbox">
          <li className="search-group" role="presentation">Films, series and books</li>
          {/* **Rows are not the same as having it.** Asked for "Spirited Away" on 21.09,
              the catalogue answered with seven neighbouring spellings — The Sacred Spirit,
              Cast Away, Suspiria — and because there were seven rows the box never said
              what was true: we do not hold the film, and the live lookup on submit finds
              it and puts it in Japan. A juror typing their favourite film is the whole
              acceptance test, and this was the screen they would have seen. So when no row
              is called what was typed, that is said FIRST, above the look-alikes, with a
              button — "press Enter" is no instruction at all on a phone. */}
          {works.status === "ready" && works.held === false && works.rows.length > 0 && (
            <li className="search-note" role="presentation">
              {`Nothing in our catalogue is called “${query}” — these only look alike.`}
              <button className="search-note-action" form={formId} type="submit">
                {`Look “${query}” up on Wikidata`}
              </button>
            </li>
          )}
          {options.filter((option) => option.kind === "work").map((option) => (
            <li {...optionProps(option)}>
              <button onClick={() => choose(option)} type="button">
                {option.row.poster_thumb_url ? (
                  <img alt="" loading="lazy" src={option.row.poster_thumb_url} />
                ) : (
                  <span className="suggestion-poster-empty" aria-hidden="true" />
                )}
                <span className="suggestion-text">
                  <span className="suggestion-title">
                    <NameWithMatch name={option.row.title} match={option.row.match} />
                  </span>
                  <small>
                    {option.row.kind_label}
                    {option.row.year ? ` · ${option.row.year}` : ""}
                    {option.row.place_count > 0 ? ` · ${option.row.place_count} places` : ""}
                  </small>
                </span>
              </button>
              {/* Picking a film shows it on the map, because that is what the box is
                  attached to and the map is the answer somebody typing a title wants.
                  The card is the other surface and gets its own way in — a real link, so
                  it can be opened in a tab, copied or sent. */}
              {option.row.path && (
                <Link
                  aria-label={`Open the card for ${option.row.title}`}
                  className="suggestion-card-link"
                  href={option.row.path}
                  onClick={() => setOpen(false)}
                  tabIndex={-1}
                >
                  Card
                </Link>
              )}
            </li>
          ))}
          {works.status === "loading" && works.rows.length === 0 && (
            <li className="search-note" role="presentation">Searching our catalogue…</li>
          )}
          {works.status === "ready" && works.rows.length === 0 && (
            <li className="search-note" role="presentation">
              {works.unavailable
                ? "Our catalogue did not answer."
                : `Nothing in our catalogue is called “${query}”.`}
              <button className="search-note-action" form={formId} type="submit">
                {`Look “${query}” up on Wikidata`}
              </button>
            </li>
          )}

          <li className="search-group" role="presentation">Cities and places</li>
          {options.filter((option) => option.kind === "city").map((option) => (
            <li {...optionProps(option)}>
              <button onClick={() => choose(option)} type="button">
                <span className="suggestion-poster-empty is-place" aria-hidden="true" />
                <span className="suggestion-text">
                  <span className="suggestion-title">
                    <NameWithMatch name={option.row.name} match={option.row.match} />
                  </span>
                  <small>{cityDetail(option.row)}</small>
                </span>
              </button>
            </li>
          ))}
          {cities.status === "loading" && cities.rows.length === 0 && (
            <li className="search-note" role="presentation">Looking up places…</li>
          )}
          {query.length < CITY_MIN_LENGTH && (
            <li className="search-note" role="presentation">Type one more character to search places.</li>
          )}
          {offerLookup && (
            <>
              <li className="search-note" role="presentation">
                {cities.unavailable
                  ? "The place gazetteer did not answer."
                  : `No place on Wikidata is called “${query}”.`}
              </li>
              {options.filter((option) => option.kind === "lookup").map((option) => (
                <li {...optionProps(option)}>
                  <button onClick={() => choose(option)} type="button">
                    <span className="suggestion-poster-empty is-place" aria-hidden="true" />
                    <span className="suggestion-text">
                      <span className="suggestion-title">Look “{query}” up as a place</span>
                      <small>Searches OpenStreetMap once</small>
                    </span>
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
