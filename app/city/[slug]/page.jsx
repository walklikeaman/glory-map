// A city, as an address somebody can send (#158).
//
// The films with a place inside this city's disc, most-covered first, each linking to its
// card. The page is deliberately not "films made in <city>": we hold what our sources
// stated, and what this page can honestly promise is what we hold within a stated radius
// of a measured centre. The header says so rather than implying a completeness we do not
// have — 41.7% of the works in the catalogue hold exactly one place.

import Link from "next/link";
import { notFound } from "next/navigation";

import { GET as cityRoute } from "../../api/directory/city/route.js";
import { findCity } from "../../lib/city-gazetteer.mjs";
import { cityCoverage, cityWorkLine } from "../../lib/directory.mjs";
import { workPath } from "../../lib/work-url.mjs";
import { readRoute } from "../../lib/page-load.mjs";

export const dynamic = "force-dynamic";

async function loadCity(slug, page) {
  const url = new URL("https://glorymap.local/api/directory/city");
  url.searchParams.set("slug", slug);
  if (page) url.searchParams.set("page", page);
  const response = await cityRoute(new Request(url));
  return readRoute(response, "The city page");
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const city = findCity(slug);
  if (!city) return { title: "Not found · GloryMap" };
  return {
    title: `${city.name} · GloryMap`,
    description: `Films and series with places recorded within ${city.radius_km} km of ${city.name}, each with the source that stated it.`,
  };
}

export default async function CityPage({ params, searchParams }) {
  const { slug } = await params;
  const { page: requestedPage } = (await searchParams) ?? {};
  // Resolved against the gazetteer before anything is asked of the database, so an
  // invented slug is a 404 rather than a query.
  if (!findCity(slug)) notFound();

  const data = await loadCity(slug, requestedPage);
  if (!data) notFound();

  const { city, works = [], points = 0, page } = data;
  const base = `/city/${city.slug}`;

  return (
    <main className="directory-page">
      <header className="directory-header">
        <Link className="work-back" href="/directory">← Directory</Link>
        <h1>
          {city.name}
          <span className="work-year"> · {city.country}</span>
        </h1>
        <p className="directory-lede">
          {cityCoverage({ works: page.total, points, radiusKm: city.radius_km })}
        </p>
        {page.total > 0 && (
          <p className="directory-note">
            Showing {page.from}–{page.to}, the best-covered first. The centre is{" "}
            {city.lat.toFixed(4)}, {city.lng.toFixed(4)}
            {city.anchor === "wikidata"
              ? " — the city's own Wikidata coordinate, because we hold too few places here to measure one."
              : " — measured from the places we hold, not taken from a gazetteer, so it sits where the filming is rather than at the town hall."}
          </p>
        )}
      </header>

      <ul className="directory-works is-city">
        {works.map((work) => (
          <li key={work.id}>
            <Link href={workPath(work) ?? base}>
              <span className="directory-work-title">
                {work.title}
                {work.year ? <span className="work-year"> ({work.year})</span> : null}
              </span>
              {/* The place names themselves, not just a number: a row that says
                  "Blackfriars Bridge · Australia House" is a reason to open the card. */}
              <span className="directory-work-places">{cityWorkLine(work)}</span>
              <span className="directory-count">
                {work.place_count} place{work.place_count === 1 ? "" : "s"}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {page.pages > 1 && (
        <nav className="directory-pager" aria-label="Pages">
          {page.hasPrev ? (
            <Link href={page.page === 2 ? base : `${base}?page=${page.page - 1}`}>← Previous</Link>
          ) : (
            <span />
          )}
          <span className="directory-pager-state">
            Page {page.page} of {page.pages}
          </span>
          {page.hasNext ? <Link href={`${base}?page=${page.page + 1}`}>Next →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
