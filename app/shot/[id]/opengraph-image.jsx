// The preview card a messenger shows for /shot/<id>: the visitor's photo, or the film's
// frame beside it for a recreation, with the place under it (#54 rest).

import { ImageResponse } from "next/og";

import { loadSharedShot } from "../../api/shots/route.js";

export const runtime = "nodejs";
export const alt = "A visitor's shot on GloryMap";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#080909";
const PAPER = "#f4efe4";

function Photo({ src, label, width }) {
  return (
    <div style={{ display: "flex", position: "relative", width, height: 520 }}>
      <img src={src} width={width} height={520} style={{ width, height: 520, objectFit: "cover" }} />
      <div style={{ position: "absolute", left: 18, top: 18, display: "flex", padding: "6px 14px", background: INK, color: PAPER, fontSize: 26, borderRadius: 6 }}>
        {label}
      </div>
    </div>
  );
}

export default async function Image({ params }) {
  const { id } = await params;
  // A card is still drawn when the shot is gone or the read fails: a broken preview image
  // is worse than a plain one.
  const shot = await loadSharedShot(id).catch(() => null);
  const footer = shot?.placeName ?? (shot ? "A film location" : "Film places to walk to");

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: INK, color: PAPER }}>
        <div style={{ display: "flex", gap: 10, height: 520 }}>
          {shot?.frameUrl && <Photo src={shot.frameUrl} label="Then" width={595} />}
          {shot && <Photo src={shot.url} label={shot.frameUrl ? "Now" : "Today"} width={shot.frameUrl ? 595 : 1200} />}
          {!shot && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 1200, fontSize: 72 }}>
              GloryMap
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 110, padding: "0 36px", fontSize: 36 }}>
          <span style={{ display: "flex", maxWidth: 900, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{footer}</span>
          <span style={{ display: "flex", fontSize: 30, opacity: 0.75 }}>GloryMap</span>
        </div>
      </div>
    ),
    size,
  );
}
