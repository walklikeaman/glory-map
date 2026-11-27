// The preview card for /work/<slug>, and for a shared map link to the same work (#77 rest):
// the poster, the title, how many places we hold and the first few of them. No scenes and
// no story stops, so a shared trail spoils nothing.

import { ImageResponse } from "next/og";

import { workIdFromSlug } from "../../lib/work-url.mjs";
import { workShareModel } from "../../lib/work-share-card.mjs";
import { loadWorkForPreview } from "../load-work.js";

export const runtime = "nodejs";
export const alt = "Film places on GloryMap";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#080909";
const PAPER = "#f4efe4";
const POSTER_WIDTH = 420;

export default async function Image({ params }) {
  const { slug } = await params;
  // A card is still drawn when the work is gone or the read fails: a broken preview image
  // is worse than a plain one.
  const model = workShareModel(await loadWorkForPreview(workIdFromSlug(slug)));

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: INK, color: PAPER }}>
        {model?.posterUrl && (
          <img src={model.posterUrl} width={POSTER_WIDTH} height={630} style={{ width: POSTER_WIDTH, height: 630, objectFit: "cover" }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, padding: "56px 56px 48px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ display: "flex", fontSize: 64, lineHeight: 1.1, fontWeight: 700 }}>
              {model ? model.name : "Film places to walk to"}
            </span>
            {model && (
              <span style={{ display: "flex", marginTop: 24, fontSize: 36, opacity: 0.85 }}>{model.placesLine}</span>
            )}
            {model?.placeNames.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 28, fontSize: 30, opacity: 0.75 }}>
                {model.placeNames.map((name, index) => (
                  <span key={index} style={{ display: "flex", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 680 }}>
                    · {name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <span style={{ display: "flex", fontSize: 32, opacity: 0.75 }}>GloryMap</span>
        </div>
      </div>
    ),
    size,
  );
}
