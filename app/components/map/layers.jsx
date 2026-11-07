"use client";

// What the map draws on top of the basemap, as MapLibre layers (#202, phase 3).
//
// Each of these replaces a react-leaflet component the app already used, and each keeps the
// meaning the old one carried. The difference is where the drawing happens: a Leaflet
// `<Marker>` is a DOM element the compositor redraws every frame, while a layer here is
// data the GPU draws. With 1,008 places on screen that is 30 fps against 120 (#197).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { circleFeature } from "../../lib/geo-circle.mjs";
import {
  CLUSTERED, UNCLUSTERED,
  pinCirclePaint, pinClusterCirclePaint, pinClusterLabelLayout, pinClusterLabelPaint, pinClusterSource,
  pinFeature, pinLabelLayout, pinLabelPaint,
} from "../../lib/pin-style.mjs";
import { claimClick, useGeoJsonLayer, useMapCanvas } from "./MapCanvas.jsx";

const EMPTY = { type: "FeatureCollection", features: [] };

// **Every component in this file takes `[lat, lng]`, and converts.**
//
// Leaflet orders a coordinate latitude-first; MapLibre and GeoJSON order it
// longitude-first. The app is written throughout in the Leaflet order — `location.position`,
// `routePositions`, `stop.position` — so the conversion happens HERE, once, at the boundary,
// rather than at each of the twenty call sites. A swapped pair does not throw: it silently
// puts Los Angeles in the Indian Ocean, which is the kind of bug that survives review.
function toLngLat(point) {
  if (!point) return null;
  const [lat, lng] = Array.isArray(point) ? point : [point.lat, point.lng];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

function collection(features) {
  return { type: "FeatureCollection", features: features.filter(Boolean) };
}

// The places. One source, two layers: a circle carrying the vocabulary from `map-pin.mjs`,
// and a label carrying the count for the points that stack several films.
//
// `quiet` and `clustered` (UX-1): quiet draws UNCHECKED pins as small dots below z16 (checked,
// selected and highlighted ones keep their size); clustered merges ALL the layer's nearby
// pins, checked or not, into numbered bubbles up to z14. Both are read once, when the layer
// is created. A name from `placeLabels` waits for its pin to leave the bubble.
export function PinLayer({
  id = "places", features, onSelect, selectedKey = null, placeLabels = null, highlightedKeys = null,
  quiet = false, clustered = false,
}) {
  const map = useMapCanvas();

  const data = useMemo(() => collection(
    (features ?? []).map((feature) => {
      const shaped = pinFeature(feature);
      if (!shaped?.geometry) return null;
      const key = `${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}`;
      return {
        ...shaped,
        properties: {
          ...shaped.properties,
          selected: key === selectedKey,
          key,
          // The name of the best-known work at this point, for the few places that earned
          // one. Empty for everything else, and MapLibre draws no label for an empty string.
          placeLabel: placeLabels?.get(key) ?? "",
          // Lit because the reader is pointing at this film in the list beside the map.
          highlighted: highlightedKeys ? highlightedKeys.has(key) : false,
        },
      };
    }),
  ), [features, selectedKey, placeLabels, highlightedKeys]);

  const circleId = `${id}-circles`;
  const labelId = `${id}-labels`;
  const nameId = `${id}-names`;
  const clusterId = `${id}-clusters`;
  const clusterLabelId = `${id}-cluster-labels`;
  // Only on a clustered source: an unclustered one has no `point_count` to test.
  const pinsOnly = clustered ? { filter: UNCLUSTERED } : {};

  useGeoJsonLayer({
    id,
    data,
    source: clustered ? pinClusterSource() : null,
    layers: [
      { id: circleId, type: "circle", paint: pinCirclePaint({ quiet }), ...pinsOnly },
      { id: labelId, type: "symbol", layout: pinLabelLayout(), paint: pinLabelPaint({ quiet }), ...pinsOnly },
      ...(clustered ? [
        { id: clusterId, type: "circle", filter: CLUSTERED, paint: pinClusterCirclePaint() },
        {
          id: clusterLabelId, type: "symbol", filter: CLUSTERED,
          layout: pinClusterLabelLayout(), paint: pinClusterLabelPaint(),
        },
      ] : []),
      {
        id: nameId,
        type: "symbol",
        ...pinsOnly,
        layout: {
          "text-field": ["get", "placeLabel"],
          "text-size": 11,
          "text-font": ["Noto Sans Bold"],
          // Below the pin, so it never lands on the count the pin already carries.
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          // These MAY collide, unlike the counts — a name that overlaps another name is
          // unreadable, and MapLibre dropping one is the right answer. The ranking decided
          // which names are worth drawing; the renderer decides which ones fit.
          "text-allow-overlap": false,
          "text-optional": true,
          "text-max-width": 9,
        },
        paint: {
          "text-color": "#f7e2b0",
          // A halo, because the name is drawn over streets and buildings rather than over
          // a pin. Without it the text is legible on dark ground and invisible on light.
          "text-halo-color": "rgba(8, 8, 10, 0.9)",
          "text-halo-width": 1.4,
        },
      },
    ],
  });

  // Clicks and the pointer, both on the circle layer. The label sits on top of the circle,
  // so hit-testing only the circle would miss the middle of any pin carrying a number.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!map) return undefined;
    const clusterLayers = clustered ? [clusterId, clusterLabelId] : [];
    const hitLayers = [...clusterLayers, circleId, labelId, nameId];

    const pick = (event) => {
      // Only the layers that exist: an empty list would query every layer on the map.
      const layers = hitLayers.filter((layer) => map.getLayer(layer));
      if (!layers.length) return;
      const hit = map.queryRenderedFeatures(event.point, { layers })[0];
      if (!hit) return;
      // Tell the map's own background handler to stand down: this click was answered.
      claimClick(event);
      if (hit.properties?.cluster) {
        // A bubble opens by zooming to the level where it splits, centred on it.
        const center = hit.geometry.coordinates;
        map.getSource(id)?.getClusterExpansionZoom(hit.properties.cluster_id)
          .then((zoom) => map.easeTo({ center, zoom: Math.min(zoom, 17) }))
          .catch(() => map.easeTo({ center, zoom: map.getZoom() + 2 }));
        return;
      }
      selectRef.current?.(hit.properties);
    };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };

    map.on("click", pick);
    for (const layer of hitLayers) {
      map.on("mouseenter", layer, enter);
      map.on("mouseleave", layer, leave);
    }

    return () => {
      map.off("click", pick);
      for (const layer of hitLayers) {
        map.off("mouseenter", layer, enter);
        map.off("mouseleave", layer, leave);
      }
    };
  }, [map, id, clustered, circleId, labelId, nameId, clusterId, clusterLabelId]);

  return null;
}

// The dashed ring that says "the source named a city or a region, not a doorway".
//
// Drawn as a polygon in real coordinates rather than a pixel radius, because the number it
// carries is a DISTANCE. A pixel radius would hold the ring the same size on screen while
// the city under it grew and shrank, and the ring would stop meaning anything.
export function AreaLayer({ id = "areas", areas }) {
  const data = useMemo(() => collection(
    (areas ?? []).map((area) => circleFeature(toLngLat(area.position), area.radiusMeters, {
      id: area.id ?? "", active: Boolean(area.active),
    })),
  ), [areas]);

  useGeoJsonLayer({
    id,
    data,
    layers: [
      {
        id: `${id}-fill`,
        type: "fill",
        paint: {
          "fill-color": "#f7b733",
          // The selected area is filled more strongly — the same distinction the Leaflet
          // ring made, and the only thing that answers "which of these did I click?".
          "fill-opacity": ["case", ["to-boolean", ["get", "active"]], 0.12, 0.06],
        },
      },
      {
        id: `${id}-outline`,
        type: "line",
        paint: {
          "line-color": "#f7b733",
          "line-opacity": 0.55,
          "line-width": ["case", ["to-boolean", ["get", "active"]], 2, 1],
          // The dash is the whole point: a solid ring would read as a boundary we know,
          // and we do not know one. It is vagueness drawn honestly.
          "line-dasharray": [3, 3],
        },
      },
    ],
  });

  return null;
}

// A route or a trail. One line, styled by whether it is a real route or a straight-line
// stand-in — a dashed line is the honest drawing of "we could not get directions".
export function RouteLine({ id = "route", positions, dashed = false, color = "#f7b733" }) {
  const data = useMemo(() => {
    const coordinates = (positions ?? []).map(toLngLat).filter(Boolean);

    if (coordinates.length < 2) return EMPTY;
    return collection([{ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} }]);
  }, [positions]);

  useGeoJsonLayer({
    id,
    data,
    layers: [{
      id: `${id}-line`,
      type: "line",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color,
        "line-width": 5,
        "line-opacity": dashed ? 0.7 : 0.95,
        ...(dashed ? { "line-dasharray": [1.6, 2] } : {}),
      },
    }],
  });

  return null;
}

// One marker, as a DOM element — for the handful of things that are genuinely one of a kind
// and want real markup: where the reader is standing, and the numbered stops of a trail.
// Using a layer for these would be the same mistake in reverse.
export function MapMarker({ position, children, onClick, className = "", zIndex, title }) {
  // `children` is text only — see the effect at the end of this component for why.
  const map = useMapCanvas();
  const elementRef = useRef(null);
  const markerRef = useRef(null);

  if (!elementRef.current && typeof document !== "undefined") {
    elementRef.current = document.createElement("div");
  }

  useEffect(() => {
    if (!map || !elementRef.current) return undefined;

    let cancelled = false;
    let marker = null;

    (async () => {
      const mod = await import("maplibre-gl");
      const maplibregl = mod.default ?? mod;
      if (cancelled) return;
      const lngLat = toLngLat(position);
      if (!lngLat) return;
      marker = new maplibregl.Marker({ element: elementRef.current })
        .setLngLat(lngLat)
        .addTo(map);
      markerRef.current = marker;
    })();

    return () => { cancelled = true; marker?.remove(); markerRef.current = null; };
  }, [map, position]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.className = className;
    if (title) element.title = title;
    if (zIndex !== undefined) element.style.zIndex = String(zIndex);
  }, [className, zIndex, title]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !onClick) return undefined;
    const handler = (event) => { event.stopPropagation(); onClick(); };
    element.addEventListener("click", handler);
    return () => element.removeEventListener("click", handler);
  }, [onClick]);

  useEffect(() => {
    const lngLat = toLngLat(position);
    if (markerRef.current && lngLat) markerRef.current.setLngLat(lngLat);
  }, [position]);

  // `textContent`, never `innerHTML`. A marker here carries at most a number — a trail stop's
  // position in the walk — and the shape comes from CSS. Accepting markup would put a place
  // name from a third-party source into the DOM as HTML, which is a route from a scraped
  // title to script execution that this map has no reason to open.
  useEffect(() => {
    const element = elementRef.current;
    if (element) element.textContent = children == null ? "" : String(children);
  }, [children]);

  return null;
}

// A popup anchored to a coordinate, with React inside it.
//
// Leaflet's `<Popup>` took children directly; MapLibre's takes a DOM node. So the node is
// made here and React renders into it through a portal — which keeps the contents a normal
// component (links, lists, conditional rows) instead of a string of HTML. That matters more
// than it looks: the previous popup listed film titles from scraped sources, and building
// that with `innerHTML` would have been a route from a scraped title to script execution.
export function MapPopup({ position, onClose, children, maxWidth = "320px" }) {
  const map = useMapCanvas();
  const [host] = useState(() => (typeof document === "undefined" ? null : document.createElement("div")));
  const popupRef = useRef(null);

  useEffect(() => {
    if (!map || !host || !position) return undefined;

    let cancelled = false;
    let popup = null;

    (async () => {
      const mod = await import("maplibre-gl");
      const maplibregl = mod.default ?? mod;
      if (cancelled) return;

      const lngLat = toLngLat(position);
      if (!lngLat) return;
      popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth })
        .setLngLat(lngLat)
        .setDOMContent(host)
        .addTo(map);
      popupRef.current = popup;
      // The reader closing the popup is the same event as dismissing the selection; without
      // this the pin stays ringed with nothing open, which is the "what did I click" problem
      // the ring exists to answer.
      popup.on("close", () => { if (!cancelled) onCloseRef.current?.(); });
    })();

    return () => { cancelled = true; popup?.remove(); popupRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, host, position?.[0], position?.[1]]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  if (!host || !position) return null;
  return createPortal(children, host);
}

// Move the map without changing its zoom.
//
// The rule behind this is the owner's, and it is absolute: "не меняй масштаб карты до тех
// пор, пока я его сам не поменяю". Clicking a pin used to fly the map and zoom out, which
// moved the thing being clicked out from under the cursor.
export function PanTo({ position }) {
  const map = useMapCanvas();

  useEffect(() => {
    const lngLat = toLngLat(position);
    if (!map || !lngLat) return;
    map.panTo(lngLat, { animate: true, duration: 400 });
  }, [map, position?.[0], position?.[1]]);

  return null;
}

// Fit a set of points, for a route — the one case where changing the zoom is the POINT,
// because a route you cannot see all of is not a route you can follow.
export function FitPositions({ positions, maxZoom = 14, padding = 48 }) {
  const map = useMapCanvas();
  const signature = (positions ?? []).length;

  useEffect(() => {
    const points = (positions ?? []).map(toLngLat).filter(Boolean);
    if (!map || points.length < 2) return;

    const bounds = points.reduce(
      (box, [lng, lat]) => [
        [Math.min(box[0][0], lng), Math.min(box[0][1], lat)],
        [Math.max(box[1][0], lng), Math.max(box[1][1], lat)],
      ],
      [[points[0][0], points[0][1]], [points[0][0], points[0][1]]],
    );
    map.fitBounds(bounds, { maxZoom, padding, animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);

  return null;
}

// Fly to a point at a zoom chosen for a radius — "what is near me" is a question about an
// area, so the answer has to frame that area.
export function FlyTo({ position, zoom }) {
  const map = useMapCanvas();

  useEffect(() => {
    const lngLat = toLngLat(position);
    if (!map || !lngLat) return;
    // Across a country the flight is seconds of blur, and the map searches nothing until
    // it lands: opening in London and locating the reader in Tel Aviv took nine seconds
    // to show a pin. Far away, it jumps; nearby, it still flies.
    const far = map.getCenter().distanceTo({ lng: lngLat[0], lat: lngLat[1] }) > 200_000;
    if (far) map.jumpTo({ center: lngLat, zoom });
    else map.flyTo({ center: lngLat, zoom, animate: true });
  }, [map, position?.[0], position?.[1], zoom]);

  return null;
}

// Hands the map out to the shell, so the furniture outside the canvas can drive it.
export function ExposeMap({ onMap, onZoom }) {
  const map = useMapCanvas();

  useEffect(() => {
    if (!map) return undefined;
    onMap(map);
    onZoom(map.getZoom());
    const report = () => onZoom(map.getZoom());
    map.on("zoomend", report);
    return () => { map.off("zoomend", report); onMap(null); };
  }, [map, onMap, onZoom]);

  return null;
}
