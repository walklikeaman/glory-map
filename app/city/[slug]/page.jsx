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
import { GET as mapPointsRoute } from "../../api/map/points/route.js";
import WorkMiniMap from "../../components/WorkMiniMap.jsx";
import { findCity } from "../../lib/city-gazetteer.mjs";
import { cityBox, cityCoverage, cityMapPoints, cityWorkLine } from "../../lib/directory.mjs";
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

// UX-8: the pins for the small map, asked of the same handler the big map uses. A map
// that fails to load is not a reason to fail the page, so any error is an empty map.
async function loadCityPoints(city) {
  try {
    const box = cityBox(city);
    const url = new URL("https://glorymap.local/api/map/points");
    for (const [key, value] of Object.entries(box)) url.searchParams.set(key, value.toFixed(4));
    url.searchParams.set("z", "12");
    url.searchParams.set("candidates", "1");
    const response = await mapPointsRoute(new Request(url));
    return response.ok ? cityMapPoints(await response.json()) : [];
  } catch {
    return [];
  }
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

  const [data, mapPoints] = await Promise.all([
    loadCity(slug, requestedPage),
    loadCityPoints(findCity(slug)),
  ]);
  if (!data) notFound();

  const { city, works = [], points = 0, page } = data;
  const base = `/city/${city.slug}`;
  const walkHref = `/?city=${city.slug}`;

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
        {/* UX-8: the call to action is the product's own: open this city on the map. */}
        <a className="wide-button city-walk" href={walkHref}>Walk {city.name}</a>
        <WorkMiniMap points={mapPoints} center={[city.lat, city.lng]} zoom={11} />
        {page.total > 0 && (
          <p className="directory-note">
            Showing {page.from}–{page.to}, the best-covered first.
          </p>
        )}
      </header>

      <ul className="directory-works is-city">
        {works.map((work) => (
          <li key={work.id}>
            <Link href={workPath(work) ?? base}>
              {work.poster
                ? <img className="directory-poster" src={work.poster} alt="" loading="lazy" width="56" height="84" />
                : <span className="directory-poster is-empty" aria-hidden="true" />}
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
