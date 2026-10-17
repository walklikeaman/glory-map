"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  Check,
  CheckCircle2,
  Heart,
  BookOpen,
  Clapperboard,
  Copy,
  Cloud,
  Clock3,
  Download,
  History,
  Crosshair,
  DoorOpen,
  ExternalLink,
  Film,
  Info,
  Link2,
  LoaderCircle,
  LocateFixed,
  LogOut,
  MapPin,
  Maximize2,
  Minus,
  Plus,
  Route,
  Search,
  Sparkles,
  Star,
  Trash2,
  Tv,
  User,
  X,
  Layers,
  List,
  LogIn,
  Mail,
  Share2,
} from "lucide-react";
import {
  DEMO_LOCATION,
  RADIUS_OPTIONS_METERS,
  findNearby,
  formatDistanceMeters,
  mapSearchRadiusKm,
  zoomForRadius,
} from "../lib/nearby.mjs";
import StoryTrail from "./StoryTrail.jsx";
import { AppNav, SectionSheet } from "./AppSections.jsx";
import Onboarding from "./Onboarding.jsx";
import {
  decide, emptyOnboarding, libraryFromDecisions, loadOnboarding, saveOnboarding, shouldOfferOnboarding, undoLast,
} from "../lib/onboarding.mjs";
import { loadSuggestions, saveSuggestions } from "../lib/suggestions.mjs";
import WalkControls from "./WalkControls.jsx";
import {
  DEFAULT_PLACE_TAB,
  PLACE_TABS,
  coordinateToCopy,
  countInView,
  filterInView,
  routeTabState,
  tabForLocation,
  viewCountLabel,
} from "../lib/place-card.mjs";
import WorkProfile from "./WorkProfile.jsx";
import { isWalkableStop, trailStops } from "../lib/story-trail.mjs";
import { onFootNote, orderTrail, TRAIL_ORDER, trailOrderNote, walkRuns } from "../lib/trail-order.mjs";
import { trailFileName, trailGeoJson, trailOrderFromParams, trailShareUrl } from "../lib/trail-share.mjs";
import { googleMapsDirectionsUrl, gpxFileName, routeGpx } from "../lib/route-export.mjs";
import { scrubIndex, scrubLabel, scrubStops } from "../lib/trail-scrubber.mjs";
import {
  achievementsOf, checkIn, checkInMessage, demoCheckIn, distanceFromYou, emptyMarks, gloryOf, isWanted, loadMarks,
  progressOf, saveMarks, toggleWant, visitOf,
} from "../lib/place-marks.mjs";
import { defaultChapter, trailChapters } from "../lib/trail-chapters.mjs";
import { ALL_CITIES } from "../lib/city-gazetteer.mjs";
import { normalizePlaceName } from "../lib/place-dedup.mjs";
import { parseLetterboxdArchive } from "../lib/letterboxd-archive.mjs";
import { libraryImportSummary, libraryNoun, matchLibrary } from "../lib/library-match.mjs";
import { emailLinkMessage, signInEmail } from "../lib/email-sign-in.mjs";
import {
  DEFAULT_LAYER_ID, MAP_LAYERS, layerById, mapLayers, readStoredLayerId, writeStoredLayerId,
} from "../lib/map-layers.mjs";
import { activeLayerLabel, zoomAffordance } from "../lib/map-controls.mjs";
import { externalPlaceLinks } from "../lib/place-links.mjs";
import { loadCloudLibrary, saveCloudLibrary } from "../lib/cloud-library.mjs";
import { createCoalescingRunner } from "../lib/coalesce.mjs";
import { WALKING_SPEED_KMH, haversineKm, isLatLng } from "../lib/geo.mjs";
import { libraryEntryFor, libraryRating, mergeLibraries, parseMediaCsv, upgradeLibraryScale, workIsInLibrary } from "../lib/media-library.mjs";
import { MEDIA_SOURCES, mediaSource, mediaSourceLabel } from "../lib/media-sources.mjs";
import { citySlugFromName, mapUrlQuery, readMapUrl } from "../lib/map-url.mjs";
import { workPath } from "../lib/work-url.mjs";
import { commonsSrcSetForSurface, sizesForSurface } from "../lib/image-budget.mjs";
import {
  DEFAULT_VIEW_MODE,
  VIEW_MODES,
  filmsInView,
  filmsInViewLabel,
} from "../lib/films-in-view.mjs";
import {
  FILTER_DEFAULTS, clearedFilter, filterChipLabel, filtersFromParams,
  narrowingFilters, writeFilterParams,
} from "../lib/filter-url.mjs";
import {
  EMPTY_REASON, labelledPlaces, notableEmptyReason, notableHere, ratingOf,
} from "../lib/notable-here.mjs";
import {
  DEFAULT_SORT,
  IMDB_MAX,
  IMDB_MIN,
  IMDB_STEP,
  NO_MINIMUM,
  SORT,
  MINE_MAX,
  MINE_MIN,
  MINE_STEP,
  clampImdb,
  clampMine,
  imdbLabel,
  impliesLibraryOnly,
  passesImdbFilter,
  passesLibraryFilter,
  ratingLabel,
  sortWorks,
} from "../lib/library-view.mjs";
import { describedFilms } from "../lib/place-note.mjs";
import { keepTheWalk } from "../lib/keep-the-walk.mjs";
import { corridorSizeLabel } from "../lib/tile-corridor.mjs";
import { clearWalk, freezeWalk, loadWalk, saveWalk, walkAgeLabel } from "../lib/walk-store.mjs";
import { getSupabaseBrowserClient } from "../lib/supabase-browser.mjs";
import { EVERY_KIND, workKindLabel } from "../lib/location-search.mjs";
import { filmLocationImageKey } from "../lib/tmdb-images.mjs";
import {
  TOUR_BUDGETS,
  createTimedTourCandidates,
  fetchTimedTourGuide,
  pickRouteThatFitsBudget,
} from "../lib/timed-tour.mjs";
import { ACCESS, accessNote, isRoutable, MAX_PLACES_PER_QUERY } from "../lib/place-access.mjs";
import VoiceGuide from "./VoiceGuide";
import GraphLayer from "./GraphLayer";
import MapCanvas from "./map/MapCanvas.jsx";
import {
  AreaLayer, ExposeMap, FitPositions, FlyTo, MapMarker, PanTo, PinLayer, RouteLine,
} from "./map/layers.jsx";
import SearchBox from "./SearchBox";
import { ImageAttribution } from "./ImageAttribution";
import { normalizeAttribution, requiredNotices } from "../lib/attribution.mjs";
import { PIN_LEGEND, pinHtml, pinSize } from "../lib/map-pin.mjs";

// The ground under the vector style while it loads, and the map itself if WebGL fails.
// OSM's own raster, dimmed by CSS rather than inverted — it is a stand-in for a second or
// two, not a theme.
const VECTOR_FALLBACK_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
import { RATING_LABELS } from "../lib/work-ratings.mjs";

// A new `() => {}` every render is a changed prop, and a changed prop re-renders the whole
// marker layer — which is the work this whole component is trying not to do. Clicking a pin
// deliberately does nothing here: the popup opens and the map does not move, because sliding
// the map out from under the cursor is the behaviour that was complained about.
const NOTHING_ON_SELECT = () => {};

// The films in this view, as its own memoised component — for the same reason GraphLayer is
// memoised, and with the same measurement behind it.
//
// This list renders up to 60 poster cards or 120 rows, and it sat inline in a component that
// re-renders on every piece of state it holds. Opening a menu rebuilt all of it. With the
// marker layer already memoised, one click still blocked the main thread for ~98 ms with
// 1,008 pins drawn against ~45 ms with 10 — and this list is what still scaled with the pins,
// because the pin count and the film count move together.
const EMPTY_FILMS = Object.freeze([]);

// How many posters show before "Show all". The grid used to be a 300 px box with its own
// scrollbar inside the scrolling panel, holding up to 60 posters — 2,363 px of content in a
// 300 px window with no visible edge, so a reader scrolling the panel hit a region that
// scrolled something else. It grows in place now, and the panel is the only scroller.
const POSTERS_FIRST = 12;
const ROWS_FIRST = 20;

const FilmsInView = memo(function FilmsInView({ films, mode, onMode, onHighlight }) {
  const [expanded, setExpanded] = useState(false);
  if (!films.length) return null;

  const cap = mode === VIEW_MODES.posters ? 60 : 120;
  const first = mode === VIEW_MODES.posters ? POSTERS_FIRST : ROWS_FIRST;
  const shown = expanded ? cap : Math.min(first, cap);
  const total = Math.min(films.length, cap);

  return (
    <div className="films-here">
      <div className="films-here-head">
        <strong>{filmsInViewLabel(films)}</strong>
        {/* Posters for browsing, titles for finding one. Different tasks, not a matter of
            taste, so both are offered rather than one chosen. */}
        <div className="films-here-modes" role="group" aria-label="How to show the films in view">
          {[[VIEW_MODES.posters, "Posters"], [VIEW_MODES.list, "List"]].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={mode === value ? "is-on" : ""}
              aria-pressed={mode === value}
              onClick={() => onMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === VIEW_MODES.posters ? (
        <div className="films-here-grid">
          {films.slice(0, shown).map((film) => (
            <a
              key={film.work_id ?? film.title}
              className={`films-here-card${film.on_a_lot_only ? " is-lot" : ""}`}
              // Hovering a row lights its places on the map, and leaving it puts them back.
              // Borrowed from how Airbnb, Booking and Zillow all tie a list to a map: the
              // two are one set seen twice, and without the tie the reader has to find the
              // pin by eye among a thousand identical ones.
              onMouseEnter={() => onHighlight?.(film)}
              onMouseLeave={() => onHighlight?.(null)}
              onFocus={() => onHighlight?.(film)}
              onBlur={() => onHighlight?.(null)}
              href={film.work_id ? workPath({ id: film.work_id, title: film.title }) : undefined}
              title={`${film.title} — ${film.place_count} place${film.place_count === 1 ? "" : "s"} in view`}
            >
              <span className="films-here-thumb" aria-hidden="true">
                {String(film.title ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <span className="films-here-title">{film.title}</span>
              <span className="films-here-count">{film.place_count}</span>
            </a>
          ))}
          {total > shown && (
            <button type="button" className="films-here-more" onClick={() => setExpanded(true)}>
              Show all {total}
            </button>
          )}
        </div>
      ) : (
        <ul className="films-here-list">
          {films.slice(0, shown).map((film) => (
            <li
              key={film.work_id ?? film.title}
              onMouseEnter={() => onHighlight?.(film)}
              onMouseLeave={() => onHighlight?.(null)}
            >
              {film.work_id
                ? <a href={workPath({ id: film.work_id, title: film.title })}>{film.title}</a>
                : film.title}
              {film.year ? <span className="films-here-year"> {film.year}</span> : null}
              <span className="films-here-count">{film.place_count}</span>
              {/* A film seen only on a backlot is a different answer from one seen on the
                  street, and it is said before anybody walks. */}
              {film.on_a_lot_only && <span className="films-here-lot">studio lot</span>}
            </li>
          ))}
          {total > shown && (
            <li className="films-here-more-row">
              <button type="button" className="films-here-more" onClick={() => setExpanded(true)}>
                Show all {total}
              </button>
            </li>
          )}
        </ul>
      )}

      {films.length > cap && (
        <p className="graph-note">
          Showing {cap} of {films.length} — zoom in to narrow the view.
        </p>
      )}
    </div>
  );
});



const londonCenter = [51.5094, -0.1183];
const GUEST_LIBRARY_KEY = "scenemap-library";

// Read, and put on the ten-point scale on the way out. A library saved before the scale
// was settled holds Letterboxd half-stars, and a 4.5 read against a bar that now means
// "4.5 out of ten" would quietly demote the reader's favourite films to below-average.
// `upgradeLibraryScale` is keyed on a marker rather than on the value, so this is safe on
// every read rather than only the first ([[personal-library]]).
function readStoredLibrary(key) {
  if (typeof window === "undefined") return [];
  try {
    const storedLibrary = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(storedLibrary) ? upgradeLibraryScale(storedLibrary) : [];
  } catch {
    return [];
  }
}

const kindLabels = {
  film: "Film",
  series: "Series",
  book: "Book",
};

// The opening set, shown before /api/locations answers. Their TMDB ids are part of the
// data for the same reason the titles are: without one a chip CANNOT have a poster, so
// these five sat on their initials for the whole ~5 s the locations request took, and
// only then did artwork appear. With the id here the poster request goes out on first
// paint, in parallel — and four of the five are in our own works table, so it is a
// single fast query rather than a TMDB round-trip.
//
// Ids verified against Wikidata (P4947), not memory. Note Sherlock Holmes is the 2009
// film (10528), not the series (19885) we hold under a similar name.
const fallbackFilms = [
  {
    id: "notting-hill",
    title: "Notting Hill",
    year: 1999,
    code: "NH",
    tmdbId: "509",
  },
  {
    id: "skyfall",
    title: "Skyfall",
    year: 2012,
    code: "007",
    tmdbId: "37724",
  },
  {
    id: "harry-potter",
    title: "Harry Potter",
    year: 2001,
    code: "HP",
    tmdbId: "671",
  },
  {
    id: "sherlock",
    title: "Sherlock Holmes",
    year: 2009,
    code: "SH",
    tmdbId: "10528",
  },
  {
    id: "love-actually",
    title: "Love Actually",
    year: 2003,
    code: "LA",
    tmdbId: "508",
  },
].map((work) => ({ ...work, kind: "film" }));

const fallbackLocations = [
  {
    id: "portobello-road",
    filmId: "notting-hill",
    film: "Notting Hill",
    scene: "Portobello morning walk",
    place: "Portobello Road Market",
    description: "William walks through the changing seasons of Notting Hill, turning a street market into the film's emotional timeline.",
    position: [51.5156, -0.2057],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1555085634-25c3c9c10b6b?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "blue-door",
    filmId: "notting-hill",
    film: "Notting Hill",
    scene: "The blue door",
    place: "Westbourne Park Road",
    description: "The private home behind the blue door anchors the romance in a real London neighborhood.",
    position: [51.5174, -0.1993],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1578269174936-2709b6aeb913?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "mi6",
    filmId: "skyfall",
    film: "Skyfall",
    scene: "MI6 on the Thames",
    place: "Vauxhall Cross",
    description: "Bond's world is framed by the real MI6 headquarters on the river, one of modern spy cinema's clearest London signals.",
    position: [51.4874, -0.1247],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1529655683826-aba9b3e77383?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "national-gallery",
    filmId: "skyfall",
    film: "Skyfall",
    scene: "Q meets Bond",
    place: "National Gallery",
    description: "Bond and Q meet in front of Turner's painting, setting the old-versus-new theme in a public landmark.",
    position: [51.5089, -0.1283],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "kings-cross",
    filmId: "harry-potter",
    film: "Harry Potter",
    scene: "Platform 9 3/4",
    place: "King's Cross Station",
    description: "The gateway to Hogwarts turns a busy railway station into a pilgrimage point for fans.",
    position: [51.532, -0.1233],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1590253230532-a67f6bc61c9e?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "leadenhall",
    filmId: "harry-potter",
    film: "Harry Potter",
    scene: "Entrance to Diagon Alley",
    place: "Leadenhall Market",
    description: "Victorian arches stand in for the magical shopping street hidden inside ordinary London.",
    position: [51.5126, -0.0834],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1486299267070-83823f5448dd?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "st-pauls",
    filmId: "sherlock",
    film: "Sherlock Holmes",
    scene: "Old London pursuit",
    place: "St Paul's Cathedral",
    description: "The cathedral and surrounding streets sell the film's smoky, industrial version of London.",
    position: [51.5138, -0.0984],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1520986606214-8b456906c813?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "parliament",
    filmId: "sherlock",
    film: "Sherlock Holmes",
    scene: "Westminster stakes",
    place: "Houses of Parliament",
    description: "The detective story borrows Westminster's silhouette to make the conspiracy feel national.",
    position: [51.4995, -0.1248],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1496307653780-42ee777d4833?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "south-bank",
    filmId: "love-actually",
    film: "Love Actually",
    scene: "Riverside London",
    place: "South Bank",
    description: "The ensemble romance uses the Thames walk to make separate lives feel connected by the same city.",
    position: [51.5066, -0.1162],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1505761671935-60b3a7427bad?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "somerset-house",
    filmId: "love-actually",
    film: "Love Actually",
    scene: "Christmas London",
    place: "Somerset House",
    description: "A classic central London courtyard gives the film its polished winter-city texture.",
    position: [51.5111, -0.1171],
    backdrop: null,
    now: "https://images.unsplash.com/photo-1577048982768-5cb3e7ddfa23?auto=format&fit=crop&w=800&q=80",
  },
].map((location) => ({ ...location, kind: "film", backdropVerified: false }));

// What kind of work this is, as a mark rather than a word.
//
// It used to be the word FILM in a filled pill, and in a list row that pill stretched the
// full width of the row — a banner announcing the least surprising fact on the card. The
// kind is a qualifier, not a headline: on a map of film locations, "film" is the default
// and only the exceptions are worth a reader's attention.
//
// The label is still there for anybody who cannot see the icon. `aria-label` on the span
// rather than visually-hidden text, so it does not land in the middle of a sentence when a
// screen reader reads the line around it.
function WorkKindMark({ kind }) {
  const Icon = kind === "series" ? Tv : kind === "book" ? BookOpen : Film;
  return (
    <span className={`work-kind kind-${kind}`} aria-label={kindLabel(kind)} title={kindLabel(kind)}>
      <Icon size={13} aria-hidden="true" />
    </span>
  );
}

function kindLabel(kind) {
  return kindLabels[kind] ?? "Work";
}

function filmImagePlaceholderLabel(status) {
  if (status === "loading") return "Matching scene to this place…";
  if (status === "no_match") return "No verified scene match";
  if (status === "studio_lot") return "Filmed on a studio lot";
  if (status === "error") return "Scene matching failed";
  return "Scene matching unavailable";
}

const frameLocationLabels = {
  street: "Street",
  bar_or_restaurant: "Bar / restaurant",
  building: "Building",
  studio: "Studio",
  landscape: "Landscape",
  other: "Location",
};

function frameLocationLabel(type) {
  return frameLocationLabels[type] ?? frameLocationLabels.other;
}

function framesFromFilmImagePayload(payload, fallbackPlace) {
  const rawFrames = Array.isArray(payload.frames) && payload.frames.length
    ? payload.frames
    : payload.image_url
      ? [{
          image_url: payload.image_url,
          source_url: payload.source_url,
          location_name: fallbackPlace,
          location_type: "other",
          description: "",
        }]
      : [];

  return rawFrames
    .filter((frame) => typeof frame?.image_url === "string" && frame.image_url)
    .slice(0, 3)
    .map((frame) => ({
      url: frame.image_url,
      sourceUrl: frame.source_url ?? payload.source_url ?? null,
      locationName: frame.location_name ?? fallbackPlace,
      locationType: frame.location_type ?? "other",
      description: frame.description ?? "",
    }));
}

function locationsFromApi(records) {
  return records
    .map((record) => {
      const kind = record.kind ?? "film";
      const relationLabel = record.relation_label
        ?? (kind === "book" ? "Story setting" : "Filming location");
      // A place found by the inverted search has no Wikidata item — it is a Wikipedia
      // article — so the id has to come from somewhere else. Falling through to
      // `undefined` would give every such place the SAME id, and the map would show
      // one pin for all of them.
      const placeId = record.loc_wikidata_id ?? record.loc_source_id;

      return {
        id: `${kind}-${record.work_wikidata_id}-${placeId}`,
        filmId: record.work_wikidata_id,
        film: record.work_title,
        scene: record.scene_title ?? relationLabel,
        place: record.loc_name,
        description: record.relation_description
          ?? `${record.loc_name} is connected with ${record.work_title}.`,
        position: [record.lat, record.lng],
        locationId: record.loc_wikidata_id,
        backdrop: record.backdrop_verified === true ? record.backdrop ?? null : null,
        backdropVerified: record.backdrop_verified === true,
        now: record.commons_image?.replace(/^http:\/\//, "https://") ?? null,
        filmTmdbId: record.film_tmdb_id,
        sceneMatchToken: record.scene_match_token ?? null,
        year: record.work_year,
        kind,
        relationKind: record.relation_kind,
        // How exactly the place is located — a separate question from how well it is
        // evidenced, and the one that decides whether it may be drawn as a dot.
        precision: record.precision ?? "unknown",
        display: record.display ?? "pin",
        precisionCaveat: record.precision_caveat ?? null,
        // Not a claim that anything was filmed here — only that this place's own
        // article mentions the work. The map must keep the two apart everywhere it
        // shows them, so the flag travels with the location rather than being
        // re-derived at each render.
        isCandidate: record.relation_kind === "candidate",
        sourceUrl: record.source_url,
        sourceTitle: record.source_title,
        evidenceSource: record.evidence_source ?? "wikidata",
      };
    })
    .filter((location) => {
      const [lat, lng] = location.position;
      // Reject out-of-range coordinates too: findNearby (nearby.mjs) throws on
      // them, which would crash the render (no error boundary).
      return (
        Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      );
    });
}

// The same key the artwork API returns. A film id and a series id can be the same
// integer on TMDB, so the kind is part of the key.
function posterCacheKey(film) {
  return film?.tmdbId ? `${film.kind ?? "film"}:${film.tmdbId}` : "";
}

function worksFromLocations(sourceLocations) {
  return [...new Map(sourceLocations.map((location) => [
    location.filmId,
    {
      id: location.filmId,
      title: location.film,
      year: location.year,
      kind: location.kind ?? "film",
      // Carried through so the chip can ask for a poster. The initials stay as the
      // fallback: books have no TMDB entry at all, and a poster may simply not arrive.
      tmdbId: location.filmTmdbId ?? null,
      code: location.film.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(),
    },
  ])).values()];
}






// The viewport IS the question. Dragging used to refresh the search and zooming did
// not, so widening the view to a country kept answering about the city — the places in
// Scotland stayed invisible from a Britain-wide view because nothing re-asked.
//
// Zoom fires far more often than drag, hence the debounce: a pinch is a dozen events
// and each one would otherwise be a request.
const VIEWPORT_DEBOUNCE_MS = 400;



// How big an area is, roughly, so it can be drawn as one. These are not claims about
// the boundary — we do not have boundaries — they are honest orders of magnitude: a
// village you could cross on foot, a county you could not. Drawing the county as a dot
// is the lie this replaces; drawing it as a ring the size of a county is merely vague,
// which is exactly what the source was.
const AREA_RADIUS_M = { settlement: 1200, region: 12000, country: 60000, unknown: 3000 };

function areaRadiusMeters(precision) {
  return AREA_RADIUS_M[precision] ?? AREA_RADIUS_M.unknown;
}








const GEOLOCATION_ERRORS = {
  1: {
    status: "denied",
    message: "Location access was denied. You can retry or use the demo location.",
  },
  2: {
    status: "unavailable",
    message: "Your position is unavailable right now. Try again or use the demo location.",
  },
  3: {
    status: "timeout",
    message: "Locating took too long. Try again or use the demo location.",
  },
};

function kmBetween(routeStops) {
  if (routeStops.length < 2) return 0;

  return routeStops.slice(1).reduce(
    (sum, stop, index) => sum + haversineKm(routeStops[index].position, stop.position),
    0,
  );
}

function makeFallbackRoute(routeStops) {
  const distanceKm = kmBetween(routeStops);

  return {
    positions: routeStops.map((stop) => stop.position),
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes: Math.max(8, Math.round((distanceKm / WALKING_SPEED_KMH) * 60)),
    source: "fallback",
  };
}

function makeImageSearchUrl(location) {
  const scene = location.scene?.trim();
  const relationQuery = location.kind === "book"
    ? "book setting real place"
    : "scene filming location";
  const query = [
    `"${location.film}"`,
    `"${location.place}"`,
    scene && scene.toLowerCase() !== location.film.toLowerCase() ? `"${scene}"` : null,
    relationQuery,
  ].filter(Boolean).join(" ");

  return `https://www.bing.com/images/search?${new URLSearchParams({ q: query })}`;
}

function RecreateShot({ location, onClose }) {
  const inputRef = useRef(null);
  const photoUrlRef = useRef("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [view, setView] = useState("overlay");
  const [opacity, setOpacity] = useState(55);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function loadPhoto(event) {
    const [file] = event.target.files;
    if (!file?.type.startsWith("image/")) return;

    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    photoUrlRef.current = nextUrl;
    setPhotoUrl(nextUrl);
    setView("overlay");
  }

  function resetPhoto() {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = "";
    setPhotoUrl("");
    setView("overlay");
    setOpacity(55);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="recreate-backdrop">
      <section
        aria-labelledby="recreate-title"
        aria-modal="true"
        className="recreate-dialog"
        role="dialog"
      >
        <header className="recreate-header">
          <div>
            <p className="eyebrow">Recreate the shot</p>
            <h2 id="recreate-title">{location.scene}</h2>
            <span>{location.film} · {location.place}</span>
          </div>
          <button
            aria-label="Close recreate shot"
            autoFocus
            className="icon-button recreate-close"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="recreate-stage">
          {view === "overlay" ? (
            <div className="recreate-canvas">
              <img src={location.backdrop} alt={`Reference frame for ${location.film}`} />
              {photoUrl && (
                <img
                  className="recreate-user-photo"
                  src={photoUrl}
                  alt="Your uploaded recreation"
                  style={{ opacity: opacity / 100 }}
                />
              )}
            </div>
          ) : (
            <div className="recreate-comparison" aria-label="Then and now comparison">
              <figure>
                <img src={location.backdrop} alt={`Reference frame for ${location.film}`} />
                <figcaption>Then · reference</figcaption>
              </figure>
              <figure>
                <img src={photoUrl} alt="Your uploaded recreation" />
                <figcaption>Now · your photo</figcaption>
              </figure>
            </div>
          )}
          {!photoUrl && (
            <div className="recreate-empty">
              <strong>Match the framing</strong>
              <span>Upload a photo from this device to line it up with the reference.</span>
            </div>
          )}
        </div>

        <div className="recreate-controls">
          <input
            accept="image/*"
            className="recreate-file-input"
            id="recreate-photo"
            onChange={loadPhoto}
            ref={inputRef}
            type="file"
          />
          <label className="wide-button recreate-upload" htmlFor="recreate-photo">
            {photoUrl ? "Choose another photo" : "Upload your photo"}
          </label>

          {photoUrl && (
            <>
              <div className="recreate-view-switch" aria-label="Comparison mode">
                <button
                  aria-pressed={view === "overlay"}
                  className="ghost-button"
                  onClick={() => setView("overlay")}
                  type="button"
                >
                  Overlay
                </button>
                <button
                  aria-pressed={view === "compare"}
                  className="ghost-button"
                  onClick={() => setView("compare")}
                  type="button"
                >
                  Then / now
                </button>
              </div>

              {view === "overlay" && (
                <label className="recreate-opacity">
                  <span>Your photo opacity</span>
                  <input
                    aria-label="Your photo opacity"
                    max="100"
                    min="0"
                    onChange={(event) => setOpacity(Number(event.target.value))}
                    type="range"
                    value={opacity}
                  />
                  <output>{opacity}%</output>
                </label>
              )}

              <button className="ghost-button recreate-reset" onClick={resetPhoto} type="button">
                Reset photo
              </button>
            </>
          )}

          <p className="recreate-privacy">Your photo stays in this browser tab and is never uploaded.</p>
        </div>
      </section>
    </div>
  );
}

export default function SceneMapApp() {
  const connectorInputRef = useRef(null);
  const [liveLocations, setLiveLocations] = useState(null);
  // The graph layer is an additive overlay: the live Wikidata path stays the default
  // so searching any city still works, while the graph shows what we have grounded.
  // On a phone the panel starts COLLAPSED: this is a map app, and a map you cannot
  // see is not a map. Expanded it overlays the map, which is fine — the user asked
  // for it. Desktop is unaffected (the class only does anything under 860px).
  const [panelOpen, setPanelOpen] = useState(false);
  // Commons images are licensed PER FILE, so the credit has to be fetched before the
  // photo may be shown at all (app/lib/attribution.mjs refuses it otherwise).
  const [imageAttribution, setImageAttribution] = useState({});

  // On by default since 11.09.2026. It was off, and the result was a map that opened
  // showing nothing: the live Wikidata path answers for a handful of works, so anybody
  // opening Los Angeles saw an empty screen and had to find two switches before the
  // product did anything. "We have nothing here" was the impression, and we hold 5,266
  // rows there.
  // The filters, read from the address bar once. Reading them lazily inside `useState` and
  // not in an effect matters: an effect would render the unfiltered map first and then
  // narrow it, so a shared link would flash everything the sender was trying not to show.
  const initialFilters = useMemo(() => {
    if (typeof window === "undefined") return FILTER_DEFAULTS;
    return filtersFromParams(new URLSearchParams(window.location.search));
  }, []);

  const [graphLayerOn, setGraphLayerOn] = useState(initialFilters.graphLayer);
  const [graphSummary, setGraphSummary] = useState(null);
  // The queue on the browsable map, and ON by default.
  //
  // The argument for keeping it off was that it changes what the map claims. Measured, the
  // opposite is true: the graph holds **70 places in the world** and the queue holds
  // **32,138 located rows**, so a map without it shows nothing almost everywhere — one pin
  // for the whole Los Angeles basin — and "we have nothing here" is the more misleading of
  // the two impressions.
  //
  // The honesty is carried by the RENDERING, not by the default. A candidate is drawn
  // hollow and grey where a fact is filled and amber, its popup says "In review", and the
  // panel above says the rows are named by our sources and not checked by us. A reader can
  // tell the two apart at a glance; an empty map tells them nothing at all.
  const [candidatesOn, setCandidatesOn] = useState(initialFilters.candidates);
  const [studioLotsOn, setStudioLotsOn] = useState(initialFilters.studioLots);
  // ONE "only my films" switch, for every layer.
  //
  // There were two — `libraryMapOnly` over the searched works and the chips, and
  // `candidatesMineOnly` over the queue pins — in two different parts of the interface,
  // three levels deep. The owner could not tell whether his library was loaded or whether
  // the map was showing everything, which is exactly what two switches for one idea does.
  const [mineOnly, setMineOnly] = useState(initialFilters.mineOnly);
  // What is on screen right now, and how the reader wants to read it. Separate from the
  // film chips beside it: those are what somebody SEARCHED for, this is what the map is
  // showing, and it changes as the map moves.
  const [candidatesDrawn, setCandidatesDrawn] = useState([]);
  // Whether the vector basemap has actually painted. Until it has, a raster layer holds
  // the ground so a WebGL failure never leaves the map empty.
  const [vectorReady, setVectorReady] = useState(false);
  const markVectorReady = useCallback(() => setVectorReady(true), []);
  const [filmsViewMode, setFilmsViewMode] = useState(DEFAULT_VIEW_MODE);
  // How the film list is ordered, and the bar a film must clear to appear at all.
  //
  // The rating is the READER'S. `work_ratings` holds 32 rows across 12 works out of
  // 7,063, and one of the 1,642 works with a Los Angeles row — so ordering by a public
  // score would sort 1,641 films by a field that is null. A real export holds 2,407
  // ratings for 2,422 films.
  const [sortBy, setSortBy] = useState(DEFAULT_SORT);
  const [minRating, setMinRating] = useState(initialFilters.minRating);
  // The public score, independent of the reader's own. "Films I rated 8 AND the world
  // rated 7.5" is a real question and neither filter answers it alone. It works without a
  // library, which the reader's own cannot.
  const [minImdb, setMinImdb] = useState(initialFilters.minImdb);
  const [graphKinds, setGraphKinds] = useState(initialFilters.kinds);   // [] = every kind
  const [graphWorkId, setGraphWorkId] = useState(initialFilters.workId); // "" = the whole library
  const [graphWorks, setGraphWorks] = useState([]);

  // Works that actually have a mappable place under the current kind filter, so the
  // selector can never offer a work with nothing to show.
  useEffect(() => {
    if (!graphLayerOn) return undefined;
    const controller = new AbortController();
    const query = graphKinds.length ? `?kinds=${graphKinds.join(",")}` : "";
    (async () => {
      try {
        const response = await fetch(`/api/map/works${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`works responded ${response.status}`);
        const body = await response.json();
        setGraphWorks(Array.isArray(body.works) ? body.works : []);
      } catch (error) {
        if (error?.name !== "AbortError") setGraphWorks([]);
      }
    })();
    return () => controller.abort();
  }, [graphLayerOn, graphKinds]);

  // Where the map opens, read from the URL once. Until now the answer was always London,
  // and there was no way to link anywhere else — see [[map-url]]. Read in the initialiser
  // rather than in an effect, so the first fetch already asks about the right city instead
  // of loading London and then moving.
  const opened = useMemo(() => {
    if (typeof window === "undefined") return null;
    return readMapUrl(new URLSearchParams(window.location.search));
  }, []);

  const [mapCenter, setMapCenter] = useState(opened ? [opened.lat, opened.lng] : londonCenter);
  const [browseCenter, setBrowseCenter] = useState(opened ? [opened.lat, opened.lng] : londonCenter);
  const [browseRadius, setBrowseRadius] = useState(10);
  const [cityName, setCityName] = useState(opened?.name ?? "London");
  const [cityRadius, setCityRadius] = useState(15);
  // The exclusion is London's Wikidata id; a map opened elsewhere must not carry it, or
  // the city it opened on is filtered out of its own results.
  const [cityWikidataId, setCityWikidataId] = useState(opened ? null : "Q84");
  const [mapZoom, setMapZoom] = useState(opened?.zoom ?? null);
  const [citySearchStatus, setCitySearchStatus] = useState("");
  const [workQuery, setWorkQuery] = useState("");
  // Every kind, not films. The select offered Film / Series / Book and no way to stop
  // choosing, so this panel showed film locations ONLY and said so nowhere: a first-time
  // visitor could not see a single series or book place and was never told one existed.
  const [workKind, setWorkKind] = useState(EVERY_KIND);
  const [locationsStatus, setLocationsStatus] = useState("");
  const locationRequestId = useRef(0);
  const preserveViewportContext = useRef(false);
  const routeRequestId = useRef(0);
  const filmImageCache = useRef(new Map());
  const [selectedFilms, setSelectedFilms] = useState(() => fallbackFilms.map((film) => film.id));
  // Seeded from the London demo, EXCEPT when the URL named somewhere. `RecenterOnSelection`
  // flies to the active location at zoom 14, so a demo pin left selected steals the map
  // from the address that was opened: `/?city=los-angeles` landed the reader in Notting
  // Hill, under a header reading "Los Angeles".
  // Nothing open until the reader opens something. It used to start on the demo pin, and
  // the sheet it opened was the first thing a new visitor saw instead of the map.
  const [activeLocation, setActiveLocation] = useState(null);
  // On a phone the panel and a place's card are both sheets rising from the bottom, and
  // stacked they left the card a 380 px slot with the panel's credits printed over it
  // (mobile review, 2026-10-13). Opening a place puts the panel away; the CSS does the
  // reverse, hiding the card while the panel is pulled up again.
  useEffect(() => {
    if (activeLocation && window.matchMedia("(max-width: 860px)").matches) setPanelOpen(false);
  }, [activeLocation?.id]);
  const [filmImageState, setFilmImageState] = useState({
    locationId: fallbackLocations[0].id,
    url: null,
    sourceUrl: null,
    frames: [],
    status: "unavailable",
  });
  const [filmImageRetry, setFilmImageRetry] = useState(0);
  // Broken image URLs are tracked in React state instead of removing DOM nodes
  // directly: mutating React-managed nodes in onError crashes the whole SPA when
  // reconciliation later touches a detached node (there is no error boundary).
  const [brokenImages, setBrokenImages] = useState(() => new Set());
  // The film whose profile is open, or null. Opened from a chip's info button.
  const [profileFilm, setProfileFilm] = useState(null);
  // Poster URLs keyed "film:170" / "series:19885", filled in after the pins land.
  const [filmPosters, setFilmPosters] = useState({});
  // A ref, not state: recording that we already asked must not itself trigger a
  // render, or it would re-run the very effect it exists to stop.
  const posterAttempts = useRef(new Set());

  // Commons images are licensed PER FILE, so the credit has to be fetched before the
  // photo may be shown at all (app/lib/attribution.mjs refuses it otherwise).
  //
  // This effect MUST stay below `activeLocation`. A dependency array is evaluated
  // during render, at the point the useEffect call appears — so reading
  // `activeLocation?.now` above the useState that declares it threw
  // "Cannot access 'activeLocation' before initialization" and took the whole map
  // into the error boundary. Optional chaining does not help: the temporal dead zone
  // rejects touching the binding at all, not just reading a property off it.
  useEffect(() => {
    const url = activeLocation?.now;
    if (!url || imageAttribution[url]) return undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/attribution?url=${encodeURIComponent(url)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = await response.json();
        const found = body.attributions?.[url];
        if (found) setImageAttribution((current) => ({ ...current, [url]: found }));
      } catch (error) {
        if (error?.name !== "AbortError") {
          // Leaving it unattributed is the safe outcome: the credit line simply
          // shows the source, and nothing claims an author we do not know.
        }
      }
    })();
    return () => controller.abort();
  }, [activeLocation?.now, imageAttribution]);
  const markImageBroken = (url) => {
    if (!url) return;
    setBrokenImages((current) => (current.has(url) ? current : new Set(current).add(url)));
  };
  const [routeStops, setRouteStops] = useState([]);
  // What the map is showing right now (#160), published by RefreshLocationsOnViewport
  // without the fetch's debounce. Null until the map has drawn once.
  const [mapBounds, setMapBounds] = useState(null);
  const [placeTab, setPlaceTab] = useState(DEFAULT_PLACE_TAB);
  // "Want to visit" and "I'm here" (#23), kept in this browser only. Read after mount, so
  // the server's render and the first client render agree.
  const [placeMarks, setPlaceMarks] = useState(emptyMarks);
  const [checkInNote, setCheckInNote] = useState(null);
  const [checkingIn, setCheckingIn] = useState(false);
  useEffect(() => { setPlaceMarks(loadMarks(window.localStorage)); }, []);
  // Which section is open (#22). The others are views over this component's state, so
  // switching never resets the city, the open place or the route.
  const [section, setSection] = useState("map");
  const [suggestions, setSuggestions] = useState([]);
  useEffect(() => { setSuggestions(loadSuggestions(window.localStorage)); }, []);
  // The first run (#15). Offered by itself only to somebody new — no record of it, and no
  // library anywhere on this device — and from the profile any time after.
  const [onboarding, setOnboarding] = useState(emptyOnboarding);
  const [onboardingOpen, setOnboardingOpen] = useState(null);
  useEffect(() => {
    const record = loadOnboarding(window.localStorage);
    if (record) setOnboarding(record);
    let stored = 0;
    try {
      stored = Object.keys(window.localStorage)
        .filter((key) => key.startsWith(GUEST_LIBRARY_KEY))
        .reduce((sum, key) => sum + readStoredLibrary(key).length, 0);
    } catch {
      // Storage refused: nothing is known about a library, so nothing is offered.
      return;
    }
    if (shouldOfferOnboarding(record, stored)) setOnboardingOpen("intro");
  }, []);

  function updateOnboarding(next) {
    setOnboarding(next);
    saveOnboarding(window.localStorage, next);
  }

  function finishOnboarding() {
    const entries = libraryFromDecisions(onboarding);
    updateOnboarding({ ...onboarding, done: true });
    setOnboardingOpen(null);
    if (entries.length === 0) return;
    // Into the library an import fills, and the map shows them — the same as an import.
    setLibrary((current) => mergeLibraries(current, entries));
    setMineOnly(true);
  }
  const [copiedCoordinate, setCopiedCoordinate] = useState(false);
  const [routeStatus, setRouteStatus] = useState("idle");
  const [routeResult, setRouteResult] = useState(null);
  const [routeMessage, setRouteMessage] = useState("");
  // A walk frozen by a previous session, offered back when the app opens without a network.
  const [restoredWalk, setRestoredWalk] = useState(null);
  // What the corridor prefetch did, so the card can say it. Null until a route is kept.
  const [keptTiles, setKeptTiles] = useState(null);
  const [nearbyStatus, setNearbyStatus] = useState("idle");
  const [nearbyMessage, setNearbyMessage] = useState("");
  const [userPosition, setUserPosition] = useState(null);
  const [userIsDemo, setUserIsDemo] = useState(false);
  const [nearbyRadius, setNearbyRadius] = useState(RADIUS_OPTIONS_METERS[2]);
  const [tourFilmId, setTourFilmId] = useState(fallbackFilms[0].id);
  const [aiTour, setAiTour] = useState(null);
  const [aiTourStatus, setAiTourStatus] = useState("idle");
  const [aiTourError, setAiTourError] = useState("");
  const [tourBudget, setTourBudget] = useState(60);
  const [timedTour, setTimedTour] = useState(null);
  const [timedTourStatus, setTimedTourStatus] = useState("idle");
  const [timedTourMessage, setTimedTourMessage] = useState("");
  // What OSM knows about getting into the places around here, keyed by place id. Kept
  // beside the tour rather than inside it so the location card can say the same thing
  // the tour says about a stop.
  const [tourAccess, setTourAccess] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [accountUser, setAccountUser] = useState(null);
  const [accountStatus, setAccountStatus] = useState(supabase ? "loading" : "unavailable");
  const [cloudStatus, setCloudStatus] = useState("Saved on this device");
  const [cloudReady, setCloudReady] = useState(false);
  const [libraryStorageKey, setLibraryStorageKey] = useState(GUEST_LIBRARY_KEY);
  const [pendingConnector, setPendingConnector] = useState(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [signInAddress, setSignInAddress] = useState("");
  const [library, setLibrary] = useState(() => readStoredLibrary(GUEST_LIBRARY_KEY));
  const [libraryQuery, setLibraryQuery] = useState("");
  const [importMessage, setImportMessage] = useState("");

  const [recreateLocation, setRecreateLocation] = useState(null);

  useEffect(() => {
    localStorage.setItem(libraryStorageKey, JSON.stringify(library));
  }, [library, libraryStorageKey]);

  // A real Letterboxd export, seeded once in development so the map can be tested against
  // an actual library without importing it every time.
  //
  // **Two guards, and both are deliberate.** It runs only when `process.env.NODE_ENV` is
  // not production, so a deploy can never ship somebody's watch history; and it only seeds
  // when storage is EMPTY, so it can never overwrite a list a reader imported themselves.
  // The file is generated by `scripts/seed-demo-library.mjs` and is gitignored — a watch
  // history is personal and this repository is public.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return undefined;
    if (library.length > 0) return undefined;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/demo-library.json", { cache: "no-store" });
        if (!response.ok) return; // nobody has seeded one; that is the normal case
        const seeded = await response.json();
        if (cancelled || !Array.isArray(seeded) || seeded.length === 0) return;
        // The existing persistence effect writes it to storage; setting state is enough,
        // and going round it would be a second way to save the same thing.
        setLibrary(seeded);
      } catch {
        // A missing or malformed demo file is not an error worth showing: the app works
        // without one, which is exactly what a reader with no import sees.
      }
    })();
    return () => { cancelled = true; };
  }, [library.length]);


  useEffect(() => {
    if (!supabase) return undefined;

    let cancelled = false;
    let hydrationId = 0;

    async function applySession(session) {
      const requestId = hydrationId + 1;
      hydrationId = requestId;
      const user = session?.user ?? null;

      if (!user) {
        setAccountUser(null);
        setAccountStatus("signed_out");
        setCloudReady(false);
        setLibraryStorageKey(GUEST_LIBRARY_KEY);
        setLibrary(readStoredLibrary(GUEST_LIBRARY_KEY));
        setCloudStatus("Saved on this device");
        return;
      }

      const userStorageKey = `${GUEST_LIBRARY_KEY}:${user.id}`;
      setAccountUser(user);
      setAccountStatus("loading");
      setCloudReady(false);
      setCloudStatus("Loading your account…");

      const cachedAccountLibrary = readStoredLibrary(userStorageKey);
      const guestLibrary = readStoredLibrary(GUEST_LIBRARY_KEY);

      try {
        const cloudLibrary = await loadCloudLibrary(supabase, user.id);
        const mergedLibrary = mergeLibraries(
          cloudLibrary,
          mergeLibraries(cachedAccountLibrary, guestLibrary),
        );
        await saveCloudLibrary(supabase, user.id, mergedLibrary);
        if (cancelled || requestId !== hydrationId) return;

        localStorage.removeItem(GUEST_LIBRARY_KEY);
        setLibraryStorageKey(userStorageKey);
        setLibrary(mergedLibrary);
        setAccountStatus("signed_in");
        setCloudReady(true);
        setCloudStatus("Synced to your account");
      } catch {
        if (cancelled || requestId !== hydrationId) return;
        setLibraryStorageKey(userStorageKey);
        setLibrary(mergeLibraries(cachedAccountLibrary, guestLibrary));
        setAccountStatus("error");
        setCloudStatus("Cloud sync is unavailable. Your library is still saved on this device.");
      }
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => applySession(session));
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  // A coalescing runner serializes cloud saves so an out-of-order network
  // completion can't let a stale library overwrite a newer one (issue #83).
  const cloudSaverRef = useRef(null);
  if (!cloudSaverRef.current) {
    cloudSaverRef.current = createCoalescingRunner(async ({ client, userId, movies }) => {
      try {
        await saveCloudLibrary(client, userId, movies);
        setCloudStatus("Synced to your account");
      } catch {
        setCloudStatus("Cloud sync failed. Your device copy is safe.");
      }
    });
  }

  useEffect(() => {
    if (!supabase || !accountUser || !cloudReady) return undefined;

    setCloudStatus("Saving…");
    const timeout = window.setTimeout(() => {
      cloudSaverRef.current.submit({ client: supabase, userId: accountUser.id, movies: library });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [accountUser, cloudReady, library, supabase]);

  // `openFirst` is for a question that NAMED something — a title search. A browse, a page
  // load or a city change asked about an area, and opening the first place in it is a
  // card nobody requested: the second design review measured it covering 55% of a phone's
  // first screen, so the panel a visitor was meant to meet first was a 40 px strip behind a
  // sheet about Forrest Gump.
  function applyLocationResults(nextLocations, { preserveContext = false, openFirst = false } = {}) {
    const nextFilms = worksFromLocations(nextLocations);
    setLiveLocations(nextLocations);
    setSelectedFilms(nextFilms.map((film) => film.id));
    setActiveLocation((currentLocation) => {
      if (!preserveContext) return openFirst ? nextLocations[0] ?? null : null;
      return nextLocations.some((location) => location.id === currentLocation?.id)
        ? currentLocation
        : null;
    });

    if (preserveContext) return;

    setTourFilmId(nextFilms[0]?.id ?? "");
    resetAiTour();
    resetTimedTour();
    setRouteStops([]);
    // Through invalidateRoute, not by hand: clearing the result without bumping the
    // request id let a route asked for the old results land on the new ones (#82).
    invalidateRoute();
  }

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const requestId = locationRequestId.current + 1;
    const preserveContext = preserveViewportContext.current;
    locationRequestId.current = requestId;

    async function loadLocations() {
      // "mapped work locations" is what the label produced under All — accurate and unreadable.
      setLocationsStatus(`Finding ${workKind === EVERY_KIND ? "places" : `${workKindLabel(workKind)} locations`} in this map area…`);
      try {
        const params = new URLSearchParams({
          lat: String(browseCenter[0]),
          lng: String(browseCenter[1]),
          radius: String(browseRadius),
          limit: "30",
          kind: workKind,
        });
        if (cityWikidataId) params.set("exclude", cityWikidataId);

        const response = await fetch(`/api/locations?${params}`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Locations API failed");
        const nextLocations = locationsFromApi(payload.locations ?? []);
        if (cancelled || requestId !== locationRequestId.current) return;

        applyLocationResults(nextLocations, { preserveContext });
        setLocationsStatus(nextLocations.length
          // The set is named on success too. It used to be named only on FAILURE, so the
          // one message that could have revealed the hidden filter was the one nobody
          // reads when things work.
          // Not "verified". This list mixes Wikidata statements with our own queue, and the
          // layer toggle below counted 0 places checked by us in the same view — the word
          // claimed a review that had not happened.
          ? `${nextLocations.length} places found nearby · ${workKind === EVERY_KIND
            ? "films, series and books"
            : `${workKindLabel(workKind, { plural: true })} only`}`
          : `No ${workKind === EVERY_KIND ? "places" : `${workKindLabel(workKind)} locations`} found nearby. Search for a title to check the whole city.`);
      } catch (error) {
        if (cancelled || requestId !== locationRequestId.current) return;
        if (liveLocations !== null && !preserveContext) applyLocationResults([]);
        setLocationsStatus(error instanceof Error
          ? error.message
          : "Live location search is unavailable. The London demo remains available.");
      }
    }

    loadLocations();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [browseCenter, browseRadius, cityWikidataId, workKind]);

  useEffect(() => {
    if (!activeLocation) return undefined;

    if (activeLocation.backdrop && activeLocation.backdropVerified) {
      const frame = {
        url: activeLocation.backdrop,
        sourceUrl: null,
        locationName: activeLocation.place,
        locationType: "other",
        description: activeLocation.description ?? "",
      };
      setFilmImageState({
        locationId: activeLocation.id,
        url: frame.url,
        sourceUrl: null,
        frames: [frame],
        status: "ready",
      });
      return undefined;
    }

    if (!activeLocation.filmTmdbId || !activeLocation.filmId || !activeLocation.locationId || !activeLocation.sceneMatchToken) {
      setFilmImageState({
        locationId: activeLocation.id,
        url: null,
        sourceUrl: null,
        frames: [],
        status: "unavailable",
      });
      return undefined;
    }

    const locationCacheId = activeLocation.locationId ?? activeLocation.id;
    const cacheKey = filmLocationImageKey(activeLocation.filmTmdbId, locationCacheId);
    if (filmImageCache.current.has(cacheKey)) {
      const cached = filmImageCache.current.get(cacheKey);
      setFilmImageState({
        locationId: activeLocation.id,
        url: cached?.url ?? null,
        sourceUrl: cached?.sourceUrl ?? null,
        frames: cached?.frames ?? [],
        status: cached?.status ?? (cached?.url ? "ready" : "unavailable"),
      });
      return undefined;
    }

    const controller = new AbortController();
    setFilmImageState({
      locationId: activeLocation.id,
      url: null,
      sourceUrl: null,
      frames: [],
      status: "loading",
    });

    async function loadFilmImage() {
      try {
        const query = new URLSearchParams({
          tmdbId: String(activeLocation.filmTmdbId),
          workId: String(activeLocation.filmId),
          locationId: String(locationCacheId),
          token: activeLocation.sceneMatchToken,
          v: "4",
        });
        const response = await fetch(`/api/film-image?${query}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Film image API failed");

        const status = payload.image_url
          ? "ready"
          : payload.reason === "studio_lot"
            ? "studio_lot"
            : ["no_candidates", "no_high_confidence_match"].includes(payload.reason)
              ? "no_match"
              : "unavailable";
        const frames = framesFromFilmImagePayload(payload, activeLocation.place);
        const cached = {
          url: frames[0]?.url ?? payload.image_url ?? null,
          sourceUrl: frames[0]?.sourceUrl ?? payload.source_url ?? null,
          frames,
          status,
          studio: payload.studio ?? null,
        };
        filmImageCache.current.set(cacheKey, cached);
        setFilmImageState({
          locationId: activeLocation.id,
          ...cached,
        });
      } catch (error) {
        if (error.name === "AbortError") return;
        setFilmImageState({
          locationId: activeLocation.id,
          url: null,
          sourceUrl: null,
          frames: [],
          status: "error",
        });
      }
    }

    loadFilmImage();
    return () => controller.abort();
  }, [activeLocation, filmImageRetry]);

  const sourceLocations = liveLocations ?? fallbackLocations;
  // Which basemap the map is drawn on. Read from storage on mount rather than during
  // render: the server has no localStorage, and reading it inline makes the first client
  // render disagree with the server's and blank the map.
  const [basemapId, setBasemapId] = useState(DEFAULT_LAYER_ID);
  // The Leaflet map itself, lifted by <ExposeMap> so the furniture outside the container
  // can drive it. The zoom it reports is the `mapZoom` already declared above — the one
  // the viewport refresh keeps — so the +/- buttons go dead at the limits from the same
  // number the rest of the component reads, rather than a second copy of it.
  const [mapApi, setMapApi] = useState(null);
  const [layersOpen, setLayersOpen] = useState(false);
  // Closed by default: the console answers an operator's questions, not a visitor's.
  const [layersConsoleOpen, setLayersConsoleOpen] = useState(false);
  // Which film the reader is pointing at in the list. Null when they are pointing at
  // nothing, which is most of the time.
  const [highlightedFilm, setHighlightedFilm] = useState(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const zoom = useMemo(() => zoomAffordance(mapZoom), [mapZoom]);
  useEffect(() => {
    if (typeof window !== "undefined") setBasemapId(readStoredLayerId(window.localStorage));
  }, []);
  // The layers this deployment actually draws. With a MapTiler key the two vector styles
  // come from MapTiler; with none they stay OpenFreeMap, which is what a fresh clone gets.
  // `NEXT_PUBLIC_` is inlined at build time, so this is a constant in the browser.
  const layers = useMemo(() => mapLayers(process.env.NEXT_PUBLIC_MAPTILER_KEY), []);
  const basemap = useMemo(
    () => layers.find((layer) => layer.id === basemapId) ?? layerById(basemapId),
    [layers, basemapId],
  );
  // What the map reports as it moves, and the two different things that ride on it.
  //
  // The COUNT of what is on screen is published immediately; the FETCH is debounced. They
  // are different costs — the fetch is a network request per gesture, the count is a filter
  // over a list already in memory — and debouncing the count would leave the panel stating
  // the previous viewport for 400 ms after every drag, which is the one moment a reader is
  // actually looking at it.
  const viewportTimer = useRef(null);
  const onMapViewport = useCallback(({ bounds, center, zoom }) => {
    setMapBounds(bounds);

    clearTimeout(viewportTimer.current);
    viewportTimer.current = setTimeout(() => {
      // Distance from the centre to a corner, in metres, without asking the map: a map that
      // has not been laid out reports a zero-size viewport, and `mapSearchRadiusKm` refuses
      // a non-positive distance — correctly, since a search radius of nothing is not a
      // question. That refusal is a THROW, and inside a timer it is uncaught: it once killed
      // the whole update and left Los Angeles empty with three console errors and no other
      // symptom. So the degenerate case is answered here, by waiting for the next move.
      const metresPerDegreeLat = 111_320;
      const dLat = (bounds.north - center.lat) * metresPerDegreeLat;
      const dLng = (bounds.east - center.lng) * metresPerDegreeLat * Math.cos((center.lat * Math.PI) / 180);
      const distanceToCorner = Math.hypot(dLat, dLng);
      if (!Number.isFinite(distanceToCorner) || distanceToCorner <= 0) return;

      refreshVisibleMap({
        center: [Number(center.lat.toFixed(5)), Number(center.lng.toFixed(5))],
        radiusKm: mapSearchRadiusKm(distanceToCorner),
        zoom,
      });
    }, 400);
  }, [refreshVisibleMap]);

  // A queue point, turned into the shape the sheet reads. The sheet was written for a
  // searched work's location, which carries a film and a scene; a queue point carries a
  // place and a LIST of films, so the best-known of them names the card and the rest stay
  // in the card on the map where they were already listed.
  const openPlaceFromFeature = useCallback((feature) => {
    const props = feature?.properties ?? {};
    const [lng, lat] = feature?.geometry?.coordinates ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Deduped, so a work listed by two sources is one film with the fuller description —
    // and so the card's subtitle is the best sentence anybody wrote about this place, not
    // whichever row the query happened to put first.
    const films = describedFilms(props.films, { placeName: props.name });
    const lead = films.find((film) => film.note) ?? films[0] ?? {};

    setActiveLocation({
      id: `point-${lat},${lng}`,
      film: lead.title ?? props.name ?? "This place",
      kind: lead.kind === "series" ? "series" : "film",
      // What was filmed here, when the source said so. The card used to print the literal
      // words "Filming location" under every title — a heading in the one line that had
      // room to answer why this corner is worth the walk. See [[place-note]].
      scene: lead.note ?? props.name ?? "Filming location",
      place: props.name ?? null,
      position: [lat, lng],
      // Hollow means a source named it and nobody on our side has checked it. The sheet
      // must not present a queue row as a fact.
      isCandidate: props.status !== "verified",
      display: "point",
      now: null,
    });
  }, []);

  // The filters as they stand, in one object — the shape the URL and the reset both read.
  const filters = useMemo(() => ({
    mineOnly, minRating, minImdb, kinds: graphKinds, workId: graphWorkId,
    candidates: candidatesOn, studioLots: studioLotsOn, graphLayer: graphLayerOn,
  }), [mineOnly, minRating, minImdb, graphKinds, graphWorkId, candidatesOn, studioLotsOn, graphLayerOn]);

  // The filters that NARROW the map — what the chips show and what a reset may undo. The
  // layer switches are deliberately not among them: see [[filter-url]] narrowingFilters.
  const narrowing = useMemo(() => narrowingFilters(filters), [filters]);

  // One filter back to its default, from its own chip.
  const clearFilter = useCallback((key) => {
    const value = clearedFilter(key);
    if (value === undefined) return;
    if (key === "mineOnly") setMineOnly(value);
    else if (key === "minRating") setMinRating(value);
    else if (key === "minImdb") setMinImdb(value);
    else if (key === "kinds") setGraphKinds(value);
    else if (key === "workId") setGraphWorkId(value);
  }, []);

  // Every narrowing filter back at once. It used to switch the LAYERS back on as well, so a
  // reader who had hidden the queue on purpose found it drawn again by a button that said
  // it was resetting filters.
  const resetFilters = useCallback(() => {
    for (const key of ["mineOnly", "minRating", "minImdb", "kinds", "workId"]) clearFilter(key);
  }, [clearFilter]);

  // Only on an offline open, and the restriction is the point. Restoring a walk over a
  // fresh online session would be the product deciding where somebody is — `?city=london`
  // means London even if the last route was in Lisbon. Offline there is no other answer
  // available, and the frozen walk beats an empty map.
  useEffect(() => {
    if (typeof window === "undefined" || navigator.onLine !== false) return;
    const walk = loadWalk(window.localStorage);
    if (!walk) return;

    setRestoredWalk(walk);
    setRouteStops(walk.stops);
    if (walk.route) {
      setRouteResult(walk.route);
      setRouteStatus(walk.route.source === "openstreetmap-foot" ? "ready" : "fallback");
    }
    if (walk.cityName) setCityName(walk.cityName);
    setMapCenter(walk.stops[0].position);
  }, []);

  const chooseBasemap = useCallback((id) => {
    setBasemapId(layerById(id).id);
    if (typeof window !== "undefined") writeStoredLayerId(window.localStorage, id);
  }, []);

  const films = useMemo(
    () => liveLocations ? worksFromLocations(sourceLocations) : fallbackFilms,
    [liveLocations, sourceLocations],
  );
  const libraryFilmIds = useMemo(
    () => new Set(films.filter((film) => workIsInLibrary(film, library)).map((film) => film.id)),
    [films, library],
  );
  // A minimum rating is a statement about films the reader has rated, so it can only
  // describe a subset of their list. Turning it on turns the list filter on with it,
  // rather than silently dropping every film that is not in the library.
  const effectiveMineOnly = mineOnly || impliesLibraryOnly(minRating);

  const mapFilms = useMemo(() => {
    const kept = films.filter((film) => (
      (effectiveMineOnly || impliesLibraryOnly(minRating)
        ? passesLibraryFilter(film, { library, mineOnly: effectiveMineOnly, minRating })
        : true)
      // The chips answer to the same public bar as the pins, or the list beside the map
      // would describe a different set from the one on it.
      && passesImdbFilter(film, minImdb)
    ));
    return sortWorks(kept, { by: sortBy, library });
  }, [films, library, effectiveMineOnly, minRating, minImdb, sortBy]);

  useEffect(() => {
    if (!mapFilms.some((film) => film.id === tourFilmId)) {
      setTourFilmId(mapFilms[0]?.id ?? "");
    }
  }, [mapFilms, tourFilmId]);

  // Posters arrive AFTER the pins, never with them: artwork is decoration and the map
  // is the product, so nothing here is allowed to delay a location.
  //
  // This effect must stay below `mapFilms` — a dependency array is evaluated during
  // render at the point its hook appears, so reading it above its own declaration
  // throws (see test/hook-order.test.mjs).
  useEffect(() => {
    // Asked-for, not answered: a title TMDB has no poster for would otherwise be
    // requested again every time any OTHER poster arrives and changes this state.
    const wanted = mapFilms.filter((film) => {
      const key = posterCacheKey(film);
      return key && !filmPosters[key] && !posterAttempts.current.has(key);
    });
    if (wanted.length === 0) return undefined;
    for (const film of wanted) posterAttempts.current.add(posterCacheKey(film));

    const byKind = new Map();
    for (const film of wanted) {
      if (!byKind.has(film.kind)) byKind.set(film.kind, new Set());
      byKind.get(film.kind).add(String(film.tmdbId));
    }
    const query = [...byKind]
      .map(([kind, ids]) => `${encodeURIComponent(kind)}=${[...ids].join(",")}`)
      .join("&");

    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/artwork?${query}`, { signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json();
        if (body.posters && Object.keys(body.posters).length > 0) {
          setFilmPosters((current) => ({ ...current, ...body.posters }));
        }
      } catch (error) {
        // No poster is a cosmetic outcome — the initials tile is already on screen.
        if (error?.name !== "AbortError") { /* keep the tile */ }
      }
    })();
    return () => controller.abort();
  }, [mapFilms, filmPosters]);

  // The story trail for whichever single work is selected. Only one: a numbered path
  // is a claim about ONE story's order, and overlaying two would be meaningless.
  const [trailScenes, setTrailScenes] = useState([]);
  const [trailPlaces, setTrailPlaces] = useState([]);
  // Spoiler-free is the DEFAULT, never a setting someone has to find: with progress 0
  // the server withholds each unreached scene's coordinates entirely, so the trail
  // cannot leak the plot even by the shape of a line. Seeing it whole is an explicit,
  // reversible choice.
  const [trailSpoilers, setTrailSpoilers] = useState(false);
  const [nextStopId, setNextStopId] = useState(null);
  // The same stops in the plot's order or in the order a walker would take them (#73). The
  // story is the default: it is what the trail is for, and the switch beside it says what
  // walking it that way costs.
  // A shared trail link may ask for walking order (#77); read once, like the filters.
  const [trailOrder, setTrailOrder] = useState(() => (typeof window === "undefined"
    ? TRAIL_ORDER.story
    : trailOrderFromParams(new URLSearchParams(window.location.search))));
  const [trailShareNote, setTrailShareNote] = useState("");
  const [trailWalk, setTrailWalk] = useState({ routes: [], rides: [] });
  // Which city chapter is walked (#74); null until the reader picks one, so each new
  // trail opens on its own best chapter.
  const [trailChapterIndex, setTrailChapterIndex] = useState(null);
  // The timeline's position (#75); null until the reader moves it.
  const [trailScrub, setTrailScrub] = useState(null);
  useEffect(() => { setTrailChapterIndex(null); setTrailScrub(null); }, [graphWorkId]);

  // "My films only", decided here and nowhere else. The library is in localStorage and
  // never reaches the server ([[personal-library]]), so the server cannot filter by it —
  // it hands over every row in the viewport and this predicate drops the rest. A
  // candidate carries its work's title and year for exactly this.
  //
  // Null when the switch is off OR the library is empty, and null means "keep
  // everything": an empty library filtering the map to nothing would look like an outage.
  const candidateIsMine = useMemo(() => {
    const wantsRating = impliesLibraryOnly(minRating);
    const wantsImdb = Number(minImdb) > NO_MINIMUM;
    const wantsLibrary = (mineOnly || wantsRating) && library.length > 0;
    if (!wantsLibrary && !wantsImdb) return null;

    // The public bar applies with or without a library; the personal one cannot. Both are
    // asked of the same film, so a point survives only if some film on it clears BOTH.
    if (!wantsLibrary) return (film) => passesImdbFilter(film, minImdb);
    // The SAME predicate the chips use. The panel counting one set while the map drew
    // another is the "header contradicting the thing it heads" bug this project already
    // fixed once for the viewport count.
    // Called per FILM now, not per pin: a point carries a list, and each entry is its own
    // work with its own title and year.
    return (film) => passesImdbFilter(film, minImdb) && passesLibraryFilter(
      { title: film?.title ?? "", year: film?.year ?? null },
      { library, mineOnly: mineOnly || wantsRating, minRating },
    );
  }, [mineOnly, library, minRating, minImdb]);

  // The address bar follows the map, so whatever is on screen can be sent to somebody.
  // `replaceState`, never `pushState`: a map is dragged continuously and every nudge would
  // otherwise become a history entry the back button has to walk through.
  //
  // **One writer, and that is load-bearing.** The filters had an effect of their own, and it
  // raced this one: both rebuilt the whole query string, this one ran last, and a link
  // opened with `?imdb=8.5&kind=film` lost both the moment the map settled. The filtered
  // view was applied and then made unshareable one render later.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = mapUrlQuery({
      lat: browseCenter?.[0],
      lng: browseCenter?.[1],
      zoom: mapZoom,
      citySlug: citySlugFromName(cityName),
    });
    if (!query) return;

    // The place first, the filters layered on: two different questions about one map, and
    // the answer to either must survive a change to the other.
    const withFilters = writeFilterParams(query, filters).toString();
    const next = `${window.location.pathname}${withFilters ? `?${withFilters}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [browseCenter, mapZoom, cityName, filters]);

  const filmsHere = useMemo(() => filmsInView(candidatesDrawn), [candidatesDrawn]);
  // Unchecked places the map actually DREW, after "only my films" and the IMDb bar have run
  // in the browser. The console and the layer toggle counted the server's response instead:
  // on production with `imdb=8&kind=film` they read "323" beside "38 films at 87 places in
  // view" — the filter had worked, and the two numbers describing it disagreed by 236.
  const drawnUnchecked = useMemo(
    () => candidatesDrawn.filter((feature) => !feature.properties?.cluster).length,
    [candidatesDrawn],
  );

  // How many of the reader's own films are on the map RIGHT NOW.
  //
  // The chip beside "2,798 movies" counted `libraryFilmIds` — the library matched against
  // `films`, which is the LOCATIONS list, and that list comes from the verified graph: 70
  // places in the whole world. So the owner imported 2,798 films, of which **1,074 have
  // places here and 7,937 points are drawn from them**, and read "3 mapped on map". He
  // concluded the product held nothing of his. The map had been drawing his films the
  // whole time; the number beside the switch was answering a different question.
  //
  // Counted over what the map ACTUALLY draws — the queue pins in view and the located
  // works beside them — and keyed on the matched LIBRARY row, so one film listed by both
  // stores is one film and the two id spaces never double-count.
  const myFilmsInView = useMemo(() => {
    if (library.length === 0) return 0;
    const mine = new Set();
    for (const work of [...filmsHere, ...films]) {
      const entry = libraryEntryFor(work, library);
      if (entry) mine.add(entry.id);
    }
    return mine.size;
  }, [filmsHere, films, library]);

  // What this part of the map is known for. The panel could say how MANY films were in view
  // and never which ones mattered — "994 films · 2,480 places" is a quantity, and the
  // question a visitor arrives with is "what is this place famous for".
  const notable = useMemo(() => notableHere(filmsHere, { limit: 5 }), [filmsHere]);
  // Why "Known for" is empty, when it is. Only meaningful while the queue layer exists at
  // all — with the whole graph layer off there is no map answer to explain.
  const notableEmpty = useMemo(() => (graphLayerOn ? notableEmptyReason({
    notable,
    filmsHere,
    summary: graphSummary,
    candidatesOn,
    activeFilters: narrowing.length,
  }) : null), [graphLayerOn, notable, filmsHere, graphSummary, candidatesOn, narrowing]);


  // Which pins have earned a name. The same ranking the list above uses, spent on the map:
  // a label is scarce on purpose, because a thousand of them is the same as none — they
  // collide, they cover the streets, and the eye has nowhere to land.
  // Spent on the SAME films the list names. It ranked all of `filmsHere` with its own cap,
  // so the map labelled eight films while "Known for" listed five — three names on the
  // streets that the panel beside them never mentioned, from one ranking read twice.
  const pinLabels = useMemo(() => labelledPlaces(notable, { limit: 8 }), [notable]);

  // The coordinates of the film under the pointer, as the same "lat,lng" keys the pin layer
  // uses. A Set rather than a list: a film holds up to 96 places at one address in this data
  // set, and the layer asks "is this pin one of them?" once per pin per frame.
  const highlightedKeys = useMemo(() => {
    if (!highlightedFilm) return null;
    return new Set(
      (highlightedFilm.places ?? [])
        .filter((place) => Number.isFinite(place?.lat) && Number.isFinite(place?.lng))
        .map((place) => `${place.lat},${place.lng}`),
    );
  }, [highlightedFilm]);

  const visibleLocations = useMemo(
    () => sourceLocations.filter((location) =>
      selectedFilms.includes(location.filmId)
        && (!mineOnly || libraryFilmIds.has(location.filmId)),
    ),
    [libraryFilmIds, mineOnly, selectedFilms, sourceLocations],
  );

  // Split once, here, rather than filtered twice in the JSX: a place located only to a city
  // is an AREA and a place located to a doorway is a PIN, and they are different drawings of
  // different claims.
  const areaLocations = useMemo(
    () => visibleLocations.filter((location) => location.display === "area"),
    [visibleLocations],
  );

  // The searched work's places, as GeoJSON for the same pin layer the graph uses. One
  // vocabulary, one renderer — this path used to draw an amber diamond while the graph drew
  // circles, three shapes for one idea, which is the complaint [[map-pin]] exists to answer.
  const searchedPlaceFeatures = useMemo(
    () => visibleLocations
      .filter((location) => location.display !== "area")
      .map((location) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [location.position[1], location.position[0]] },
        properties: {
          key: location.id,
          work_count: 1,
          // Hollow is a claim about evidence, not a style: solid means somebody stated this
          // place belongs to this work, hollow means only that an article mentions it.
          checked: !location.isCandidate,
          narrative: location.kind === "narrative",
        },
      })),
    [visibleLocations],
  );


  // A card filtered out from under the reader closes. It used to open the next place
  // instead — turning "only my films" on opened a sheet about a film nobody had picked.
  useEffect(() => {
    if (!mineOnly || !activeLocation) return;
    if (!visibleLocations.some((location) => location.id === activeLocation.id)) {
      setActiveLocation(null);
    }
  }, [activeLocation, mineOnly, visibleLocations]);

  // Places and films counted apart (#160). The panel used to say only how many rows it was
  // listing, so "we hold little here" and "you are zoomed too far out" looked identical.
  // The list and its heading are ONE truth. Counting the viewport while listing the whole
  // selection put "6 places from 4 films" above ten rows, which is a header contradicting
  // the thing it heads.
  const locationsInView = useMemo(
    () => filterInView(visibleLocations, mapBounds),
    [mapBounds, visibleLocations],
  );
  const inView = useMemo(() => countInView(visibleLocations, mapBounds), [mapBounds, visibleLocations]);

  // The card reopens on Details whenever the place changes: leaving it on Route means
  // clicking a new pin shows route controls where the sentence about the place should be.
  useEffect(() => {
    setPlaceTab(tabForLocation(DEFAULT_PLACE_TAB, true));
    setCopiedCoordinate(false);
    setCheckInNote(null);
  }, [activeLocation?.id]);

  function updateMarks(next) {
    setPlaceMarks(next);
    saveMarks(window.localStorage, next);
  }

  // A check-in's outcome, with the achievement it unlocked said at the moment it happens.
  function recordCheckIn({ marks, result }) {
    const before = achievementsOf(placeMarks).map((achievement) => achievement.id);
    if (marks !== placeMarks) updateMarks(marks);
    const unlocked = achievementsOf(marks).filter((achievement) => !before.includes(achievement.id));
    setCheckInNote([checkInMessage(result), ...unlocked.map((achievement) => `Achievement unlocked: ${achievement.title}.`)].join(" "));
  }

  // "I'm here" asks for a fresh, precise position rather than trusting the last one: the
  // last one may be the demo location, or from before the walk.
  function checkInHere(location) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setCheckInNote(checkInMessage({ status: "no_position" }));
      return;
    }
    setCheckingIn(true);
    setCheckInNote(null);
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        const coords = [fix.coords.latitude, fix.coords.longitude];
        setUserPosition(coords);
        setUserIsDemo(false);
        recordCheckIn(checkIn(placeMarks, location, { coords, accuracy: fix.coords.accuracy }));
        setCheckingIn(false);
      },
      (error) => {
        setCheckInNote((GEOLOCATION_ERRORS[error.code] ?? GEOLOCATION_ERRORS[2]).message);
        setCheckingIn(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  const activeCoordinate = coordinateToCopy(activeLocation);
  const activeRoute = routeTabState({ location: activeLocation, stops: routeStops });

  // `navigator.clipboard` is undefined outside a secure context and rejects when the
  // document is not focused, so the failure is real and is reported rather than swallowed:
  // a copy button that silently does nothing is worse than one that says it could not.
  const [copyFailed, setCopyFailed] = useState(false);
  async function copyCoordinate() {
    if (!activeCoordinate) return;
    try {
      await navigator.clipboard.writeText(activeCoordinate);
      setCopyFailed(false);
      setCopiedCoordinate(true);
    } catch {
      setCopiedCoordinate(false);
      setCopyFailed(true);
    }
  }

  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return library;
    return library.filter((movie) =>
      `${movie.title} ${movie.year ?? ""} ${(movie.sources ?? []).join(" ")}`.toLowerCase().includes(query),
    );
  }, [library, libraryQuery]);

  const routePositions = routeResult?.positions ?? [];
  // Stops are built from places ALREADY on the map, keyed by normalised name — the
  // trail extractor is forbidden from emitting coordinates, so a scene only becomes a
  // stop when it matches a place we independently hold.
  const trailStopList = useMemo(() => {
    if (trailScenes.length === 0) return [];
    const byNorm = new Map(
      trailPlaces.map((place) => [normalizePlaceName(place.name), {
        id: place.id, name: place.name, lat: place.lat, lng: place.lng,
        // Without these the walkability check had nothing to read and failed every stop.
        precision: place.precision, osm_building_id: place.osm_building_id,
        sentence: place.sentence,
      }]),
    );
    return trailStops(
      trailScenes.map((scene) => ({ ...scene, place_norm: normalizePlaceName(scene.place_name) })),
      byNorm,
    );
  }, [trailScenes, trailPlaces]);

  // What walk mode actually walks. The story trail is the richer answer — stops in
  // PLOT order — but it needs every scene resolved to a place we hold, which is not
  // true yet for any work. Walking between a film's real locations is useful on its
  // own, so that is the fallback rather than showing nothing: the feature works today
  // and gets better when the trail fills in.
  // Whether walkStops is the story trail (plot order, followed in order) or the film's
  // place list (no order; the next stop is the nearest).
  // Only somewhere you can walk TO. Routing a walker to a city centroid would send
  // them to an arbitrary point that no scene happened at.
  //
  // A trail across cities is walked one city at a time (#74): the order switch, its note
  // and the walk all work inside the chosen chapter.
  const trailChapterList = useMemo(() => trailChapters(trailStopList, { cities: ALL_CITIES }), [trailStopList]);
  const activeChapter = trailChapterList[trailChapterIndex ?? defaultChapter(trailChapterList, isWalkableStop)] ?? null;
  const walkableTrail = useMemo(
    () => (activeChapter?.stops ?? trailStopList).filter(isWalkableStop),
    [activeChapter, trailStopList],
  );
  const walkStopsAreStory = useMemo(() => trailStopList.some(isWalkableStop), [trailStopList]);
  // Two stops are one walk either way round; the switch is offered from three.
  const trailOrderable = walkableTrail.length >= 3;
  const walkStops = useMemo(() => {
    // A chapter with nothing walkable walks nothing, rather than another chapter's places.
    if (walkStopsAreStory) return orderTrail(walkableTrail, trailOrderable ? trailOrder : TRAIL_ORDER.story);
    // The same rule for the fallback. It was applied to the story trail only, so a
    // film's list of places walked the reader to "London" — the city's centroid.
    return trailPlaces
      .filter((place) => place.role === "on_location" && isWalkableStop(place))
      .map((place, index) => ({
        id: place.id,
        sequence_index: index + 1,
        place: place.name,
        position: [place.lat, place.lng],
        sentence: place.sentence ?? null,
      }));
  }, [walkStopsAreStory, walkableTrail, trailOrderable, trailOrder, trailPlaces]);

  const scrubList = useMemo(() => scrubStops(trailStopList), [trailStopList]);
  const scrubbedStop = trailScrub === null ? null : scrubList[scrubIndex(trailScrub, scrubList.length)] ?? null;
  function scrubTo(value) {
    const index = scrubIndex(value, scrubList.length);
    setTrailScrub(index);
    if (scrubList[index]) setMapCenter(scrubList[index].position);
  }

  // Share the trail (#77). The link is the page's own address, which already names the
  // work and the map, plus the order; the spoiler switch is never in it.
  const trailTitle = graphWorks.find((work) => work.work_id === graphWorkId)?.title ?? null;
  async function shareTrail() {
    const url = trailShareUrl(window.location.href, { order: trailOrderable ? trailOrder : TRAIL_ORDER.story });
    const title = trailTitle ? `${trailTitle} · story trail` : "Story trail";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        setTrailShareNote("");
        return;
      }
      await navigator.clipboard.writeText(url);
      setTrailShareNote("Link copied. It opens without spoilers.");
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (error?.name !== "AbortError") setTrailShareNote("The link could not be copied.");
    }
  }

  function downloadTrail() {
    const blob = new Blob([JSON.stringify(trailGeoJson({ title: trailTitle, stops: trailStopList }), null, 2)], { type: "application/geo+json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = trailFileName(trailTitle);
    link.click();
    URL.revokeObjectURL(href);
  }

  // The walking order on the streets: each stretch a person walks is asked of the same
  // router every other walk uses, and the legs between stretches are rides, drawn as such.
  const walkingTrail = trailOrderable && trailOrder === TRAIL_ORDER.walk ? walkStops : null;
  useEffect(() => {
    if (!walkingTrail) { setTrailWalk({ routes: [], rides: [] }); return undefined; }
    let current = true;
    const { runs, rides } = walkRuns(walkingTrail);
    const ridePositions = rides.map(([from, to]) => [from.position, to.position]);
    setTrailWalk({ routes: runs.map(makeFallbackRoute), rides: ridePositions });
    Promise.all(runs.map((run) => requestWalkingRoute(run).catch(() => makeFallbackRoute(run))))
      .then((routes) => { if (current) setTrailWalk({ routes, rides: ridePositions }); });
    return () => { current = false; };
  }, [walkingTrail]);

  // One selected work, one trail — and it keys off the GRAPH layer's work id, not the
  // live chips. Only a grounded work has scenes and a uuid; a live chip carries a
  // Wikidata id or a synthetic slug, which /api/trail rightly refuses.
  useEffect(() => {
    if (!graphWorkId) { setTrailScenes([]); setTrailPlaces([]); return undefined; }

    const controller = new AbortController();
    (async () => {
      try {
        // The scenes give the story ORDER; the profile gives the places their
        // coordinates. Neither invents one: the extractor has no coordinate field at
        // all, so a scene becomes a stop only by matching a place we already hold.
        // READS the scenes, never triggers extraction. /api/trail runs a model call
        // and now requires the enrichment token, which a browser must never hold —
        // the guard caught this the moment it went in. /api/scenes is the read side,
        // and it is spoiler-safe by default: a withheld scene arrives with no
        // coordinates at all, so it simply cannot become a stop.
        const [trail, profile] = await Promise.all([
          fetch(`/api/scenes?workId=${encodeURIComponent(graphWorkId)}${trailSpoilers ? "&progress=9999" : ""}`, { signal: controller.signal }),
          fetch(`/api/work?id=${encodeURIComponent(graphWorkId)}`, { signal: controller.signal }),
        ]);
        const scenes = trail.ok ? (await trail.json()).scenes ?? [] : [];
        const places = profile.ok ? (await profile.json()).places ?? [] : [];
        setTrailScenes(Array.isArray(scenes) ? scenes : []);
        setTrailPlaces(places.filter((place) => place.lat !== null && place.lng !== null));
      } catch (error) {
        // Most works have no trail extracted yet; that is an ordinary outcome.
        if (error?.name !== "AbortError") { setTrailScenes([]); setTrailPlaces([]); }
      }
    })();
    return () => controller.abort();
  }, [graphWorkId, trailSpoilers]);

  const activeFilmFrames = activeLocation?.backdrop && activeLocation?.backdropVerified
    ? [{
        url: activeLocation.backdrop,
        sourceUrl: null,
        locationName: activeLocation.place,
        locationType: "other",
        description: activeLocation.description ?? "",
      }]
    : filmImageState.locationId === activeLocation?.id
      ? filmImageState.frames
      : [];
  const activePrimaryFrame = activeFilmFrames[0] ?? null;
  const activeFilmImage = activePrimaryFrame?.url
    ?? (filmImageState.locationId === activeLocation?.id ? filmImageState.url : null);
  const activeFilmImageStatus = activeLocation?.backdrop && activeLocation?.backdropVerified
    ? "ready"
    : filmImageState.locationId === activeLocation?.id
      ? filmImageState.status
      : activeLocation?.filmTmdbId ? "loading" : "unavailable";
  const activeFilmImageSource = activePrimaryFrame?.sourceUrl
    ?? (filmImageState.locationId === activeLocation?.id ? filmImageState.sourceUrl : null);
  const activeNarration = aiTour?.stops?.find(
    (stop) => stop.locationId === activeLocation?.id,
  )?.narration;

  const nearby = useMemo(
    () => (userPosition ? findNearby(userPosition, visibleLocations, nearbyRadius) : null),
    [nearbyRadius, userPosition, visibleLocations],
  );

  function locateMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNearbyStatus("unavailable");
      setNearbyMessage("This browser has no geolocation. Use the demo location instead.");
      return;
    }

    setNearbyStatus("locating");
    setNearbyMessage("");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setUserPosition([result.coords.latitude, result.coords.longitude]);
        setUserIsDemo(false);
        setNearbyStatus("ready");
        setNearbyMessage("");
      },
      (error) => {
        const known = GEOLOCATION_ERRORS[error.code] ?? GEOLOCATION_ERRORS[2];
        setNearbyStatus(known.status);
        setNearbyMessage(known.message);
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 8_000 },
    );
  }

  function useDemoLocation() {
    setUserPosition(DEMO_LOCATION.position);
    setUserIsDemo(true);
    setNearbyStatus("ready");
    setNearbyMessage("");
  }

  function invalidateRoute() {
    routeRequestId.current += 1;
    setRouteResult(null);
    setRouteStatus("idle");
    setRouteMessage("");
  }

  // The two tours, cleared the same way everywhere they are cleared (#82).
  function resetAiTour() {
    setAiTour(null);
    setAiTourStatus("idle");
    setAiTourError("");
  }

  function resetTimedTour() {
    setTimedTour(null);
    setTimedTourStatus("idle");
    setTimedTourMessage("");
  }

  function toggleFilm(filmId) {
    resetAiTour();
    resetTimedTour();
    setSelectedFilms((current) => {
      const next = current.includes(filmId)
        ? current.filter((id) => id !== filmId)
        : [...current, filmId];

      return next.length ? next : current;
    });
  }

  function addRouteStop(location) {
    if (routeStops.some((stop) => stop.id === location.id) || routeStops.length >= 5) return;

    resetAiTour();
    // Functional, because two taps inside one render both read the same `routeStops` and
    // the second overwrites the first: adding three stops quickly added one.
    setRouteStops((current) => (current.some((stop) => stop.id === location.id)
      ? current
      : [...current, location]));
    invalidateRoute();
  }

  function removeRouteStop(locationId) {
    resetAiTour();
    setRouteStops((current) => current.filter((stop) => stop.id !== locationId));
    invalidateRoute();
  }

  function selectConnector(connector) {
    setPendingConnector(connector);
    setImportMessage("");
    if (connectorInputRef.current) {
      // What this service hands you, declared once in [[media-sources]] rather than as a
      // ternary that has to be found and widened every time a service is added.
      connectorInputRef.current.accept = mediaSource(connector)?.accept ?? ".csv,text/csv";
      connectorInputRef.current.click();
    }
  }

  // Hand this account's access token to an agent, and say what it is worth.
  //
  // With it, `POST /api/trip/plan { useStoredLibrary: true }` plans from the films on this
  // account instead of the caller carrying every title. It is a short-lived credential —
  // Supabase issues it for an hour by default — and anybody holding it can read this
  // library, so the button says both rather than leaving a person to find out.
  async function copyApiToken() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 4000);
    } catch {
      // A clipboard a browser refuses is not an error worth a dialog; the token is still
      // reachable from the session, and saying nothing is better than a failure the
      // reader cannot act on.
      setTokenCopied(false);
    }
  }

  async function signInWithProvider(provider) {
    if (!supabase) {
      setCloudStatus("Supabase Auth is not configured.");
      return;
    }

    setAccountStatus("authorizing");
    setCloudStatus(`Opening ${provider === "google" ? "Google" : "Facebook"}…`);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });

    if (error) {
      setAccountStatus("signed_out");
      setCloudStatus("Sign-in could not be started. Please try again.");
    }
  }

  // The second way in (#108): a link by email, which needs no OAuth client of its own.
  async function sendEmailLink(event) {
    event.preventDefault();
    if (!supabase) {
      setCloudStatus("Supabase Auth is not configured.");
      return;
    }
    const email = signInEmail(signInAddress);
    if (!email) {
      setCloudStatus("Enter the email address the link should go to.");
      return;
    }

    setAccountStatus("authorizing");
    setCloudStatus(`Sending a sign-in link to ${email}…`);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    // Nobody is signed in until the link is opened, so the panel goes back to waiting.
    setAccountStatus("signed_out");
    setCloudStatus(emailLinkMessage(email, error));
  }

  async function signOut() {
    if (!supabase) return;
    setCloudStatus("Signing out…");
    const { error } = await supabase.auth.signOut();
    if (error) setCloudStatus("Sign-out failed. Please try again.");
  }

  async function importLibrary(event) {
    const file = event.target.files?.[0];
    if (!file || !pendingConnector) return;

    try {
      const isZip = file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
      if (isZip && !mediaSource(pendingConnector)?.archive) {
        throw new Error(`${mediaSourceLabel(pendingConnector) ?? "This service"} exports a CSV, not a ZIP.`);
      }

      const imported = isZip
        ? await parseLetterboxdArchive(await file.arrayBuffer(), file.size)
        : parseMediaCsv(await file.text(), pendingConnector);
      const nextLibrary = mergeLibraries(library, imported);
      const inCity = films.filter((film) => workIsInLibrary(film, nextLibrary)).length;
      setLibrary(nextLibrary);
      setMineOnly(true);

      // Against the CATALOGUE, not against the city in view. Comparing 2,422 titles with
      // the eleven films the map happened to be drawing in London is how this reported
      // "0 mapped titles" for a library we hold hundreds of.
      //
      // The catalogue is fetched rather than the library posted, because the panel below
      // promises the file never leaves the browser and it must stay true.
      const noun = libraryNoun(nextLibrary);
      setImportMessage(`${nextLibrary.length} ${noun} imported. Checking them against the catalogue…`);
      try {
        const response = await fetch("/api/catalogue");
        if (!response.ok) throw new Error(`catalogue ${response.status}`);
        const { works: catalogue } = await response.json();
        const held = matchLibrary(nextLibrary, catalogue);
        setImportMessage(libraryImportSummary({
          imported: nextLibrary.length,
          works: held.works,
          places: held.places,
          cityName,
          inCity,
          noun,
        }));
      } catch {
        // The import itself succeeded; only the count against the catalogue did not. Say
        // that, rather than reporting a zero we did not measure.
        setImportMessage(`${nextLibrary.length} ${noun} imported. The catalogue could not be reached, so we cannot say yet how many of them we hold. ${inCity} of them are on the map in ${cityName}.`);
      }
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "The file could not be imported.");
    } finally {
      event.target.value = "";
      setPendingConnector(null);
    }
  }

  function clearLibrary() {
    setLibrary([]);
    setMineOnly(false);
    setImportMessage("Your local movie list was cleared.");
  }

  async function requestWalkingRoute(stops) {
    const response = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stops: stops.map((stop) => stop.position) }),
    });
    const payload = await response.json().catch(() => ({}));

    if (
      !response.ok ||
      !Array.isArray(payload?.positions) ||
      payload.positions.length < 2 ||
      !Number.isFinite(payload?.distanceKm) ||
      !Number.isFinite(payload?.durationMinutes)
    ) {
      throw new Error(payload?.error || "Walking route response is invalid");
    }

    return payload;
  }

  // The walk, written down at the one moment we know the reader committed to it. The
  // service worker keeps what the phone FETCHED; this keeps what the reader was doing, so
  // a tab evicted in a pocket does not come back as an empty map with a search box.
  function rememberWalk(stops, route) {
    if (typeof window === "undefined") return;
    const walk = freezeWalk({ stops, route, cityName });
    if (walk) saveWalk(window.localStorage, walk);
    keepTilesForWalk(route);
  }

  // The tiles along the route, fetched once so the service worker has them before the walk
  // does. The cache covers ground already panned over; a route is precisely the ground that
  // has not been — four stops seen as pins on a zoomed-out map.
  //
  // Skipped outright when the reader has asked their phone to save data: keeping a walk is
  // worth about 100 kB on a London route, and it is still not ours to spend unasked.
  function keepTilesForWalk(route) {
    const positions = route?.positions ?? [];
    if (!mapApi || positions.length < 2) return;
    if (typeof navigator !== "undefined" && navigator.connection?.saveData === true) {
      setKeptTiles({ skipped: "save_data" });
      return;
    }

    setKeptTiles({ working: true });
    keepTheWalk(mapApi, positions)
      .then((result) => setKeptTiles(result))
      // A prefetch that fails costs nothing that was not already lost: the walk asks for
      // those tiles on the day, exactly as it did before this existed.
      .catch(() => setKeptTiles({ kept: 0, failed: 0, reason: "unavailable" }));
  }

  // Hand the walk to the reader's own maps app (#191): a GPX file for anything that
  // navigates offline. The Google Maps link is a plain anchor in the panel.
  function downloadRouteGpx() {
    const gpx = routeGpx({
      name: cityName ? `GloryMap walk · ${cityName}` : "GloryMap walk",
      stops: routeStops,
      track: routeResult?.positions ?? [],
    });
    const href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = gpxFileName(cityName);
    link.click();
    URL.revokeObjectURL(href);
  }

  async function buildRoute(stops = routeStops) {
    const requestId = routeRequestId.current + 1;
    routeRequestId.current = requestId;
    setRouteResult(null);
    setRouteStatus("loading");
    setRouteMessage("");

    try {
      const payload = await requestWalkingRoute(stops);

      if (requestId !== routeRequestId.current) return;

      setRouteResult(payload);
      setRouteStatus("ready");
      rememberWalk(stops, payload);
    } catch {
      if (requestId !== routeRequestId.current) return;

      const fallback = makeFallbackRoute(stops);
      setRouteResult(fallback);
      setRouteStatus("fallback");
      rememberWalk(stops, fallback);
      setRouteMessage(
        "Walking directions are unavailable, so the stops are connected directly.",
      );
    }
  }

  // What OSM says about getting in, for the stops a tour might use. Asked once per
  // build and never per pin: Overpass runs on donated hardware, and the answer only
  // changes a route, which is the only place we make a promise about a door.
  //
  // Every failure — a busy Overpass, a rejected batch, a network drop — resolves to no
  // knowledge rather than to "open". The tour then reads exactly as it did before this
  // existed, with the stops marked unconfirmed.
  async function loadAccess(locations) {
    const places = locations.slice(0, MAX_PLACES_PER_QUERY).map((location) => ({
      id: location.locationId ?? location.id,
      name: location.place,
      lat: location.position[0],
      lng: location.position[1],
    }));
    if (places.length === 0) return null;

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places }),
      });
      if (!response.ok) throw new Error(`access responded ${response.status}`);
      const payload = await response.json();
      return Object.fromEntries((payload.places ?? []).map((record) => [record.id, record]));
    } catch {
      return null;
    }
  }

  async function buildTimedTour() {
    setTimedTour(null);
    setTimedTourStatus("loading");
    setTimedTourMessage("Checking which of these you can actually get into...");

    // Only the places a walk could plausibly use are worth asking about — the batch is
    // bounded, and a stop 300 km away was never going to be in a 60-minute tour.
    const nearestFirst = [...visibleLocations].sort((left, right) =>
      haversineKm(browseCenter, left.position) - haversineKm(browseCenter, right.position));
    const access = await loadAccess(nearestFirst);
    setTourAccess(access);

    const candidates = createTimedTourCandidates(
      visibleLocations,
      browseCenter,
      tourBudget,
      { access },
    );

    if (candidates.length === 0) {
      setTimedTour(null);
      setTimedTourStatus("error");
      setTimedTourMessage(
        "Select films with at least three nearby locations for this time budget.",
      );
      return;
    }

    setTimedTour(null);
    setTimedTourStatus("loading");
    setTimedTourMessage("Checking nearby walking routes...");

    const picked = await pickRouteThatFitsBudget(candidates, tourBudget, {
      requestRoute: requestWalkingRoute,
      fallbackRoute: makeFallbackRoute,
    });
    if (!picked) {
      setTimedTourStatus("error");
      setTimedTourMessage(
        `No three-stop walk fits ${tourBudget} minutes near this location. Try a larger budget.`,
      );
      return;
    }
    const { plan: selectedPlan, route: plannedRoute, usedRouteFallback } = picked;

    setTimedTourMessage("Writing short stories for the selected stops...");
    const { guide, usedAiFallback } = await fetchTimedTourGuide(selectedPlan.stops, {
      city: cityName,
      budgetMinutes: tourBudget,
    });

    const unconfirmed = selectedPlan.stops.filter(
      (stop) => !isRoutable(access?.[stop.locationId ?? stop.id]),
    ).length;

    setTimedTour({
      budgetMinutes: tourBudget,
      guide,
      route: plannedRoute,
      stops: selectedPlan.stops,
      usedAiFallback,
      usedRouteFallback,
      unconfirmed,
    });
    setTimedTourStatus("ready");
    setTimedTourMessage(
      [
        // Said before the pleasantries, because it is the sentence that decides whether
        // somebody walks half an hour to a locked gate. A route is a promise about a
        // specific day, and this is the part of it we cannot make.
        unconfirmed
          ? `${unconfirmed} of ${selectedPlan.stops.length} stops: we have not confirmed you can get in. Check before you go.`
          : null,
        usedAiFallback ? "AI was unavailable, so verified location descriptions were used." : null,
        usedRouteFallback ? "Walking directions were estimated because the router was unavailable." : null,
      ].filter(Boolean).join(" "),
    );
  }

  async function startTimedTour() {
    if (!timedTour) return;

    const filmIds = [...new Set(
      timedTour.stops.flatMap((stop) => stop.filmIds ?? [stop.filmId]),
    )];
    setSelectedFilms(filmIds);
    setRouteStops(timedTour.stops);
    setActiveLocation(timedTour.stops[0]);
    setAiTour({ ...timedTour.guide, timed: true });
    setAiTourStatus("success");
    setAiTourError("");
    await buildRoute(timedTour.stops);
  }

  async function buildAiTour() {
    const film = films.find((item) => item.id === tourFilmId);
    const filmLocations = sourceLocations
      .filter((location) => location.filmId === tourFilmId)
      .slice(0, 5);

    if (!film || filmLocations.length === 0) {
      setAiTourStatus("error");
      setAiTourError("No verified locations are available for this story yet.");
      return;
    }

    setAiTour(null);
    setAiTourStatus("loading");
    setAiTourError("");

    try {
      const response = await fetch("/api/tour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: cityName,
          film: {
            id: film.id,
            title: film.title,
            year: film.year ?? null,
            kind: film.kind ?? "film",
          },
          locations: filmLocations.map(({ id, place, scene, description }) => ({
            id,
            place,
            scene,
            description,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Could not build the AI tour.");
      }

      const locationsById = new Map(filmLocations.map((location) => [location.id, location]));
      const orderedStops = payload.stops.map((stop) => locationsById.get(stop.locationId));

      if (orderedStops.some((stop) => !stop)) {
        throw new Error("The AI returned an unknown route stop.");
      }

      setSelectedFilms([tourFilmId]);
      setRouteStops(orderedStops);
      setActiveLocation(orderedStops[0]);
      setAiTour(payload);
      setAiTourStatus("success");

      if (orderedStops.length > 1) {
        await buildRoute(orderedStops);
      } else {
        invalidateRoute();
      }
    } catch (error) {
      setAiTour(null);
      setAiTourStatus("error");
      setAiTourError(error instanceof Error ? error.message : "Could not build the AI tour.");
    }
  }

  function selectTourArea(center, name, { radiusKm = 15, wikidataId = null } = {}) {
    preserveViewportContext.current = false;
    setMapCenter(center);
    setBrowseCenter(center);
    setBrowseRadius(Math.min(radiusKm, 10));
    setCityName(name);
    setCityRadius(radiusKm);
    setCityWikidataId(wikidataId);
    setWorkQuery("");
    setLiveLocations([]);
    setActiveLocation(null);
    setRouteStops([]);
    resetAiTour();
    resetTimedTour();
    setLocationsStatus(`Finding ${workKind === EVERY_KIND ? "places" : `${workKindLabel(workKind)} locations`} in ${name}…`);
    invalidateRoute();
  }

  // Fly the map to a coordinate the panel is pointing at, without answering any of the
  // other questions on this surface: the city, the radius and the search all stay as they
  // were. `activeLocation` is cleared because it outranks `mapCenter` in what the map pans
  // to, so leaving an old card selected would swallow the move silently.
  function showOnMap(position) {
    if (!Array.isArray(position) || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) return;
    preserveViewportContext.current = true;
    setActiveLocation(null);
    setMapCenter(position);
  }

  function refreshVisibleMap({ center, radiusKm, zoom }) {
    preserveViewportContext.current = true;
    // Only a CHANGE is a new question. The map reports its view on load and again after the
    // opening pan, with the same centre both times; a fresh array is a new dependency to
    // React, so /api/locations went out twice for one unchanged view on every page load.
    setBrowseCenter((current) => (
      Array.isArray(current) && current[0] === center[0] && current[1] === center[1] ? current : center
    ));
    setBrowseRadius(radiusKm);
    if (Number.isFinite(zoom)) setMapZoom(zoom);
    // The title deliberately SURVIVES a viewport change. It used to be cleared here,
    // which broke the thing zooming is for: searching a work and then widening the view
    // dropped the work and fell back to a generic nearby search, instead of showing
    // more of what was asked about. A pan or a zoom changes WHERE the question is
    // asked, never WHAT was asked.
  }

  function changeWorkKind(nextKind) {
    preserveViewportContext.current = false;
    setWorkKind(nextKind);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setCitySearchStatus("Location access is unavailable in this browser");
      return;
    }

    setCitySearchStatus("Finding your location...");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserPosition([coords.latitude, coords.longitude]);
        setUserIsDemo(false);
        setNearbyStatus("ready");
        setNearbyMessage("");
        selectTourArea([coords.latitude, coords.longitude], "Your location");
        setCitySearchStatus("");
      },
      () => setCitySearchStatus("Location access was not granted"),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 },
    );
  }

  async function searchWork(event) {
    event.preventDefault();
    const query = workQuery.trim();
    if (!query) {
      setLocationsStatus("Enter a film, series, or book title.");
      return;
    }

    const requestId = locationRequestId.current + 1;
    locationRequestId.current = requestId;
    setLocationsStatus(`Finding every mapped place for “${query}” in ${cityName}…`);

    try {
      const params = new URLSearchParams({
        q: query,
        kind: workKind,
        lat: String(mapCenter[0]),
        lng: String(mapCenter[1]),
        radius: String(cityRadius),
        limit: "30",
      });
      if (cityWikidataId) params.set("exclude", cityWikidataId);
      const response = await fetch(`/api/locations?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Location search failed");
      if (requestId !== locationRequestId.current) return;

      const nextLocations = locationsFromApi(payload.locations ?? []);
      const matchedWork = payload.matched_work;
      const matchedTitle = matchedWork?.label ?? nextLocations[0]?.film ?? query;
      applyLocationResults(nextLocations, { openFirst: true });

      // A title is not a question about the city on screen. Searching "Notting Hill"
      // while looking at Paris used to return an empty map — not because the film's
      // places are unknown, but because they are in London. The server now returns
      // them wherever they are, so the map goes to them.
      const here = Number(payload.here ?? nextLocations.length);
      const elsewhere = nextLocations.length - here;

      if (nextLocations.length && here === 0) {
        const [first] = nextLocations;
        setMapCenter(first.position);
        setLocationsStatus(
          `${nextLocations.length} verified ${nextLocations.length === 1 ? "place" : "places"} for ${matchedTitle} — none in ${cityName}, so the map moved to ${first.place}.`,
        );
      } else if (nextLocations.length) {
        setLocationsStatus(
          `${here} verified ${here === 1 ? "place" : "places"} for ${matchedTitle} in ${cityName}`
          + (elsewhere > 0 ? `, and ${elsewhere} elsewhere.` : "."),
        );
      } else {
        setLocationsStatus(`No verified ${workKindLabel(workKind)} locations are mapped for “${query}” anywhere yet.`);
      }

      if (!matchedWork || nextLocations.length >= 3) return;

      setLocationsStatus(
        `${nextLocations.length || "No"} Wikidata ${nextLocations.length === 1 ? "place" : "places"}; checking cited web sources for more…`,
      );
      const discoveryResponse = await fetch("/api/locations/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: {
            name: cityName,
            lat: mapCenter[0],
            lng: mapCenter[1],
            radiusKm: cityRadius,
          },
          work: {
            id: matchedWork.id,
            title: matchedTitle,
            kind: workKind,
          },
          existingLocations: nextLocations.map((location) => ({
            place: location.place,
            lat: location.position[0],
            lng: location.position[1],
            // The entity id, so a place found by both routes is recognised as one place
            // however differently the two sources spelled its name.
            wikidataId: location.locationId ?? null,
          })),
        }),
      });
      const discovery = await discoveryResponse.json().catch(() => ({}));
      if (requestId !== locationRequestId.current) return;
      if (!discoveryResponse.ok) {
        setLocationsStatus(nextLocations.length
          ? `${nextLocations.length} sourced ${nextLocations.length === 1 ? "place" : "places"} for ${matchedTitle}. More research is unavailable right now.`
          : `No sourced places for ${matchedTitle} in ${cityName}; more research is unavailable right now.`);
        return;
      }

      // Already free of duplicates: the server checked every researched place against
      // `existingLocations` — these — and against each other, with isDuplicatePlace (#88).
      const merged = [...nextLocations, ...locationsFromApi(discovery.locations ?? [])];
      applyLocationResults(merged, { openFirst: true });
      // Places the research named but could not pin down. Saying so is the difference
      // between "found one" and "found three, could place one" — only one is true, and
      // silence here reads as the wrong one.
      const unplaced = Array.isArray(discovery.unplaced) ? discovery.unplaced.length : 0;
      const unplacedNote = unplaced
        ? ` ${unplaced} more ${unplaced === 1 ? "was" : "were"} named without a precise enough location to map.`
        : "";
      setLocationsStatus((merged.length > nextLocations.length
        ? `${merged.length} sourced places for ${matchedTitle}: Wikidata plus cited web research.`
        : `${nextLocations.length || "No"} sourced places for ${matchedTitle}; no more were found.`)
        + unplacedNote);
    } catch (error) {
      if (requestId !== locationRequestId.current) return;
      setLocationsStatus(error instanceof Error ? error.message : "Location search failed");
    }
  }

  // The last resort behind the search box: one Nominatim lookup for a name Wikidata
  // could not place, asked for by clicking the row that offers it. Not a type-ahead —
  // that service's terms rule out an auto-complete, and #145 is built on Wikidata for
  // exactly that reason.
  async function lookUpPlace(name) {
    const query = String(name ?? "").trim();
    if (!query) return;

    setCitySearchStatus("Searching city…");
    try {
      const response = await fetch(`/api/cities?q=${encodeURIComponent(query)}`);
      const city = await response.json();
      if (!response.ok) throw new Error(city.error);
      goToCity(city);
    } catch {
      setCitySearchStatus("City not found");
    }
  }

  // Both ways into a city end here: a suggestion picked from the box, and a name the
  // gazetteer had to be asked about. Whichever brought us, the map stops being about
  // where the visitor is standing and starts being about the place they asked for.
  function goToCity(city) {
    setUserPosition(null);
    setUserIsDemo(false);
    setNearbyStatus("idle");
    setNearbyMessage("");
    setCitySearchStatus("");
    selectTourArea([city.lat, city.lng], city.name, {
      radiusKm: city.radius_km ?? 15,
      wikidataId: city.wikidata_id ?? null,
    });
  }

  return (
    <main className={`scene-shell${section === "map" ? "" : " is-in-section"}`}>
      <section className="map-stage" aria-label="GloryMap locations map">
        {/* The furniture every map has, down the right edge where every map puts it.
            Before this the map had NO zoom buttons (`zoomControl={false}` with nothing in
            its place), the only way to re-centre on yourself was three levels down the left
            panel, and the three basemaps sat as a permanent strip across the bottom. One
            layers button with a menu costs a click and gives the bottom of the map back.

            The product's question is not "where is this" but "is this the building I saw in
            the film", and you cannot answer that on a grey street map — so the three layers
            stay three, they just stop being three buttons. */}
        <div className="map-furniture" role="group" aria-label="Map controls">
          <div className="map-furniture-group">
            <button
              type="button"
              className="map-control"
              onClick={() => mapApi?.zoomIn()}
              disabled={!zoom.canZoomIn}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="map-control"
              onClick={() => mapApi?.zoomOut()}
              disabled={!zoom.canZoomOut}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus size={18} aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            className="map-control map-furniture-group"
            onClick={useCurrentLocation}
            aria-label="Centre the map on my location"
            title="My location"
          >
            <LocateFixed size={18} aria-hidden="true" />
          </button>

          <div className="map-furniture-group map-layers">
            <button
              type="button"
              className={`map-control${layersOpen ? " is-on" : ""}`}
              onClick={() => setLayersOpen((open) => !open)}
              aria-expanded={layersOpen}
              aria-label={`Base map: ${activeLayerLabel(MAP_LAYERS, basemap.id)}`}
              title={`Base map: ${activeLayerLabel(MAP_LAYERS, basemap.id)}`}
            >
              <Layers size={18} aria-hidden="true" />
            </button>
            {layersOpen && (
              <div className="map-layers-menu" role="group" aria-label="Base map">
                {layers.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    className={`map-layers-option${layer.id === basemap.id ? " is-active" : ""}`}
                    aria-pressed={layer.id === basemap.id}
                    onClick={() => { chooseBasemap(layer.id); setLayersOpen(false); }}
                  >
                    <strong>{layer.label}</strong>
                    <small>{layer.hint}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* The legend belonged to the map and lived in the left panel, which meant reading
            it required opening a panel that covers the thing it explains. On the map it is
            collapsed to one button by default: it is a thing you consult once and then stop
            needing, so it must not hold a corner of the map open forever. */}
        {graphLayerOn && (
          <div className={`map-key${legendOpen ? " is-open" : ""}`}>
            <button
              type="button"
              className="map-control map-key-toggle"
              onClick={() => setLegendOpen((open) => !open)}
              aria-expanded={legendOpen}
              aria-label={legendOpen ? "Hide what the pins mean" : "What do the pins mean?"}
            >
              <Info size={16} aria-hidden="true" />
              <span>What the pins mean</span>
            </button>
            {legendOpen && (
              <ul className="pin-legend">
                {PIN_LEGEND.map((row) => (
                  <li key={row.text}>
                    {row.kind === "area" ? (
                      <span aria-hidden="true" className="legend-area" />
                    ) : row.kind === "count" ? (
                      <span
                        aria-hidden="true"
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: pinHtml({ filmCount: 12, checked: false }) }}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{
                          __html: pinHtml({
                            filmCount: 1,
                            checked: row.checked,
                            depicts_elsewhere: row.kind === "studio",
                          }),
                        }}
                      />
                    )}
                    <span>{row.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* "Only my films" was a checkbox inside a collapsed panel, under a disclosure, below
            a scroll — the reader had imported 2,422 films and reported he could not find the
            switch that shows them. It is the single most-wanted filter in the product, so it
            is on the map, and it says how many of his films the current view holds. */}
        {library.length > 0 && (
          <button
            type="button"
            className={`map-mine${mineOnly ? " is-on" : ""}`}
            aria-pressed={mineOnly}
            onClick={() => setMineOnly((on) => !on)}
          >
            <Film size={15} aria-hidden="true" />
            Only my films
            <span className="map-mine-count">{mineOnly ? filmsHere.length : library.length}</span>
          </button>
        )}
        {/* minZoom was 11 — a city. You could not zoom out to Britain, so the
            behaviour this whole viewport change exists for was unreachable by
            hand. 5 shows a country; below that the answer stops being a set of
            stops somebody could walk. */}
        {/* `maxZoom` was 17, which stopped the map one or two steps short of the thing it
            is for: standing at a doorway and comparing it with a frame. OSM serves 19 and
            Esri's imagery serves 19, so the map goes to 19 and each layer caps itself at
            what its provider actually has.

            The dark class rides on the container so the CSS can filter the TILE PANE only.
            Passing `className` to <TileLayer> does not survive react-leaflet, and filtering
            the whole container would invert the pins and the route with the tiles. */}
        <MapCanvas
          center={mapCenter}
          zoom={opened?.zoom ?? 12}
          minZoom={3}
          maxZoom={19}
          basemap={basemap}
          onViewport={onMapViewport}
          onBackgroundClick={() => setActiveLocation(null)}
        >
          <ExposeMap onMap={setMapApi} onZoom={setMapZoom} />

          {/* The camera. Panning never changes the zoom — the owner's rule, and absolute:
              clicking a pin used to fly the map and zoom out, moving the thing being clicked
              out from under the cursor. A route is the one exception, because a route you
              cannot see all of is not a route you can follow. */}
          <PanTo position={activeLocation?.position ?? mapCenter} />
          <FitPositions positions={routePositions} />
          {userPosition && <FlyTo position={userPosition} zoom={zoomForRadius(nearbyRadius)} />}

          {userPosition && (
            <>
              <AreaLayer
                id="nearby-radius"
                areas={[{ id: "nearby", position: userPosition, radiusMeters: nearbyRadius }]}
              />
              <MapMarker
                position={userPosition}
                className="user-dot"
                title={userIsDemo ? DEMO_LOCATION.label : "You are here"}
              />
            </>
          )}

          {/* A place the source located only to an island, a county or a city is drawn as the
              area it is. The owner's rule: "we do not include the whole island as a point, but
              as an area where the exact place is not known" — a dot on Istanbul's centre
              invents a doorway that no source ever claimed. */}
          <AreaLayer
            id="place-areas"
            areas={areaLocations.map((location) => ({
              id: location.id,
              position: location.position,
              radiusMeters: areaRadiusMeters(location.precision),
              active: activeLocation?.id === location.id,
            }))}
          />

          <PinLayer
            id="searched-places"
            features={searchedPlaceFeatures}
            selectedKey={activeLocation?.id ?? null}
            onSelect={(properties) => {
              const location = visibleLocations.find((candidate) => candidate.id === properties.key);
              if (location) setActiveLocation(location);
            }}
          />

          {graphLayerOn && (
            <GraphLayer
              kinds={graphKinds.length ? graphKinds : null}
              workId={graphWorkId || null}
              onCandidatesInView={setCandidatesDrawn}
              placeLabels={pinLabels}
              highlightedKeys={highlightedKeys}
              showCandidates={candidatesOn}
              showStudioLots={studioLotsOn}
              isMine={candidateIsMine}
              onSummary={setGraphSummary}
              // Clicking a pin opens its popup and moves nothing. The pin is on screen —
              // that is how it got clicked — and sliding the map out from under the cursor
              // is the behaviour being complained about, not a nicety on top of it.
              onSelect={NOTHING_ON_SELECT}
              // The card answers "what is this?" beside the pin. This is the way into
              // everything else a place holds — the voice guide, the frames, the route —
              // and it is a destination, not the default.
              onOpenPlace={openPlaceFromFeature}
            />
          )}

          {/* Solid: how you get there. The story trail beside it is dashed, because it is how
              the STORY moves, and walking in plot order is the wrong instruction. */}
          <RouteLine
            positions={routePositions}
            dashed={routeResult?.source === "fallback"}
          />

          <StoryTrail
            stops={trailStopList}
            chapters={trailChapterList}
            walkOrder={walkingTrail}
            walk={trailWalk}
            nextStopId={scrubbedStop?.id ?? nextStopId}
            onSelect={(stop) => setMapCenter(stop.position)}
          />
        </MapCanvas>

        {/* Over the map, not inside the panel: a control you need while walking must
            not live in a sheet you have to open first. */}
        <WalkControls
          stops={walkStops}
          ordered={walkStopsAreStory}
          onNextStopChange={setNextStopId}
          onNarrate={(stop) => setMapCenter(stop.position)}
          onAmbientPlace={(place) => setMapCenter(place.position)}
        >
          {/* Only offered when there IS a trail to reveal — an option that does nothing
              is worse than no option. */}
          {trailScenes.length > 0 && (
            <div className="trail-controls" role="group" aria-label="Story trail">
              {trailChapterList.length > 1 && (
                <div className="trail-chapters" role="radiogroup" aria-label="City chapter">
                  {trailChapterList.map((chapter) => (
                    <button
                      key={chapter.index}
                      type="button"
                      role="radio"
                      aria-checked={chapter === activeChapter}
                      className={chapter === activeChapter ? "is-active" : ""}
                      onClick={() => { setTrailChapterIndex(chapter.index); setMapCenter(chapter.centre); }}
                    >
                      {chapter.name} <small>{chapter.stops.length}</small>
                    </button>
                  ))}
                </div>
              )}
              {trailOrderable && (
                <>
                  <div className="trail-order" role="radiogroup" aria-label="Walk the trail in">
                    {[[TRAIL_ORDER.story, "Story order"], [TRAIL_ORDER.walk, "Walking order"]].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={trailOrder === value}
                        className={trailOrder === value ? "is-active" : ""}
                        onClick={() => setTrailOrder(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <small className="trail-order-note">
                    {trailOrderNote(walkableTrail, trailOrder)}
                    {walkingTrail && onFootNote(trailWalk.routes) ? ` ${onFootNote(trailWalk.routes)}` : ""}
                  </small>
                </>
              )}
              <label className="trail-spoilers">
                <input
                  type="checkbox"
                  checked={trailSpoilers}
                  onChange={(event) => setTrailSpoilers(event.target.checked)}
                />
                <span>Show the whole story trail <small>reveals plot order</small></span>
              </label>
              {scrubList.length >= 2 && (
                <label className="trail-scrubber">
                  <input
                    type="range"
                    min="0"
                    max={scrubList.length - 1}
                    step="1"
                    value={scrubIndex(trailScrub ?? 0, scrubList.length)}
                    aria-label="Move through the story"
                    aria-valuetext={scrubLabel(scrubList[scrubIndex(trailScrub ?? 0, scrubList.length)], scrubIndex(trailScrub ?? 0, scrubList.length), scrubList.length)}
                    onChange={(event) => scrubTo(event.target.value)}
                  />
                  <small>
                    {scrubbedStop
                      ? `${scrubLabel(scrubbedStop, scrubIndex(trailScrub, scrubList.length), scrubList.length)}${scrubbedStop.sentence ? `. ${scrubbedStop.sentence}` : ""}`
                      : `Drag through the story, ${scrubList.length} scenes`}
                  </small>
                </label>
              )}
              <div className="trail-share">
                <button type="button" onClick={shareTrail}><Share2 size={14} aria-hidden="true" />Share trail</button>
                <button type="button" onClick={downloadTrail} title="For Google My Maps, uMap or a GPS app"><Download size={14} aria-hidden="true" />GeoJSON</button>
                {trailShareNote && <small role="status">{trailShareNote}</small>}
              </div>
            </div>
          )}
        </WalkControls>
      </section>

      <aside className={`command-panel${panelOpen ? " is-open" : ""}`} aria-label="Story selection">
        <button
          aria-controls="command-panel-body"
          aria-expanded={panelOpen}
          className="panel-handle"
          onClick={() => setPanelOpen((open) => !open)}
          type="button"
        >
          <span className="panel-handle-grip" aria-hidden="true" />
          <span className="panel-handle-label">{panelOpen ? "Hide panel" : "Search & filters"}</span>
        </button>

        {/* The clapperboard that sat here said "films" beside a heading that already
            says it, and ate the width the city name wanted — "Stories on the map · Los
            Angeles" wrapped to three lines because of it. The word is the brand. */}
        {/* The place is the question, so the field for it is the first thing.

            What was here was a brand row — the eyebrow "GloryMap" and the heading "Stories
            on the map · Los Angeles" — above a 1,220 px layers console, with the search box
            1,377 px further down. Every job a visitor has was below the fold, which is the
            measured form of "чёрт ногу сломит". The heading also said the city, which the
            map already shows and the search field now owns. */}
        <div className="ask-row">
        {/* One box for both kinds of answer (#145). It replaced a city field and a title
            field that sat next to each other, each hitting a different service and
            neither able to suggest the other's kind. */}
        <SearchBox
          onChange={setWorkQuery}
          onLookupPlace={lookUpPlace}
          onPickCity={goToCity}
          onPickWork={(suggestion) => {
            // A grounded work is already in the graph: show it on the map instead of
            // re-searching Wikidata for something we have.
            setWorkQuery(suggestion.title);
            setGraphLayerOn(true);
            setGraphWorkId(suggestion.work_id);
            if (suggestion.kind && suggestion.kind !== workKind) changeWorkKind(suggestion.kind);
          }}
          onSubmit={searchWork}
          value={workQuery}
        >
          <select
            aria-label="Work type"
            value={workKind}
            onChange={(event) => changeWorkKind(event.target.value)}
          >
            {/* First and default: the question a visitor arrives with is "what was shot
                around here", not "what films were shot around here". */}
            <option value={EVERY_KIND}>All</option>
            <option value="film">Film</option>
            <option value="series">Series</option>
            <option value="book">Book</option>
          </select>
        </SearchBox>
        {locationsStatus && <p className="location-search-status" role="status">{locationsStatus}</p>}

        {/* Three full-width buttons stood here, 42 px each, one under another.
            "Use my location" was a DUPLICATE of the locate control on the map — the same
            action, twice, and the map is where its effect is visible. The design review
            flagged the pair directly: "«Use my location» and «What's nearby?» are adjacent,
            differently styled, and do different things — nothing on screen distinguishes
            them." One of them was not needed at all.

            The directory keeps its way in — the map answers "what is here", the directory
            answers "what have you got" — but it is a link, not a call to action, and it is
            sized like one. */}
        <a className="directory-link" href="/directory">
          <List size={14} aria-hidden="true" />
          Browse everything we hold
        </a>
        {citySearchStatus && <p className="eyebrow city-search-status">{citySearchStatus}</p>}

        <div className="nearby-card" aria-label="Nearby locations">
          <div className="nearby-actions">
            <button
              className="ghost-button nearby-cta"
              disabled={nearbyStatus === "locating"}
              onClick={locateMe}
              type="button"
            >
              <Crosshair size={17} />
              {nearbyStatus === "locating" ? "Locating..." : "What's nearby?"}
            </button>
            {(nearbyStatus === "denied" ||
              nearbyStatus === "unavailable" ||
              nearbyStatus === "timeout") && (
              <button className="ghost-button" onClick={useDemoLocation} type="button">
                Use demo location
              </button>
            )}
          </div>

          {nearbyMessage && (
            <p className="nearby-status" role="status">{nearbyMessage}</p>
          )}

          {userPosition && (
            <>
              <div className="radius-chips" role="group" aria-label="Search radius">
                {RADIUS_OPTIONS_METERS.map((radius) => (
                  <button
                    aria-pressed={nearbyRadius === radius}
                    className={`radius-chip${nearbyRadius === radius ? " is-selected" : ""}`}
                    key={radius}
                    onClick={() => setNearbyRadius(radius)}
                    type="button"
                  >
                    {formatDistanceMeters(radius)}
                  </button>
                ))}
              </div>

              {nearby?.nearest ? (
                <button
                  className="nearby-result"
                  onClick={() => setActiveLocation(nearby.nearest.location)}
                  type="button"
                >
                  <MapPin size={17} aria-hidden="true" />
                  <span>
                    <strong>{nearby.nearest.location.place}</strong>
                    <small>
                      {nearby.nearest.location.film} ·{" "}
                      {formatDistanceMeters(nearby.nearest.distanceMeters)} away
                      {nearby.nearest.distanceMeters > nearbyRadius
                        ? " · outside radius"
                        : ""}
                    </small>
                  </span>
                </button>
              ) : (
                <p className="nearby-status" role="status">
                  No screen or story locations loaded for this city yet.
                </p>
              )}

              <p className="nearby-count">
                {nearby?.inRadius.length ?? 0} location{(nearby?.inRadius.length ?? 0) === 1 ? "" : "s"} within{" "}
                {formatDistanceMeters(nearbyRadius)}
                {userIsDemo ? ` · ${DEMO_LOCATION.label}` : ""}
              </p>
            </>
          )}
        </div>
          <button
            className={`account-button${accountUser ? "" : " is-login"}`}
            type="button"
            onClick={() => setAccountOpen(true)}
          >
            {accountUser ? <User size={18} /> : null}
            {library.length > 0 ? `My movies · ${library.length}` : "My movies"}
          </button>
        </div>


        {/* One chip per filter, each saying what it keeps and undone by its own ×. It was
            one button reading "Reset 3 filters" — a number, none of the filters, and the
            controls that set them behind a closed disclosure. */}
        {narrowing.length > 0 && (
          <div className="filter-chips" role="group" aria-label="Filters narrowing the map">
            {narrowing.map((key) => {
              const label = filterChipLabel(key, filters, {
                workTitle: graphWorks.find((work) => work.work_id === graphWorkId)?.title ?? null,
              });
              return (
                <button
                  key={key}
                  type="button"
                  className="filter-chip"
                  onClick={() => clearFilter(key)}
                  aria-label={`Remove filter: ${label}`}
                >
                  <span>{label}</span>
                  <X size={13} aria-hidden="true" />
                </button>
              );
            })}
            {narrowing.length > 1 && (
              <button type="button" className="filter-chips-clear" onClick={resetFilters}>Clear all</button>
            )}
          </div>
        )}

        {/* What this place is known for, above everything the reader would have to ask for.
            Ranked by rating AND reach: the rating alone puts a 9.2 with 300 voters above
            Forrest Gump, and the vote count alone ranks by how many watched rather than by
            what is worth walking to. See [[notable-here]] for the arithmetic. */}
        {/* Always mounted. It used to unmount when empty, and the panel around it kept
            asserting content over a map that had drawn nothing — see notableEmptyReason. */}
        {notableEmpty ? (
          <section className="notable-here is-empty" aria-label="Best known here" aria-live="polite">
            <h2>Known for</h2>
            <p className="notable-empty">
              {notableEmpty.text}
              {notableEmpty.code === EMPTY_REASON.filtered_out && (
                <button type="button" className="notable-empty-action" onClick={resetFilters}>Reset filters</button>
              )}
              {notableEmpty.code === EMPTY_REASON.queue_hidden && (
                <button type="button" className="notable-empty-action" onClick={() => setCandidatesOn(true)}>Show them</button>
              )}
            </p>
          </section>
        ) : (
          <section className="notable-here" aria-label="Best known here">
            <h2>Known for</h2>
            <ul>
              {notable.map((film) => {
                const rating = ratingOf(film);
                const place = (film.places ?? []).find(
                  (candidate) => Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng));
                return (
                  <li key={film.work_id ?? film.title}>
                    {/* A row acts on the MAP. It used to be a link to `/work/…`, which took
                        the reader out of the product to read a description of a place they
                        were already looking at — and the row lit up on hover while doing
                        nothing to the map, so it made the same promise the film chips below
                        it keep. Hovering names its pins; clicking flies to one. */}
                    <button
                      type="button"
                      className="notable-row"
                      onMouseEnter={() => setHighlightedFilm(film)}
                      onMouseLeave={() => setHighlightedFilm(null)}
                      onFocus={() => setHighlightedFilm(film)}
                      onBlur={() => setHighlightedFilm(null)}
                      onClick={() => place && showOnMap([place.lat, place.lng])}
                      disabled={!place}
                      title={place ? `Show ${film.title} on the map` : film.title}
                    >
                      <span className="notable-title">{film.title}</span>
                      {film.year ? <span className="notable-year">{film.year}</span> : null}
                      {/* The number, and whose it is. IMDb answers for 5,495 of the works
                          on the map and TMDB for the 122 it has nothing on; a rating whose
                          source is hidden is the same failure as a place without one. IMDb
                          is unmarked because it is the default the filter above names. */}
                      <span className="notable-rating">
                        {rating.score.toFixed(1)}
                        {rating.source !== "imdb" && (
                          <small className="notable-rating-source">{RATING_LABELS[rating.source] ?? rating.source}</small>
                        )}
                      </span>
                    </button>
                    {/* A film seen only on a backlot is a different answer from one seen on
                        the street, and it is said before anybody walks. */}
                    {film.on_a_lot_only && <span className="notable-lot">studio lot</span>}
                  </li>
                );
              })}
            </ul>
            {/* Every row here comes from the queue — the rows our sources name and nobody
                has checked. The panel's most prominent list was the one place the product
                made no claim about its own evidence, which is the same failure as the
                London cover strip in a new shape. */}
            <p className="notable-note">Named by our sources · not checked by us</p>
          </section>
        )}



        {/* The map's own answer to "show me only what I have seen".
            This filter already existed and was correct, and it lived inside the
            account dialog — which an anonymous visitor could not open at all. A
            filter on what the map shows belongs beside the map, next to the works
            it filters. It appears only once there is a list to filter by; an empty
            toggle is a question the visitor cannot answer. */}
        {/* Whether the reader's own list is loaded, said before anything else — the owner
            could not tell whether the map was showing his films or every film we hold, and
            nothing on screen answered it. It is stated when there is a list AND when there
            is not, because "no list yet" is the more confusing of the two silences. */}
        {/* "Only my films" lives ON THE MAP now, and only there. It was in both places,
            which is not a fix — it is an admission that neither location was right. The map
            is where the filter's effect is visible, so that is where the switch belongs. */}

        {/* Order and bar, beside the list they act on. Sorting lives here rather than in
            the queue panel because it orders THESE chips — a control far from the thing
            it changes is a control nobody connects to the change. */}
        <div className="list-controls">
          <label className="list-control">
            <span>Order</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              {/* Offered only with a library to read it from. Without one it would sort
                  every film by null and look broken. */}
              {library.length > 0 && <option value={SORT.rating}>Your rating</option>}
              <option value={SORT.places}>How much we hold</option>
              <option value={SORT.title}>A–Z</option>
            </select>
          </label>

          {/* Two bars, not one. "Films I rated 8 AND the world rated 7.5" is a real
              question and neither answers it alone. The reader's own needs a library;
              IMDb's works for anybody. */}
          {/* Sliders, not fixed steps. "Somewhere around eight" is a real request and a
              list of half-points is not a fine enough answer to it — IMDb publishes tenths
              and the filter can compare them. The reader's own bar steps in whole points,
              because IMDb has no finer rating to give.

              **Zero is the OFF position, to the left of the range**, so the control reads
              as one line from "everything" to "only the best" instead of needing a
              separate Any. `clampImdb` keeps 0 out of the clamp for exactly this. */}
          {library.length > 0 && (
            <label className="list-control is-slider">
              <span>
                Mine
                <strong>{minRating > NO_MINIMUM ? `${ratingLabel(minRating)}+` : "Any"}</strong>
              </span>
              <input
                type="range"
                // One step below the range is the off position, and on a ten-point scale
                // stepping by one that lands exactly on 0 — which is why this bar runs the
                // whole scale where the IMDb one below is narrowed.
                min={MINE_MIN - MINE_STEP}
                max={MINE_MAX}
                step={MINE_STEP}
                value={minRating}
                aria-label="Minimum rating you gave"
                onChange={(event) => setMinRating(clampMine(event.target.value))}
              />
            </label>
          )}

          <label className="list-control is-slider">
            <span>
              IMDb
              <strong>{minImdb > NO_MINIMUM ? `${imdbLabel(minImdb)}+` : "Any"}</strong>
            </span>
            <input
              type="range"
              // The step below the range is the off position; the range itself starts at
              // IMDB_MIN. 1,397 of the rated Los Angeles films clear 5.0 and five clear 9.0,
              // so outside that the slider would be travel with nothing at the end of it.
              min={IMDB_MIN - IMDB_STEP}
              max={IMDB_MAX}
              step={IMDB_STEP}
              value={minImdb > NO_MINIMUM ? minImdb : IMDB_MIN - IMDB_STEP}
              aria-label="Minimum IMDb rating"
              onChange={(event) => {
                const raw = Number(event.target.value);
                setMinImdb(raw < IMDB_MIN ? NO_MINIMUM : clampImdb(raw));
              }}
            />
          </label>

          {/* Only the consequences, and only when there are any. The note used to open by
              repeating the sort select's own current value back at the reader — the one
              line in this panel that failed AA contrast (3.5:1 at 11.5 px) was also the one
              line that said nothing the control beside it did not already say. */}
          {(impliesLibraryOnly(minRating) || Number(minImdb) > NO_MINIMUM) && (
            <small className="list-control-note">
              {impliesLibraryOnly(minRating)
                // Said out loud: a bar on YOUR rating can only describe your list, and a
                // reader who did not expect the map to narrow deserves to know why it did.
                ? `${ratingLabel(minRating)} and up, from your list only`
                : ""}
              {impliesLibraryOnly(minRating) && Number(minImdb) > NO_MINIMUM ? " · " : ""}
              {Number(minImdb) > NO_MINIMUM
                // And the same for the public bar, which also hides every film nobody has
                // rated — 123 of the 1,642 Los Angeles works.
                ? `IMDb ${imdbLabel(minImdb)}+, rated films only`
                : ""}
            </small>
          )}
        </div>

        <div className="film-grid" aria-label="Selected stories">
          {mapFilms.map((film) => {
            const selected = selectedFilms.includes(film.id);
            const poster = filmPosters[posterCacheKey(film)];

            return (
              // Two actions live here — filter the map, and open the film — so the
              // chip is a container rather than one button. Nesting a button inside a
              // button is invalid HTML and the inner click never arrives reliably.
              <div className={`film-chip${selected ? " is-selected" : ""}`} key={film.id}>
                <button
                  className="film-chip-toggle"
                  onClick={() => toggleFilm(film.id)}
                  type="button"
                  aria-pressed={selected}
                >
                  {/* The initials tile is the fallback, not the default: books have no
                      TMDB poster, and a lookup can fail. A broken <img> would be worse
                      than the tile, so a load error falls back to it too. */}
                  {poster && !brokenImages.has(poster.thumb) ? (
                    <img
                      alt=""
                      aria-hidden="true"
                      className="poster-tile poster-tile-art"
                      loading="lazy"
                      src={poster.thumb}
                      // 28 px here, ~84 in the phone's scroller. Without `sizes` the
                      // browser assumes the full viewport and takes the larger file on
                      // every screen, which is the overspend wearing a srcset (#198).
                      srcSet={poster.thumb_srcset ?? undefined}
                      sizes={poster.thumb_srcset ? poster.thumb_sizes : undefined}
                      onError={() => setBrokenImages((current) => new Set(current).add(poster.thumb))}
                    />
                  ) : (
                    <span className="poster-tile" aria-hidden="true">{film.code}</span>
                  )}
                  <span>
                    <strong>{film.title}</strong>
                    <small>
                      <WorkKindMark kind={film.kind} />
                      {film.year ? ` · ${film.year}` : ""}
                      {/* The reader's own score, on the chip. An order nobody can see the
                          key for is indistinguishable from no order at all — and with the
                          list sorted by rating this is the column being sorted. */}
                      {(() => {
                        const mine = libraryRating(film, library);
                        return mine === null
                          ? null
                          : <span className="chip-rating">{" · "}{ratingLabel(mine)}</span>;
                      })()}
                    </small>
                  </span>
                </button>
                {/* Only works with a TMDB id have a profile to open; a book chip would
                    lead to an empty page, so it simply has no button. */}
                {film.tmdbId && (
                  <button
                    aria-label={`About ${film.title}`}
                    className="film-chip-open"
                    onClick={() => setProfileFilm(film)}
                    type="button"
                  >
                    <Info size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <section className="timed-tour-card" aria-labelledby="timed-tour-title">
          <div className="timed-tour-heading">
            <span className="timed-tour-icon" aria-hidden="true"><Clock3 size={18} /></span>
            <div>
              <p className="eyebrow">Area · {cityName}</p>
              <strong id="timed-tour-title">Tour by time and place</strong>
            </div>
          </div>
          <div className="budget-options" role="group" aria-label="Tour time budget">
            {TOUR_BUDGETS.map((minutes) => (
              <button
                className={tourBudget === minutes ? "is-selected" : ""}
                key={minutes}
                type="button"
                aria-pressed={tourBudget === minutes}
                disabled={timedTourStatus === "loading"}
                onClick={() => {
                  setTourBudget(minutes);
                  resetTimedTour();
                }}
              >
                {minutes} min
              </button>
            ))}
          </div>
          <button
            className="timed-tour-button"
            type="button"
            onClick={buildTimedTour}
            disabled={timedTourStatus === "loading" || visibleLocations.length < 3}
          >
            {timedTourStatus === "loading" ? (
              <LoaderCircle className="loading-icon" size={17} />
            ) : (
              <Clock3 size={17} />
            )}
            {timedTourStatus === "loading" ? "Planning..." : "Generate nearby tour"}
          </button>
          {timedTourMessage && (
            <p
              className={`timed-tour-message${timedTourStatus === "error" ? " is-error" : ""}`}
              role={timedTourStatus === "error" ? "alert" : "status"}
            >
              {timedTourMessage}
            </p>
          )}
          {timedTour && (
            <div className="timed-tour-result" aria-live="polite">
              <div>
                <strong>{timedTour.guide.title}</strong>
                <p>{timedTour.guide.intro}</p>
              </div>
              <div className="timed-tour-metrics">
                <span>{timedTour.route.distanceKm.toFixed(1)} km</span>
                <span>{timedTour.route.durationMinutes} min</span>
                <span>{timedTour.stops.length} stops</span>
              </div>
              <ol>
                {timedTour.stops.map((stop) => {
                  const record = tourAccess?.[stop.locationId ?? stop.id];
                  return (
                    <li key={stop.id}>
                      <strong>{stop.place}</strong>
                      <span>{stop.film}</span>
                      {/* Per stop, not only in the summary: "2 of 4 unconfirmed" does
                          not tell you WHICH two, and that is the whole question when
                          you are standing at the bus stop deciding. */}
                      <span className={`access-note${record && isRoutable(record) ? " is-known" : ""}`}>
                        {accessNote(record)}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <button className="start-tour-button" type="button" onClick={startTimedTour}>
                <Route size={17} />
                Start tour
              </button>
            </div>
          )}
        </section>

        {/* "Tour by work" was removed. There were THREE ways to build a walk — by time,
            by work, and by hand — at 2,024 px, 2,202 px and 2,529 px, with no guidance on
            which to use and the manual one disabled without explanation. The route is the
            product; splitting it three ways made the primary outcome the least legible
            thing on the surface. One generator, by time and place, and the manual route
            card below it. */}

        <div className="location-list" aria-label="Map locations">
          <div className="section-row">
            <p className="eyebrow">Locations</p>
            {/* Two numbers, because they answer two different questions (#160): how much
                is drawn, and how many works that came from. One number could not tell a
                thin catalogue from a viewport zoomed too far out. */}
            <span aria-live="polite">{viewCountLabel(inView)} in {cityName}</span>
          </div>
          {/* The distinction the panel could not make before: nothing here because we hold
              nothing, or nothing here because the map is somewhere else. */}
          {locationsInView.length === 0 && visibleLocations.length > 0 && (
            <p className="location-empty" role="status">
              None of the {visibleLocations.length} places for the films you have selected are
              on screen. Zoom out or drag the map to find them.
            </p>
          )}
          {locationsInView.map((location) => (
            <div className="location-row" key={location.id}>
              <button type="button" onClick={() => setActiveLocation(location)}>
                <strong>{location.place}</strong>
                <span>
                  <WorkKindMark kind={location.kind} />{" "}
                  {location.film}
                </span>
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => addRouteStop(location)}
                aria-label={`Add ${location.place} to the route`}
              >
                <Plus size={15} />
              </button>
            </div>
          ))}
        </div>

        {/* A walk that came back from this phone rather than from the network. Said out
            loud, with its age: a route is a plan for an afternoon, and one restored
            silently would be the product asserting where somebody is. */}
        {restoredWalk && (
          <p className="restored-walk" role="status">
            <History size={14} aria-hidden="true" />
            <span>Your walk from {walkAgeLabel(restoredWalk)}, kept on this phone</span>
            <button type="button" onClick={() => {
              clearWalk(window.localStorage);
              setRestoredWalk(null);
              setRouteStops([]);
              invalidateRoute();
            }}>Clear</button>
          </p>
        )}

        {keptTiles && (
          <p className="kept-offline" role="status">
            <Download size={13} aria-hidden="true" />
            {keptTiles.working && <span>Keeping this walk for offline…</span>}
            {keptTiles.skipped === "save_data" && <span>Data saver is on, so the map was not kept for offline.</span>}
            {keptTiles.reason === "no_tile_source" && <span>This basemap cannot be kept offline.</span>}
            {keptTiles.reason === "unavailable" && <span>Could not keep the map for offline; the walk still works online.</span>}
            {keptTiles.reason === null && (
              <span>
                {keptTiles.kept} map {keptTiles.kept === 1 ? "tile" : "tiles"} kept
                {" "}({corridorSizeLabel(keptTiles.kept)}) for this walk
                {keptTiles.failed > 0 && `, ${keptTiles.failed} could not be fetched`}
                {keptTiles.truncated && " — the route is long, so the start is kept"}
              </span>
            )}
          </p>
        )}

        <div className="route-card">
          <div>
            <p className="eyebrow">Route</p>
            <strong>{routeStops.length} / 5 stops</strong>
          </div>
          <button
            className={`primary-button${routeResult ? " is-complete" : ""}`}
            disabled={routeStops.length < 3 || routeStatus !== "idle"}
            onClick={() => buildRoute()}
            type="button"
          >
            <Route size={18} />
            {routeStatus === "loading"
              ? "Building..."
              : routeStatus === "fallback"
                ? "Approximate route"
                : routeResult
                ? "Route ready"
                : "Build route"}
          </button>
        </div>

        {routeStops.length >= 2 && (
          <div className="route-export">
            <a href={googleMapsDirectionsUrl(routeStops) ?? undefined} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden="true" />Open in Google Maps
            </a>
            <button type="button" onClick={downloadRouteGpx} title="For Organic Maps, OsmAnd, Komoot or any GPS app">
              <Download size={14} aria-hidden="true" />GPX
            </button>
          </div>
        )}

        {aiTour && (
          <section className="ai-tour-result" aria-live="polite">
            <p className="eyebrow">Stories at each stop</p>
            <ol>
              {aiTour.stops.map((stop) => {
                const location = sourceLocations.find((item) => item.id === stop.locationId);

                return (
                  <li key={stop.locationId}>
                    <strong>{location?.place}</strong>
                    <span>{stop.narration}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {routeStops.length > 0 && (
          <ol className="route-list">
            {routeStops.map((stop, index) => (
              <li key={stop.id}>
                <button type="button" onClick={() => setActiveLocation(stop)}>
                  <span>{index + 1}</span>
                  {stop.place}
                </button>
                <button className="icon-button" type="button" onClick={() => removeRouteStop(stop.id)} aria-label="Remove stop">
                  <X size={15} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {routeStatus === "loading" && (
          <p className="route-summary" role="status">
            Building a walking route through {cityName}...
          </p>
        )}

        {routeResult && (
          <div
            className={`route-summary${routeResult.source === "fallback" ? " is-fallback" : ""}`}
            role="status"
          >
            <strong>
              {routeResult.distanceKm.toFixed(1)} km on foot · {routeResult.durationMinutes} min
            </strong>
            {routeResult.source === "fallback" ? (
              <span>{routeMessage}</span>
            ) : (
              <span>
                {aiTour?.timed
                  ? "Nearby planner chose the stops · "
                  : aiTour
                    ? "AI chose the stop order · "
                    : ""}
                Route follows mapped streets ·{" "}
                <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">
                  OpenStreetMap routing
                </a>
                {" · "}
                <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">
                  fix the map
                </a>
              </span>
            )}
          </div>
        )}
        {/* The layers console, behind a disclosure and closed by default.

            It was 45% of the panel — 1,220 px of 2,715 — and it was the FIRST thing a
            first-time visitor met, answering none of the questions they arrived with. It is
            an operator's console, and operators can open it. What stays visible is the one
            line that says what the map is currently drawing.

            And it sits LAST, after the route. It was mid-panel, so opening it inserted
            ~750 px between "Known for" and everything a visitor actually reads — the list,
            the tour, the route — which is a smaller version of the very problem the
            disclosure was introduced to solve. */}
        <details className="layers-console" open={layersConsoleOpen} onToggle={(event) => setLayersConsoleOpen(event.currentTarget.open)}>
          <summary className="layers-console-summary">
            <Layers size={15} aria-hidden="true" />
            <span>What the map is drawing</span>
            <span className="layers-console-count">
              {/* It fell back to the bare word "layers" whenever the count was zero or the
                  map had not answered — which read as a label, not as "nothing drawn". */}
              {!graphSummary
                ? "loading…"
                : graphSummary.clustered
                  ? "zoom in"
                  : `${drawnUnchecked} unchecked`}
            </span>
          </summary>
        {/* Two words for the two stores, and only two. The panel used "verified", "grounded",
            "checked", "unchecked" and "candidates" for two ideas, beside "points", "pins" and
            "places" for one — the review counted seven numbers and five nouns describing a
            single map. Checked means checked BY US; unchecked means a source named it. */}
        <section className="graph-layer-panel" aria-label="Checked places layer">
          {/* The work list follows the kind filter, so it can only ever offer works
              that actually have a place to fly to under the current filter. */}
          <button
            className={`graph-toggle${graphLayerOn ? " is-on" : ""}`}
            type="button"
            aria-pressed={graphLayerOn}
            onClick={() => setGraphLayerOn((on) => !on)}
          >
            <Layers size={16} aria-hidden="true" />
            Checked places
            {graphLayerOn && graphSummary ? (
              <span className="graph-count">
                {graphSummary.clustered
                  ? `${graphSummary.count} cluster${graphSummary.count === 1 ? "" : "s"}`
                  : `${graphSummary.count} place${graphSummary.count === 1 ? "" : "s"}`}
              </span>
            ) : null}
          </button>

          {graphLayerOn && (
            <>
              {/* The legend used to be here and is now ON THE MAP, collapsed behind one
                  button — reading it used to mean opening the panel that covers the thing
                  it explains. See `.map-key` in the map stage above. */}
              <div className="graph-filters">
                <div className="kind-chips" role="group" aria-label="Filter by kind">
                  {["film", "series", "book"].map((kind) => {
                    const on = graphKinds.includes(kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        aria-pressed={on}
                        className={`kind-chip${on ? " is-on" : ""}`}
                        onClick={() => {
                          // Changing the kind can orphan the selected work, so clear it.
                          setGraphWorkId("");
                          setGraphKinds((current) =>
                            current.includes(kind)
                              ? current.filter((k) => k !== kind)
                              : [...current, kind],
                          );
                        }}
                      >
                        {kindLabel(kind)}
                      </button>
                    );
                  })}
                </div>
                {/* The cover strip was 442 px tall and 24 targets, and in a Los Angeles
                    view it showed Skyfall, Notting Hill, Roman Holiday and The Third Man —
                    the London demo set, in a city they have nothing to do with. A panel that
                    offers films from somewhere else is not a browsing aid, it is a claim that
                    the map does not know where it is. */}

                <label className="work-filter">
                  <span className="visually-hidden">Show one work</span>
                  <select
                    value={graphWorkId}
                    onChange={(event) => setGraphWorkId(event.target.value)}
                  >
                    <option value="">Whole library ({graphWorks.length})</option>
                    {graphWorks.map((work) => (
                      <option key={work.work_id} value={work.work_id}>
                        {work.title} ({work.place_count})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {(() => {
                const selected = graphWorks.find((work) => work.work_id === graphWorkId);
                if (!selected) return null;
                const ratings = selected.ratings ?? [];
                return (
                  <article className="work-card">
                    {selected.poster_url && (
                      <img alt="" className="work-card-poster" src={selected.poster_url} />
                    )}
                    <div className="work-card-body">
                      <strong>{selected.title}</strong>
                      <span className="work-card-meta">
                        {kindLabel(selected.kind)} · {selected.place_count} places
                      </span>
                      {ratings.length > 0 ? (
                        <ul className="rating-row">
                          {ratings.map((rating) => {
                            const label = RATING_LABELS[rating.source] ?? rating.source;
                            const chip = (
                              <>
                                <span className="rating-source">{label}</span>
                                <span className="rating-score">{rating.display}</span>
                              </>
                            );
                            return (
                              <li key={rating.source} className={`rating-chip is-${rating.source}`}>
                                {/* A score links back to where it came from; without a
                                    link it is just a number we ask people to trust. */}
                                {rating.url ? (
                                  <a href={rating.url} rel="noreferrer noopener" target="_blank">
                                    {chip}
                                  </a>
                                ) : chip}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <span className="work-card-meta">No ratings yet</span>
                      )}
                    </div>
                  </article>
                );
              })()}

              {graphSummary?.count === 0 && graphSummary?.nearest?.length > 0 && (
                <div className="graph-nearest">
                  <p className="graph-note">Nothing grounded in this view. Nearest:</p>
                  <ul>
                    {graphSummary.nearest.map((place) => (
                      <li key={place.place_id}>
                        <button
                          type="button"
                          className="nearest-jump"
                          onClick={() => setMapCenter([place.lat, place.lng])}
                        >
                          {place.name} · {place.distance_km} km
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {graphSummary?.truncated && (
                <p className="graph-note">
                  Showing the first {graphSummary.count} — zoom in for the rest.
                </p>
              )}

              {/* Everything on screen, as a list.
                  The map answers "what happened at THIS point" when a pin is clicked; this
                  answers the other half — what is in this view — which is the question
                  somebody asks while panning across a city. It updates as the map moves,
                  and it lists what was DRAWN, so the studio-lot and library switches above
                  narrow it too. */}
              <FilmsInView
                films={candidatesOn ? filmsHere : EMPTY_FILMS}
                mode={filmsViewMode}
                onMode={setFilmsViewMode}
                onHighlight={setHighlightedFilm}
              />

              {/* What the map may draw beyond the graph.
                  The graph holds 70 places in the world and the queue holds 32,148
                  located rows, so for most of the planet — Los Angeles included — this
                  switch is the difference between an empty map and the product. It stays
                  a switch rather than a default because the two are not the same claim,
                  and the wording under it says which is which. */}
              <div className="candidate-filters">
                <button
                  type="button"
                  className={`graph-toggle${candidatesOn ? " is-on" : ""}`}
                  aria-pressed={candidatesOn}
                  onClick={() => setCandidatesOn((on) => !on)}
                >
                  <Layers size={15} aria-hidden="true" />
                  Unchecked places
                  {candidatesOn && graphSummary ? (
                    <span className="graph-count">
                      {graphSummary.clustered
                        ? `${graphSummary.candidateCount} cluster${graphSummary.candidateCount === 1 ? "" : "s"}`
                        : `${drawnUnchecked} place${drawnUnchecked === 1 ? "" : "s"}`}
                    </span>
                  ) : null}
                </button>

                {candidatesOn && (
                  <>
                    <p className="graph-note">
                      Named by our sources and not checked by us. Drawn hollow — each pin
                      links to whoever said it.
                    </p>

                    <label className="candidate-switch">
                      <input
                        type="checkbox"
                        checked={studioLotsOn}
                        onChange={(event) => setStudioLotsOn(event.target.checked)}
                      />
                      {/* The Los Angeles question, as a switch. 212 of the 5,266 rows
                          there sit inside a studio lot: real pins for scenes set
                          somewhere else, and not somewhere a visitor can walk. */}
                      Studio lots and backlots
                    </label>

                    {/* "Only my films" used to live here as a SECOND switch, three levels
                        deep, governing the pins while another one governed the chips. It is
                        one switch now and it sits at the top of the panel, where a reader
                        can see whether their list is loaded at all. */}

                    {graphSummary?.candidatesTruncated && (
                      <p className="graph-note">
                        More here than one response can carry — showing{" "}
                        {graphSummary.candidateCount}. Zoom in for the rest.
                      </p>
                    )}
                  </>
                )}
              </div>

              {graphSummary?.fictional?.length > 0 && (
                <div className="fictional-strip">
                  <p className="fictional-title">
                    Fictional — not on the map ({graphSummary.fictional.length})
                  </p>
                  <ul>
                    {graphSummary.fictional.map((place) => (
                      <li key={place.place_id ?? place.wikidata_id}>{place.name}</li>
                    ))}
                  </ul>
                  <p className="graph-note">
                    These places exist only in the story, so they are never given a coordinate.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
        </details>

        <p className="source-notices">
          {/* Terms-required wording, shown once however many images are on screen. */}
          {requiredNotices([normalizeAttribution({ source: "tmdb" })]).map((notice) => (
            <span key={notice}>{notice}</span>
          ))}
          <span>
            Ratings via OMDb. IMDb, Rotten Tomatoes and Metacritic are their owners&rsquo; marks.
          </span>
        </p>
      </aside>

      {activeLocation && section === "map" && (
        <section className="location-sheet" aria-label="Location details">
          {/* A way out. The card had none — no cross, and clicking the map did not dismiss
              it — so a reader who wanted to look at the map itself could not get rid of it.
              Escape closes it too, because that is what Escape is for. */}
          <button
            type="button"
            className="sheet-close"
            aria-label="Close this place"
            onClick={() => setActiveLocation(null)}
          >
            ×
          </button>
          <div className="sheet-media">
            {(() => {
              const heroSrc = activeFilmImage ?? activeLocation.now;
              return heroSrc && !brokenImages.has(heroSrc) ? (
                <img src={heroSrc} alt="" onError={() => markImageBroken(heroSrc)} />
              ) : null;
            })()}
            <div>
              <p><WorkKindMark kind={activeLocation.kind} />{" "}{activeLocation.film}</p>
              <h2>{activeLocation.scene}</h2>
            </div>
          </div>

          <div className="sheet-body">
            {/* Tabs (#160). The card was one scroll holding the sentence, the badge, the
                evidence, the voice guide, two images, "Recreate this shot", three external
                links and "Add to route" — a lot of unrelated things in one column. The
                split keeps the sentence about the place at the top of its own tab, which
                is what the route controls used to push off screen.

                There is no Discussion tab: #157 is not built, and a tab that opens onto
                nothing is padding. PLACE_TABS is where it goes the day it lands. */}
            <div className="place-tabs" role="tablist" aria-label="Place details">
              {PLACE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  id={`place-tab-${tab.id}`}
                  role="tab"
                  type="button"
                  aria-selected={placeTab === tab.id}
                  aria-controls={`place-panel-${tab.id}`}
                  className={placeTab === tab.id ? "is-active" : ""}
                  onClick={() => setPlaceTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === "route" && activeRoute.added && <span className="place-tab-dot" aria-hidden="true" />}
                </button>
              ))}
            </div>

            <div
              id="place-panel-details"
              role="tabpanel"
              aria-labelledby="place-tab-details"
              hidden={placeTab !== "details"}
            >
            <div className="place-row">
              <MapPin size={19} />
              <div>
                <strong>{activeLocation.place}</strong>
                {/* Somebody standing in the street with this page open wants the pair, and
                    the card showed it without letting anyone take it. The copied text is
                    exactly what is printed — bare, so it pastes into a maps app. */}
                {activeCoordinate ? (
                  <button
                    className="coordinate-copy"
                    type="button"
                    onClick={copyCoordinate}
                    aria-label={`Copy the coordinate ${activeCoordinate}`}
                  >
                    <span>{activeCoordinate}</span>
                    {copiedCoordinate ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  </button>
                ) : (
                  <span>No coordinate recorded</span>
                )}
                {/* Said out loud rather than swallowed: clipboard access is refused
                    outside a secure context and while the document is unfocused. */}
                {copyFailed && (
                  <span className="coordinate-copy-failed" role="status">
                    Copying was blocked — select the number and copy it by hand.
                  </span>
                )}
              </div>
            </div>
            {userPosition && distanceFromYou(userPosition, activeLocation, { isDemo: userIsDemo }) && (
              <p className="place-distance">{distanceFromYou(userPosition, activeLocation, { isDemo: userIsDemo })}</p>
            )}
            <div className="place-marks">
              <button
                type="button"
                className={`ghost-button${isWanted(placeMarks, activeLocation) ? " is-on" : ""}`}
                aria-pressed={isWanted(placeMarks, activeLocation)}
                onClick={() => updateMarks(toggleWant(placeMarks, activeLocation))}
              >
                <Heart size={16} aria-hidden="true" />
                {isWanted(placeMarks, activeLocation) ? "On your list" : "Want to visit"}
              </button>
              {visitOf(placeMarks, activeLocation) ? (
                <span className="place-visited">
                  <Check size={16} aria-hidden="true" />
                  Visited {new Date(visitOf(placeMarks, activeLocation).at).toLocaleDateString()}
                  {visitOf(placeMarks, activeLocation).demo ? " · demo" : ""}
                </span>
              ) : userIsDemo ? (
                // The stage demo (#19), said on the button: the demo location is not
                // where anybody is, so this records a visit that is marked as a demo.
                <button
                  type="button"
                  className="ghost-button is-demo"
                  onClick={() => recordCheckIn(demoCheckIn(placeMarks, activeLocation))}
                >
                  <MapPin size={16} aria-hidden="true" />
                  I&rsquo;m here · demo
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={checkingIn}
                  onClick={() => checkInHere(activeLocation)}
                >
                  <MapPin size={16} aria-hidden="true" />
                  {checkingIn ? "Finding you…" : "I'm here"}
                </button>
              )}
            </div>
            {checkInNote && <p className="place-marks-note" role="status">{checkInNote}</p>}
            {(() => {
              // Progress through this work's places, and what the visits add up to (#19).
              const progress = progressOf(placeMarks, sourceLocations.filter((location) => location.filmId === activeLocation.filmId));
              const glory = gloryOf(placeMarks);
              if (!glory && !progress.visited) return null;
              return (
                <p className="place-progress">
                  {progress.total > 0 && (
                    <span>Visited {progress.visited} of {progress.total} {progress.total === 1 ? "place" : "places"} from {activeLocation.film} · {progress.percent}%</span>
                  )}
                  <span>{glory} Glory</span>
                  {achievementsOf(placeMarks).map((achievement) => (
                    <span key={achievement.id} className="place-achievement">
                      <Award size={14} aria-hidden="true" />
                      {achievement.title}
                    </span>
                  ))}
                </p>
              );
            })()}
            {activeLocation.precisionCaveat && (
              <p className="precision-caveat" role="note">
                <Maximize2 size={15} aria-hidden="true" />
                {activeLocation.precisionCaveat}
              </p>
            )}
            {/* Only once a tour has asked. Printing "we have not confirmed" beside
                every pin on the map would say nothing, since nothing has been checked
                — the sentence is only worth reading where it was actually looked up. */}
            {tourAccess?.[activeLocation.locationId ?? activeLocation.id] && (
              <p className="place-access-row">
                <DoorOpen size={16} aria-hidden="true" />
                {accessNote(tourAccess[activeLocation.locationId ?? activeLocation.id])}
              </p>
            )}
            {activeLocation.isCandidate && (
              <p className="evidence-caveat" role="note">
                <strong>Unverified.</strong> Found by reading this place&rsquo;s own article,
                not a statement about the work. It may be where something was named,
                written or imagined rather than filmed &mdash; open the source and judge it.
              </p>
            )}
            <p>{activeLocation.description}</p>
            <VoiceGuide location={activeLocation} story={activeNarration} />
            <div className="comparison-grid">
              <figure>
                {activeFilmImage ? (
                  <img
                    src={activeFilmImage}
                    alt={`Matched film scene for ${activeLocation.film} at ${activeLocation.place}`}
                    onError={() => {
                      filmImageCache.current.delete(filmLocationImageKey(
                        activeLocation.filmTmdbId,
                        activeLocation.locationId ?? activeLocation.id,
                      ));
                      setFilmImageState({
                        locationId: activeLocation.id,
                        url: null,
                        sourceUrl: null,
                        frames: [],
                        status: "error",
                      });
                    }}
                  />
                ) : (
                  <div className="image-placeholder" role="status">
                    <span>{filmImagePlaceholderLabel(activeFilmImageStatus)}</span>
                    {/* A lot has no frame worth showing: the scene is a set, dressed as
                        somewhere else, that nobody can go and stand in (#196). The photo
                        beside this is the lot itself, which is the honest image of it. */}
                    {activeFilmImageStatus === "studio_lot" && (
                      <small className="image-placeholder-note">
                        {filmImageState.studio?.name ? `${filmImageState.studio.name}. ` : ""}
                        The scene was shot on a set, so there is no spot to match a frame to.
                        {filmImageState.studio?.access_note ? ` ${filmImageState.studio.access_note}` : ""}
                      </small>
                    )}
                    {activeFilmImageStatus === "error" && (
                      <button
                        className="image-placeholder-retry"
                        onClick={() => {
                          filmImageCache.current.delete(filmLocationImageKey(
                            activeLocation.filmTmdbId,
                            activeLocation.locationId ?? activeLocation.id,
                          ));
                          setFilmImageRetry((value) => value + 1);
                        }}
                        type="button"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                )}
                <figcaption>
                  <span className="scene-frame-meta">
                    {activePrimaryFrame && (
                      <span className="scene-frame-type">
                        {frameLocationLabel(activePrimaryFrame.locationType)}
                      </span>
                    )}
                    {activeFilmImage && activeFilmImageSource ? (
                      <a href={activeFilmImageSource} target="_blank" rel="noopener noreferrer">
                        AI-matched frame · TMDB
                      </a>
                    ) : "scene reference"}
                  </span>
                  {activePrimaryFrame?.description && (
                    <span className="scene-frame-description">
                      {activePrimaryFrame.description}
                    </span>
                  )}
                </figcaption>
              </figure>
              <figure>
                {activeLocation.now ? (
                  <img
                    src={activeLocation.now}
                    alt={`${activeLocation.place} today`}
                    // Half a 430 px sheet on a desktop, the whole sheet on a phone. A
                    // Special:FilePath URL renders on demand, so the one URL stored on
                    // the row can still offer both (#198).
                    srcSet={commonsSrcSetForSurface(activeLocation.now, "placePhoto") ?? undefined}
                    sizes={sizesForSurface("placePhoto")}
                    loading="lazy"
                  />
                ) : (
                  <div className="image-placeholder">Place photo unavailable</div>
                )}
                <figcaption>
                  the place today
                  {/* Commons files are licensed per FILE, so the credit belongs with
                      the image itself, not in a page footer. */}
                  {activeLocation.now && (
                    <ImageAttribution attribution={imageAttribution[activeLocation.now] ?? { url: activeLocation.now }} />
                  )}
                </figcaption>
              </figure>
            </div>
            {activeFilmFrames.length > 1 && (
              <section className="scene-frame-gallery" aria-label={`More matched frames from ${activeLocation.film}`}>
                <div className="scene-frame-gallery-heading">
                  <strong>More matched frames</strong>
                  <span>{activeFilmFrames.length - 1}</span>
                </div>
                <div className="scene-frame-list">
                  {activeFilmFrames.slice(1).filter((frame) => !brokenImages.has(frame.url)).map((frame) => (
                    <figure key={frame.url}>
                      <img
                        loading="lazy"
                        src={frame.url}
                        alt={`Candidate frame from ${activeLocation.film} associated with ${frame.locationName}`}
                        onError={() => markImageBroken(frame.url)}
                      />
                      <figcaption>
                        <span className="scene-frame-meta">
                          <span className="scene-frame-type">
                            {frameLocationLabel(frame.locationType)}
                          </span>
                          {frame.sourceUrl && (
                            <a href={frame.sourceUrl} target="_blank" rel="noopener noreferrer">
                              TMDB source
                            </a>
                          )}
                        </span>
                        <span className="scene-frame-description">{frame.description}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            )}
            <button
              aria-haspopup="dialog"
              className="wide-button recreate-launch"
              disabled={!activeFilmImage}
              onClick={() => setRecreateLocation({ ...activeLocation, backdrop: activeFilmImage })}
              title={activeFilmImage ? undefined : "A reference image is required to recreate this shot"}
              type="button"
            >
              <Clapperboard size={18} />
              Recreate this shot
            </button>
            {activeLocation.sourceUrl && (
              <a className="source-link" href={activeLocation.sourceUrl} target="_blank" rel="noopener noreferrer">
                {activeLocation.sourceTitle ?? (activeLocation.evidenceSource === "web_search" ? "Research source" : "Wikidata source")}
                <ExternalLink size={14} />
              </a>
            )}
            <a className="ghost-button image-search-link" href={makeImageSearchUrl(activeLocation)} target="_blank" rel="noopener noreferrer">
              <Search size={18} />
              Find place images
              <ExternalLink size={15} />
            </a>
            {/* Deep links, never embeds: Street View is the only free way to see the
                facade from the pavement without going there, and their imagery is not
                licensed to be pulled into our own map. */}
            {externalPlaceLinks({
              name: activeLocation.name,
              lat: activeLocation.position?.[0],
              lng: activeLocation.position?.[1],
            }).length > 0 && (
              <div className="external-place-links">
                {externalPlaceLinks({
                  name: activeLocation.name,
                  lat: activeLocation.position?.[0],
                  lng: activeLocation.position?.[1],
                }).map((link) => (
                  <a key={link.id} className="ghost-button" href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.label}
                    <ExternalLink size={14} />
                  </a>
                ))}
              </div>
            )}
            </div>

            <div
              id="place-panel-route"
              role="tabpanel"
              aria-labelledby="place-tab-route"
              hidden={placeTab !== "route"}
              className="place-route-panel"
            >
              {/* What this tab says before anything is on the route, so it is worth
                  opening. The old button simply did nothing at five stops, which reads as
                  a broken button rather than as a full route. */}
              <p className="place-route-note">{activeRoute.note}</p>

              {activeRoute.added ? (
                <button
                  className="wide-button"
                  type="button"
                  onClick={() => removeRouteStop(activeLocation.id)}
                >
                  <X size={18} />
                  Remove from route
                </button>
              ) : (
                <button
                  className="wide-button"
                  type="button"
                  disabled={!activeRoute.canAdd}
                  onClick={() => addRouteStop(activeLocation)}
                >
                  <Route size={18} />
                  Add to route
                </button>
              )}

              {routeStops.length > 0 && (
                <ol className="route-list">
                  {routeStops.map((stop, index) => (
                    <li key={stop.id}>
                      <button type="button" onClick={() => setActiveLocation(stop)}>
                        <span>{index + 1}</span>
                        {stop.place}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => removeRouteStop(stop.id)}
                        aria-label={`Remove ${stop.place} from the route`}
                      >
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              <button
                className="wide-button"
                type="button"
                disabled={routeStops.length < 3 || routeStatus !== "idle"}
                onClick={() => buildRoute()}
              >
                <Route size={18} />
                {routeStatus === "loading" ? "Building..." : "Build route"}
              </button>
            </div>
          </div>
        </section>
      )}

      {accountOpen && (
        <div className="account-backdrop" role="presentation" onMouseDown={() => setAccountOpen(false)}>
          <section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="account-heading">
              <div className="account-avatar"><User size={22} /></div>
              <div>
                <p className="eyebrow">Personal account</p>
                <h2 id="account-title">My library</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setAccountOpen(false)} aria-label="Close movie library">
                <X size={18} />
              </button>
            </div>

            <p className="account-copy">
              Import your official account export. Sign in to keep the normalized movie list in your private account and access it on another device.
            </p>

            <div className="account-auth">
              {accountUser ? (
                <div className="account-session">
                  <span className="account-user-mark">{(accountUser.user_metadata?.name || accountUser.email || "U").slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{accountUser.user_metadata?.name || "Signed in"}</strong>
                    <small>{accountUser.email}</small>
                  </span>
                  {/* The one thing an agent needs and cannot get any other way. The token
                      is already in this browser; copying it by hand means digging through
                      localStorage, and a person doing that learns nothing about how long
                      it lasts. Copying it here says so. */}
                  <button type="button" className="copy-token" onClick={copyApiToken}>
                    <Copy size={15} />{tokenCopied ? "Copied" : "API token"}
                  </button>
                  <button type="button" onClick={signOut}><LogOut size={16} />Sign out</button>
                </div>
              ) : (
                <div className="oauth-buttons">
                  <button type="button" onClick={() => signInWithProvider("google")} disabled={accountStatus === "authorizing" || accountStatus === "loading"}>
                    <span className="oauth-logo is-google">G</span>
                    Login with Google
                  </button>
                  <button type="button" onClick={() => signInWithProvider("facebook")} disabled={accountStatus === "authorizing" || accountStatus === "loading"}>
                    <span className="oauth-logo is-facebook">f</span>
                    Login with Facebook
                  </button>
                  <form className="email-sign-in" onSubmit={sendEmailLink}>
                    <input
                      type="email"
                      autoComplete="email"
                      aria-label="Email address"
                      placeholder="you@example.com"
                      value={signInAddress}
                      onChange={(event) => setSignInAddress(event.target.value)}
                    />
                    <button type="submit" disabled={accountStatus === "authorizing" || accountStatus === "loading"}>
                      <Mail size={16} />
                      Email me a link
                    </button>
                  </form>
                </div>
              )}
              <p className={accountUser && cloudReady ? "cloud-status is-synced" : "cloud-status"} role="status">
                {accountStatus === "loading" || accountStatus === "authorizing" ? <LoaderCircle className="spin" size={15} /> : <Cloud size={15} />}
                {cloudStatus}
              </p>
            </div>

            <input
              ref={connectorInputRef}
              type="file"
              accept={mediaSource(pendingConnector)?.accept ?? ".csv,text/csv"}
              hidden
              onChange={importLibrary}
            />

            {/* One card per service in [[media-sources]]. A new connector is a row there,
                not another block here that could disagree with the parser about what the
                service is called or what it hands you. */}
            <div className="connector-list">
              {Object.entries(MEDIA_SOURCES).map(([id, source]) => (
                <button className="connector-card" key={id} type="button" onClick={() => selectConnector(id)}>
                  <span className={`connector-logo is-${id}`}>
                    {source.logoText ?? <Film size={20} />}
                  </span>
                  <span><strong>{source.label}</strong><small>{source.blurb}</small></span>
                  <Link2 size={18} />
                </button>
              ))}
            </div>

            {importMessage && <p className="import-message" role="status"><CheckCircle2 size={16} />{importMessage}</p>}

            <div className="library-toolbar">
              <div className="film-search">
                <Search size={16} />
                <input aria-label="Search my movies" placeholder="Search my movies" type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} />
              </div>
              {library.length > 0 && (
                <button className="clear-library" type="button" onClick={clearLibrary}><Trash2 size={15} />Clear</button>
              )}
            </div>

            <div className="library-summary">
              <span>{library.length} {libraryNoun(library)}</span>
              <span>{library.filter((movie) => movie.rating !== null).length} rated</span>
              <button
                type="button"
                className={mineOnly ? "is-selected" : ""}
                onClick={() => setMineOnly((current) => !current)}
                disabled={library.length === 0}
                aria-pressed={mineOnly}
              >
                {/* "in view", because that is the scope of the number. "Mapped on map"
                    read as "of your whole library", which is a claim about 2,798 films
                    made from what one viewport happens to hold. */}
                {mineOnly ? `${myFilmsInView} of mine in view` : "Show library on map"}
              </button>
            </div>

            <div className="movie-library" aria-live="polite">
              {filteredLibrary.map((movie) => (
                <article className="library-movie" key={movie.id}>
                  <span className="library-poster">{movie.title.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{movie.title}</strong>
                    <span>{movie.year ?? "Year unknown"} · {(movie.sources ?? []).map((source) => mediaSourceLabel(source) ?? source).join(" + ")}</span>
                  </div>
                  {movie.rating !== null && <span className="movie-rating"><Star size={14} />{movie.rating}</span>}
                </article>
              ))}
              {library.length === 0 && (
                <div className="empty-library"><Film size={28} /><strong>Your movie list is empty</strong><span>Connect Letterboxd or IMDb to import it.</span></div>
              )}
              {library.length > 0 && filteredLibrary.length === 0 && <p className="empty-library">No movies match your search.</p>}
            </div>

            <div className="account-privacy"><CheckCircle2 size={17} /><span>The ZIP or CSV is processed locally and is never uploaded. When you sign in, only the normalized movie list is stored under your account.</span></div>
          </section>
        </div>
      )}

      {recreateLocation && (
        <RecreateShot location={recreateLocation} onClose={() => setRecreateLocation(null)} />
      )}

      {profileFilm && (
        <WorkProfile
          film={profileFilm}
          onClose={() => setProfileFilm(null)}
          // Picking a place from the profile moves the map to it and closes the
          // overlay: the profile is a way INTO the map, not a replacement for it.
          onSelectPlace={(place) => {
            if (place.lat === null || place.lng === null) return;
            setProfileFilm(null);
            setMapCenter([place.lat, place.lng]);
          }}
        />
      )}

      <SectionSheet
        section={section}
        onClose={() => setSection("map")}
        onShow={(position) => { setSection("map"); showOnMap(position); }}
        routeStops={routeStops}
        routeResult={routeResult}
        routeStatus={routeStatus}
        onBuildRoute={() => { setSection("map"); buildRoute(); }}
        timedTour={timedTour}
        onStartTimedTour={() => { setSection("map"); startTimedTour(); }}
        restoredWalk={restoredWalk}
        marks={placeMarks}
        onMarks={updateMarks}
        accountUser={accountUser}
        suggestions={suggestions}
        onSuggestions={(next) => { setSuggestions(next); saveSuggestions(window.localStorage, next); }}
        mapCenter={mapCenter}
        userPosition={userPosition}
        userIsDemo={userIsDemo}
        onOpenInterests={() => setOnboardingOpen("deck")}
        onOpenAccount={() => setAccountOpen(true)}
      />
      <AppNav section={section} onSection={setSection} />
      {onboardingOpen && (
        <Onboarding
          state={onboarding}
          center={mapCenter}
          startAt={onboardingOpen}
          onDecide={(card, choice) => updateOnboarding(decide(onboarding, card, choice))}
          onUndo={() => updateOnboarding(undoLast(onboarding))}
          onFinish={finishOnboarding}
        />
      )}
    </main>
  );
}
