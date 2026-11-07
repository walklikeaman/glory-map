// Where this app lives, said once.
//
// The sitemap and the robots file are the two documents that MUST carry absolute URLs — a
// relative `<loc>` is ignored by every crawler that reads one — so the origin cannot be
// left implicit the way it is on every link inside a page.
//
// Vercel exposes `VERCEL_URL`, which is the DEPLOYMENT's hostname and not the canonical
// one: building the sitemap from it would publish, on every preview, a list of URLs that
// die with that deployment. So the production domain is the default and the override is an
// explicit variable, for anybody serving this somewhere else.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://glory-map.vercel.app";
