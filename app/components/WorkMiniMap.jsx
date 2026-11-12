"use client";

// UX-7: the work page opened on text. This small map shows where the film's places are
// before the list does, and links into the full map at the same spot.
import MapCanvas from "./map/MapCanvas.jsx";
import { FitPositions, MapMarker } from "./map/layers.jsx";
import { DEFAULT_LAYER_ID, layerById } from "../lib/map-layers.mjs";

const BASEMAP = layerById(DEFAULT_LAYER_ID);

// `center` + `zoom` (the city page) frame a fixed area; without them the map fits its pins.
export default function WorkMiniMap({ points = [], href = null, title = "", center = null, zoom = 13 }) {
  if (!points.length && !center) return null;
  const positions = points.map((point) => point.position);
  return (
    <figure className="work-minimap">
      <MapCanvas center={center ?? positions[0]} zoom={zoom} minZoom={0} basemap={BASEMAP} className="work-minimap-canvas">
        {!center && <FitPositions positions={positions} maxZoom={14} padding={28} />}
        {points.map((point, index) => (
          <MapMarker
            key={`${point.position.join(",")}:${index}`}
            position={point.position}
            className={`work-minimap-pin${point.confirmed ? "" : " is-unconfirmed"}`}
            title={point.name ?? undefined}
          />
        ))}
      </MapCanvas>
      {href && (
        <figcaption>
          <a href={href}>Open {title ? `${title} ` : ""}on the map</a>
        </figcaption>
      )}
    </figure>
  );
}
