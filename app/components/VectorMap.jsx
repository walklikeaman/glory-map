"use client";

// The MapLibre map, assembled from the pieces the real map will use (#202, phase 3).
//
// It exists on its own route so the engine can be proved before the app is moved onto it:
// the basemap and all four layer choices, the pin layer, the area rings, a route line, and
// the selection a click makes. When SceneMapApp draws through `MapCanvas`, this page goes.
//
// Phase 2 built this as one file that owned a MapLibre map directly. That was the right way
// to find the four bugs it found — the interop shape, `styledata` firing during the first
// load, `isStyleLoaded` as a guard, and the worker that was never served. Now that those are
// known, the same map is assembled from reusable pieces instead, because the app needs the
// pieces and not the page.

import { useCallback, useMemo, useRef, useState } from "react";

import { layerById, MAP_LAYERS } from "../lib/map-layers.mjs";
import { viewportQuery } from "../lib/map-layer.mjs";
import MapCanvas from "./map/MapCanvas.jsx";
import { AreaLayer, PinLayer, RouteLine } from "./map/layers.jsx";

// `[lat, lng]`, the order MapCanvas takes.
const LOS_ANGELES = [34.1016, -118.3269];

// Long enough that a drag does not fire a request per frame, short enough that letting go of
// the mouse feels like it answered. The Leaflet layer settled on the same number.
const REFETCH_DEBOUNCE_MS = 250;

export default function VectorMap({ bare = false }) {
  const [basemapId, setBasemapId] = useState("dark");
  const [features, setFeatures] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("Loading the map…");

  const requestRef = useRef(null);
  const timerRef = useRef(null);

  const basemap = useMemo(() => layerById(basemapId), [basemapId]);

  const load = useCallback(async ({ bounds, zoom }) => {
    const query = viewportQuery(bounds, zoom, { candidates: true });
    // A viewport with no area asks the server about a single point and gets an honest
    // nothing back, which looks exactly like "there is nothing here".
    if (!query) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await fetch(`/api/map/points?${query}`, { signal: controller.signal });
      if (!response.ok) return;
      const body = await response.json();
      const points = [...(body.features ?? []), ...(body.candidates ?? [])]
        .filter((feature) => feature?.geometry?.type === "Point");
      setFeatures(points);
      setStatus(`${points.length} places drawn`);
    } catch (error) {
      if (error?.name !== "AbortError") console.error("map points failed", error);
    }
  }, []);

  const onViewport = useCallback((viewport) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => load(viewport), REFETCH_DEBOUNCE_MS);
  }, [load]);

  return (
    <div className="vector-map">
      <MapCanvas
        center={LOS_ANGELES}
        zoom={12}
        basemap={basemap}
        onViewport={onViewport}
        onBackgroundClick={() => setSelected(null)}
        className="vector-map-surface"
      >
        {!bare && (
          <>
            <PinLayer
              features={features}
              selectedKey={selected?.key ?? null}
              onSelect={setSelected}
            />
            <AreaLayer areas={[]} />
            <RouteLine positions={[]} />
          </>
        )}
      </MapCanvas>

      <div className="vector-map-switch" role="group" aria-label="Base map">
        {MAP_LAYERS.map((layer) => (
          <button
            key={layer.id}
            type="button"
            aria-pressed={layer.id === basemap.id}
            className={layer.id === basemap.id ? "is-on" : ""}
            onClick={() => setBasemapId(layer.id)}
          >
            {layer.label}
          </button>
        ))}
      </div>

      <p className="vector-map-status" role="status">
        {status}{selected ? ` · picked a place with ${selected.label || "1"} film(s)` : ""}
      </p>
    </div>
  );
}
