// The map. The app itself is client-only (HomeClient); this server shell exists so a shared
// map link, `/?work=<uuid>` from "Share trail", unfurls with the work's poster and place
// count instead of a bare "GloryMap" (#77 rest).

import HomeClient from "./HomeClient.jsx";
import { SITE_URL } from "./lib/site-url.mjs";
import { mapLinkTitle, sharedWorkId, trailOrderFromSearchParams, workShareModel } from "./lib/work-share-card.mjs";
import { loadWorkForPreview } from "./work/load-work.js";

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const id = sharedWorkId(params);
  if (!id) return {};
  // Never slower than 2.5 s and never an error: the map must open whatever the DB does.
  const model = workShareModel(await loadWorkForPreview(id), { trailOrder: trailOrderFromSearchParams(params) });
  if (!model?.path) return {};
  const title = mapLinkTitle(model);
  // The work page's own card, so the two links to one work unfurl alike.
  const images = [{ url: `${model.path}/opengraph-image`, width: 1200, height: 630, alt: model.name }];
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description: model.description,
    openGraph: { title, description: model.description, type: "website", siteName: "GloryMap", images },
    twitter: { card: "summary_large_image", title, description: model.description, images },
  };
}

export default function Home() {
  return <HomeClient />;
}
