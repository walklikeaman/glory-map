"use client";

// The graph layer: points served by /api/map/points, drawn as GPU layers (#202, phase 3).
//
// It used to draw DOM markers — a `divIcon` per place, on a Leaflet canvas renderer for the
// verified points and real elements for the queue. That is the layer #197 measured: 1,008
// places on screen dragged at 30 fps, against 120 for the same places as one GeoJSON source.
//
// Below z12 the endpoint returns cluster bubbles instead of places, so the client never
// holds the whole set. That has not changed; only what draws it has.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { workPath } from "../lib/work-url.mjs";
import { candidateSummary, pointFilmLine, pointHint, pointSummary, viewportQuery } from "../lib/map-layer.mjs";
import { describedFilms, listingLine, sourceLabel } from "../lib/place-note.mjs";
import { useGeoJsonLayer, useMapCanvas, claimClick } from "./map/MapCanvas.jsx";
import { MapPopup, PinLayer } from "./map/layers.jsx";

const REFRESH_DEBOUNCE_MS = 300;

// How far a cluster bubble grows with what it holds. Logarithmic for the same reason the
// pins are: linear saturates at once and draws 50 places the same as 5,000.
function clusterRadius(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 1) return 14;
  return Math.round(Math.min(30, 14 + Math.log10(n) * 8));
}

// The bubbles the database returns when the viewport is too wide for places. Amber unless
// the bubble holds a studio lot, which keeps the one colour distinction the pins make.
function ClusterLayer({ features, onZoomInto }) {
  const map = useMapCanvas();

  const data = useMemo(() => ({
    type: "FeatureCollection",
    features: (features ?? []).map((feature) => ({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        count: feature.properties?.point_count ?? 0,
        label: String(feature.properties?.point_count ?? 0),
        radius: clusterRadius(feature.properties?.point_count),
        ring: feature.properties?.has_studio ? "#b98cff" : "#f7b733",
      },
    })),
  }), [features]);

  useGeoJsonLayer({
    id: "graph-clusters",
    data,
    layers: [
      {
        id: "graph-clusters-circles",
        type: "circle",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": "#16130c",
          "circle-opacity": 0.78,
          "circle-stroke-color": ["get", "ring"],
          "circle-stroke-width": 2,
        },
      },
      {
        id: "graph-clusters-labels",
        type: "symbol",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-font": ["Noto Sans Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#f7e2b0" },
      },
    ],
  });

  const zoomRef = useRef(onZoomInto);
  zoomRef.current = onZoomInto;

  useEffect(() => {
    if (!map) return undefined;
    const layers = ["graph-clusters-circles", "graph-clusters-labels"];

    const pick = (event) => {
      const hit = map.queryRenderedFeatures(event.point, { layers })[0];
      if (!hit) return;
      claimClick(event);
      zoomRef.current?.(hit.geometry.coordinates);
    };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };

    map.on("click", pick);
    for (const layer of layers) {
      map.on("mouseenter", layer, enter);
      map.on("mouseleave", layer, leave);
    }
    return () => {
      map.off("click", pick);
      for (const layer of layers) {
        map.off("mouseenter", layer, enter);
        map.off("mouseleave", layer, leave);
      }
    };
  }, [map]);

  return null;
}

function GraphLayer({
  workId = null,
  kinds = null,
  selectedPlaceId = null,
  onSelect,
  // Opens the full sheet for a place. Called from the card's own button rather than from
  // the click, so a click answers "what is this?" without covering the map with everything
  // a place can hold.
  onOpenPlace,
  onSummary,
  onCandidatesInView,
  // The queue layer. Off by default: every caller written before it existed keeps drawing
  // the graph and nothing else.
  showCandidates = false,
  showStudioLots = true,
  // A predicate, not a list. The owner's library lives in localStorage and never reaches the
  // server, so "my films only" can only be decided here, on rows that have already arrived.
  // Passing a matcher keeps the library out of this component entirely — it never sees the
  // titles, only the answer.
  isMine = null,
  // Which coordinates have earned a name on the pin, keyed "lat,lng". Scarce by design —
  // see [[notable-here]]. Passed in rather than computed here because the panel and the map
  // must name the SAME places; two rankings would disagree and look like a bug.
  placeLabels = null,
  // The places of the film the reader is pointing at in the list, so the map can answer
  // "where is this one?" without them hunting for it among a thousand identical pins.
  highlightedKeys = null,
}) {
  const map = useMapCanvas();
  const [data, setData] = useState({ features: [], candidates: [], clustered: false, fictional: [] });
  // Which point's popup is open. Without it a reader cannot tell WHICH pin they hit — the
  // popup appears near a cluster of pins and every one of them still looks the same, which
  // is the "непонятно, на что ты нажал" complaint exactly.
  const [openPoint, setOpenPoint] = useState(null);
  const requestRef = useRef(null);
  const timerRef = useRef(null);
  const lastQueryRef = useRef(null);

  const load = useCallback(async () => {
    if (!map) return;
    const query = viewportQuery(map.getBounds(), map.getZoom(), { workId, kinds, candidates: showCandidates });
    if (!query) return;
    // The question already asked, and answered or still being answered. The layer asks on
    // mount AND on the `moveend` the opening pan fires a moment later — the same view both
    // times — so every page load paid for /api/map/points twice.
    if (query === lastQueryRef.current) return;
    lastQueryRef.current = query;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await fetch(`/api/map/points?${query}`, { signal: controller.signal });
      // A failed answer is not an answer: forget the query so the next move asks again.
      if (!response.ok) { lastQueryRef.current = null; return; }
      const body = await response.json();
      setData({
        features: Array.isArray(body.features) ? body.features : [],
        candidates: Array.isArray(body.candidates) ? body.candidates : [],
        clustered: body.clustered === true,
        fictional: Array.isArray(body.fictional) ? body.fictional : [],
        truncated: body.truncated === true,
      });
      // Every field here is read by the panel, and the panel says "undefined" for any one
      // that goes missing. The MapLibre rewrite dropped four of them and changed what
      // `count` meant, which put the literal string "undefined pins" on screen and made the
      // toggle read 890 while the header 594 px below read 2,480.
      onSummary?.({
        // FEATURES only. Adding the candidates in makes this number disagree with the label
        // it sits next to, which is the bug it caused.
        count: body.features?.length ?? 0,
        candidateCount: body.candidates?.length ?? 0,
        clustered: body.clustered === true,
        truncated: body.truncated === true,
        // The viewport held more than one response can carry. Said out loud, because a map
        // that draws 1,000 of 4,729 and looks complete is the silent truncation this project
        // has already shipped once.
        candidatesTruncated: body.candidates_truncated === true,
        fictional: body.fictional ?? [],
        // Populated only when the viewport is empty, so the panel can say "nothing here"
        // and offer somewhere to go.
        nearest: body.nearest ?? [],
      });
    } catch (error) {
      // Aborted or failed, the question was not answered — the next event may ask it again.
      if (lastQueryRef.current === query) lastQueryRef.current = null;
      if (error?.name !== "AbortError") console.error("graph layer failed", error);
    }
  }, [map, workId, kinds, showCandidates, onSummary]);

  useEffect(() => {
    if (!map) return undefined;
    const schedule = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(load, REFRESH_DEBOUNCE_MS);
    };
    map.on("moveend", schedule);
    load();
    return () => {
      map.off("moveend", schedule);
      clearTimeout(timerRef.current);
      requestRef.current?.abort();
      // Cleared HERE, synchronously, not in the aborted request's catch. The next effect
      // runs before that catch does, and would otherwise see its own query still marked as
      // asked, skip it, and leave the map empty once the abort landed.
      lastQueryRef.current = null;
    };
  }, [map, load]);

  // Three switches, applied in one pass. A cluster is never filtered by film or by lot: it
  // is a COUNT of rows the server aggregated, and hiding some of what it counted would leave
  // a bubble whose number describes rows that are no longer on the map.
  const visibleCandidates = useMemo(() => {
    if (!showCandidates) return [];
    return data.candidates.flatMap((feature) => {
      const props = feature.properties ?? {};
      if (props.cluster) return [feature];
      if (!showStudioLots && props.depicts_elsewhere) return [];
      if (!isMine) return [feature];

      // A point carries many films, so "mine" is a question about the LIST, not the pin. A
      // place keeps its pin if any film there is the reader's — and the popup is narrowed to
      // those, because a filtered map that still lists 96 films is answering a question
      // nobody asked.
      const mine = props.films.filter((film) => isMine(film));
      if (!mine.length) return [];
      return [{
        ...feature,
        properties: {
          ...props,
          films: mine,
          work_count: mine.length,
          row_count: mine.length,
          films_truncated: false,
        },
      }];
    });
  }, [data.candidates, showCandidates, showStudioLots, isMine]);

  // The panel lists exactly what the map DREW, not what the server sent.
  useEffect(() => {
    onCandidatesInView?.(visibleCandidates);
  }, [visibleCandidates, onCandidatesInView]);

  const clusters = useMemo(
    () => data.features.filter((feature) => data.clustered || feature.properties?.cluster),
    [data.features, data.clustered],
  );
  const places = useMemo(
    () => data.features.filter((feature) => !(data.clustered || feature.properties?.cluster)),
    [data.features, data.clustered],
  );
  const candidatePins = useMemo(
    () => visibleCandidates.filter((feature) => !feature.properties?.cluster),
    [visibleCandidates],
  );

  const zoomInto = useCallback((coordinates) => {
    if (!map) return;
    map.flyTo({ center: coordinates, zoom: Math.min(map.getZoom() + 3, 17) });
  }, [map]);

  // `openPoint` is `{ feature, kind, key }` — the feature is INSIDE it. Reading
  // `openPoint.properties` gave `undefined`, so `openProps` was null and the first
  // `openProps.name` in the card threw. Every click on a queue pin took the whole map down
  // to the error boundary, and it did it in production, because the popup is the only thing
  // that reads this and nothing else does.
  const openProps = openPoint?.feature?.properties ?? null;

  return (
    <>
      <ClusterLayer features={clusters} onZoomInto={zoomInto} />

      {/* The graph — places somebody checked. Same vocabulary as the queue, filled rather
          than hollow, because that distinction IS the evidence. */}
      <PinLayer
        id="graph-places"
        features={places}
        selectedKey={selectedPlaceId}
        onSelect={(properties) => {
          const feature = places.find((candidate) => candidate.properties?.place_id === properties.place_id);
          setOpenPoint(feature ? { feature, kind: "place" } : null);
          if (feature) onSelect?.(feature);
        }}
      />

      {/* The queue, drawn hollow so it can never be mistaken for the graph. Filtered here
          rather than in the query: the library never leaves the browser, and the lot test is
          a polygon this client already holds. */}
      <PinLayer
        id="graph-candidates"
        placeLabels={placeLabels}
        highlightedKeys={highlightedKeys}
        features={candidatePins}
        selectedKey={openPoint?.kind === "candidate" ? openPoint.key : null}
        onSelect={(properties) => {
          const feature = candidatePins.find((candidate) => {
            const [lng, lat] = candidate.geometry.coordinates;
            return `${lat},${lng}` === properties.key;
          });
          setOpenPoint(feature ? { feature, kind: "candidate", key: properties.key } : null);
        }}
      />

      {openPoint && (
        <MapPopup
          // GeoJSON is longitude-first and every component in this app is latitude-first.
          // Converted here rather than relied on being the same.
          position={[openPoint.feature.geometry.coordinates[1], openPoint.feature.geometry.coordinates[0]]}
          onClose={() => setOpenPoint(null)}
        >
          <strong>{openProps.name}</strong>
          <br />
          {openPoint.kind === "candidate" ? (
            <>
              <span className="graph-badge badge-candidate">{pointFilmLine(openProps)}</span>
              {openProps.studio_lot && (
                <>
                  <br />
                  <small>
                    Inside {openProps.studio_lot.name} — the camera was here, the scene is set elsewhere
                  </small>
                </>
              )}
              {openProps.area_hint && (<><br /><small>{openProps.area_hint}</small></>)}
              {/* The films themselves. Before the points were grouped this was unreachable:
                  every film after the first was drawn underneath the pin you could see. */}
              {/* What was filmed here, not only which film. A title alone leaves the
                  reader to click through to a work page to find out why this corner is
                  worth the walk — and we were holding the answer in the sentence the place
                  was found in the whole time. See [[place-note]]: 78% of the queue can say
                  it, and the 22% that cannot say nothing rather than something invented. */}
              <ul className="point-films">
                {describedFilms(openProps.films, { placeName: openProps.name }).map((film) => {
                  const note = film.note;
                  return (
                    <li key={`${film.work_id}-${film.place_name}`}>
                      <a href={workPath({ id: film.work_id, title: film.title })}>{film.title}</a>
                      {film.year ? <span className="point-film-year"> {film.year}</span> : null}
                      {note && <span className="point-film-note">{note}</span>}
                      {/* Where the claim came from, always — it is the reader's way to the
                          full sentence, and on a row with no note it is the only thing we
                          can honestly offer beyond the title. */}
                      {film.source_url && (
                        <a
                          className="point-film-source"
                          href={film.source_url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          {note ? sourceLabel(film.source_kind) : listingLine(film)}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
              {openProps.films_truncated && (
                <small>
                  Showing {(openProps.films ?? []).length} of {openProps.work_count} — open the place to see them all.
                </small>
              )}
              <br />
              <small>{candidateSummary(openProps)}</small>
              {onOpenPlace && (
                <button
                  type="button"
                  className="popup-open-place"
                  onClick={() => onOpenPlace(openPoint.feature)}
                >
                  Open this place
                </button>
              )}
            </>
          ) : (
            <>
              <span className={`graph-badge badge-${openProps.badge}`}>{pointSummary(openProps)}</span>
              <br />
              <small>{pointHint(openProps)}</small>
            </>
          )}
        </MapPopup>
      )}
    </>
  );
}

// Memoised for the reason #199 measured: every state change in the parent re-ran this and
// with it the whole marker list, so React could discover that none of it had changed. One
// click on an unrelated menu blocked the main thread for 250 ms with 1,008 pins drawn.
export default memo(GraphLayer);
