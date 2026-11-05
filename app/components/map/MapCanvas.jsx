"use client";

// The map itself, drawn by MapLibre (#202, phase 3).
//
// This replaces `<MapContainer>` from react-leaflet and everything under it. The reason is
// measured rather than fashionable: Leaflet draws one DOM element per pin, and dragging Los
// Angeles with 1,008 of them up runs at 30 fps against 120 fps for the same places as a GPU
// layer (#197). Two further reasons came out of the work — the app was shipping BOTH engines
// (`maplibre-gl` was already a dependency, used only as a backdrop inside Leaflet), and
// `react-leaflet` is licensed Hippocratic-2.1, which is not an OSI licence.
//
// The API here deliberately mirrors the shape the app already used — a component that owns
// the map, children that draw into it, a hook that reaches it — so the swap is a change of
// engine rather than a change of architecture.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react";

import "maplibre-gl/dist/maplibre-gl.css";

const MapContext = createContext(null);

// **This component takes `[lat, lng]`, like everything else in the app.**
//
// Leaflet orders a coordinate latitude-first and MapLibre orders it longitude-first, and the
// app is written throughout in the Leaflet order. Passing `mapCenter` straight through threw
// `Invalid LngLat latitude value: must be between -90 and 90` — for Los Angeles, because
// −118 is not a latitude. London would have been WORSE: 51.5 and −0.11 are both valid either
// way round, so the map would have opened silently in the Gulf of Guinea.
function toLngLat(point) {
  if (!point) return null;
  const [lat, lng] = Array.isArray(point) ? point : [point.lat, point.lng];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

// The map instance, for children that draw into it. The equivalent of react-leaflet's
// `useMap`, and named for it so the components that move across read the same.
export function useMapCanvas() {
  return useContext(MapContext);
}

// A raster basemap is one source and one layer; a vector basemap is a whole style document.
// Both arrive here as an entry from `map-layers.mjs`, and this is the only place that knows
// the difference.
function styleFor(layer) {
  if (layer.vector) return layer.vector;

  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [layer.url],
        tileSize: 256,
        maxzoom: layer.maxZoom ?? 19,
        attribution: layer.attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

export default function MapCanvas({
  center,
  zoom = 12,
  minZoom = 3,
  maxZoom = 19,
  basemap,
  onViewport,
  onBackgroundClick,
  children,
  className = "",
}) {
  const containerRef = useRef(null);
  const [map, setMap] = useState(null);
  const styleEpoch = useRef(0);

  // Callbacks are read through refs so that a parent re-render cannot tear the map down and
  // rebuild it. The map outlives every render; only its style and its layers change.
  const viewportRef = useRef(onViewport);
  viewportRef.current = onViewport;
  const backgroundRef = useRef(onBackgroundClick);
  backgroundRef.current = onBackgroundClick;

  useEffect(() => {
    let cancelled = false;
    let instance = null;

    (async () => {
      // `mod.default ?? mod`, never `{ default: … }`. Destructuring the default gave
      // `undefined` under this bundler and threw at the constructor — and the same mistake,
      // made in the Leaflet path, is why the vector basemap silently drew nothing for
      // months while a raster fallback covered for it.
      const mod = await import("maplibre-gl");
      const maplibregl = mod.default ?? mod;
      if (cancelled || !containerRef.current) return;

      // MapLibre spawns its tile worker with `new Worker(url, { type: "module" })`, and that
      // URL is not served under Next.js — the browser refuses the HTML 404 for its MIME
      // type, the worker dies on its first import, and the map then parses a style and
      // stops: no source loads, no tile is requested, nothing is drawn, and nothing is said.
      // `scripts/copy-maplibre-worker.mjs` puts the worker AND the chunk it imports in
      // `public/` before every dev and build.
      maplibregl.setWorkerUrl?.("/maplibre-gl-worker.mjs");

      instance = new maplibregl.Map({
        container: containerRef.current,
        style: styleFor(basemap),
        center: toLngLat(center) ?? [0, 0],
        zoom,
        minZoom,
        maxZoom,
        // **Automatic, not forced compact — and that distinction is a licence term.**
        //
        // MapTiler requires the attribution to be visible and readable, and allows it behind
        // a one-tap control ONLY on small screens. Forcing `compact: true` hid it on the
        // desktop too, which is not something their terms permit. Omitting the option is
        // exactly right: MapLibre compacts on its own when the map is too narrow for the
        // text, and shows it in full when there is room.
        //
        // On the free plan MapTiler also requires their logo, which rides in
        // `customAttribution` when a MapTiler style is the one being drawn.
        attributionControl: {
          customAttribution: basemap.attribution?.includes("MapTiler")
            ? '<a href="https://www.maptiler.com" target="_blank" rel="noreferrer">'
              + '<img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler" '
              + 'width="60" height="16" style="vertical-align:middle" /></a>'
            : undefined,
        },
      });

      instance.on("error", (event) => {
        // Registering this handler REPLACES MapLibre's own logging, so it must report
        // whatever it does not handle. A quiet handler here cost hours once.
        console.error("maplibre:", event?.error?.status ?? "", event?.error?.message ?? event?.error);
      });

      const publish = () => {
        const bounds = instance.getBounds();
        viewportRef.current?.({
          bounds: {
            west: bounds.getWest(), east: bounds.getEast(),
            south: bounds.getSouth(), north: bounds.getNorth(),
          },
          center: instance.getCenter(),
          zoom: instance.getZoom(),
        });
      };

      instance.on("moveend", publish);
      instance.on("zoomend", publish);

      // A click that hit no feature of ours is a click on the map, which is how a reader
      // dismisses the open card. Children register their own handlers on their own layers;
      // MapLibre delivers those first, and a handled click sets `_glorymapHandled` on the
      // original event so this one can stand down.
      instance.on("click", (event) => {
        if (event.originalEvent?._glorymapHandled) return;
        backgroundRef.current?.();
      });

      // Only once the style is up may layers be added. `styledata` fires repeatedly DURING
      // the first load, and attaching layers to a half-parsed style stalls MapLibre with no
      // error at all — so children are mounted on `load` and re-mounted after a style swap.
      instance.once("load", () => {
        if (cancelled) return;
        publish();
        setMap(instance);
      });
    })();

    return () => {
      cancelled = true;
      instance?.remove();
      setMap(null);
    };
    // Built once. The basemap is changed with `setStyle` below rather than by rebuilding,
    // which would throw away the reader's position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swapping the basemap replaces the style wholesale, and the new style carries none of our
  // layers. Children re-add themselves when `styleEpoch` changes, which is what the key on
  // the provider below is for.
  const [epoch, setEpoch] = useState(0);
  const drawnBasemap = useRef(basemap?.id ?? null);

  useEffect(() => {
    if (!map) return undefined;

    // **Only swap the style when it is actually a different one.**
    //
    // This effect used to call `setStyle` unconditionally the moment the map appeared —
    // including on first load, where the style being set was the style already loaded.
    // `setStyle` tears down every layer, so the children remounted and tried to re-add
    // theirs into a style that was still being replaced. `addSource` threw, the catch
    // swallowed it, and nothing retried: the map drew a basemap and **not one pin**, with
    // no error anywhere. It raced, so it worked some of the time, which is worse.
    if (drawnBasemap.current === basemap.id) return undefined;
    drawnBasemap.current = basemap.id;

    map.setStyle(styleFor(basemap));
    const onStyle = () => {
      styleEpoch.current += 1;
      setEpoch(styleEpoch.current);
    };
    map.once("styledata", onStyle);
    return () => { map.off("styledata", onStyle); };
  }, [map, basemap]);

  return (
    <div className={`map-canvas ${className}`.trim()}>
      <div ref={containerRef} className="map-canvas-surface" />
      {map && (
        <MapContext.Provider value={map} key={epoch}>
          {children}
        </MapContext.Provider>
      )}
    </div>
  );
}

// Marks a click as belonging to a feature, so the map's own background handler stands down.
// Exported because every layer that answers clicks needs it, and a second copy of this
// convention would be a second way for a click to be swallowed.
export function claimClick(event) {
  if (event?.originalEvent) event.originalEvent._glorymapHandled = true;
}

// Adding a source and a layer is the same four lines everywhere, and doing it wrong is
// always the same two mistakes: adding twice after a style swap, and adding to a style that
// is being replaced. This does both safely and removes what it added.
// `source` adds options to the GeoJSON source (clustering). It is read once, when the source
// is created: MapLibre cannot switch clustering on an existing source.
export function useGeoJsonLayer({ id, data, layers, source = null }) {
  const map = useMapCanvas();
  // Bumped when an add failed, so the effect runs again once the style settles.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!map) return undefined;

    try {
      if (!map.getSource(id)) {
        map.addSource(id, { ...source, type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      for (const layer of layers) {
        if (!map.getLayer(layer.id)) map.addLayer({ ...layer, source: id });
      }
    } catch (error) {
      // The style was being replaced under us. Retry when it settles rather than giving up
      // for ever: these deps are [map, id], so without a retry this layer is never added
      // again and the map silently draws nothing.
      console.error("map layer:", error?.message ?? error);
      const retry = () => {
        map.off("idle", retry);
        setAttempt((value) => value + 1);
      };
      map.on("idle", retry);
      return () => map.off("idle", retry);
    }

    return () => {
      for (const layer of layers) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      }
      if (map.getSource(id)) map.removeSource(id);
    };
    // `layers` is a literal built in the caller's render; its identity is not meaningful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id, attempt]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource(id);
    if (source) source.setData(data);
  }, [map, id, data]);

  return map;
}

export { MapContext };
