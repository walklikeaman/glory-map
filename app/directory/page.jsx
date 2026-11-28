// The directory index (#158). The third surface, and the first one a search engine can
// walk: until this page existed, 6,392 works and 32,148 located rows were reachable only
// by typing a title into a box or dragging a map to them.
//
// Rendered on the server for the same reason the film card is — a page whose whole purpose
// is to be linked to and indexed cannot depend on JavaScript running. The route handlers
// are called directly rather than over HTTP: they are functions in this process, and a
// server component fetching its own API needs an absolute origin it cannot reliably know.

import Link from "next/link";

import { GET as citiesRoute } from "../api/directory/cities/route.js";
import { cityPath } from "../lib/city-gazetteer.mjs";
import {
  DIRECTORY_LETTERS,
  OTHER_LETTER,
  directorySummary,
  groupByCountry,
  letterToSlug,
} from "../lib/directory.mjs";
import { retryOn502 } from "../lib/page-load.mjs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Directory · GloryMap",
  description:
    "Every film and series we hold a source-backed place for, by city and by letter.",
};

async function loadIndex() {
  // The city totals query can hit the DB statement timeout once after a quiet spell
  // (QA 27.11); the letter pages already retry that, the index did not.
  const response = await retryOn502(() =>
    citiesRoute(new Request("https://glorymap.local/api/directory/cities")),
  );
  if (!response.ok) return null;
  return response.json();
}

export default async function DirectoryPage() {
  const data = await loadIndex();
  const cities = data?.cities ?? [];
  const letters = data?.letters ?? {};
  const works = data?.works ?? 0;
  const points = data?.points ?? 0;
  // Only cities we actually hold something for get a link. A directory whose entries are
  // mostly empty is the padded kind; the ones at zero are still counted in the sentence
  // below so the reader knows the list was filtered rather than short.
  const stocked = cities.filter((city) => (city.works ?? 0) > 0);
  const groups = groupByCountry(stocked);

  return (
    <main className="directory-page">
      <header className="directory-header">
        <Link className="work-back" href="/">← Map</Link>
        <h1>Directory</h1>
        <p className="directory-lede">
          {data
            ? directorySummary({ works, points, cities: stocked.length })
            : "The directory is unavailable right now."}
        </p>
        <p className="directory-note">
          A city here is a point and a radius, not a name — the films listed are the ones we
          hold a place for within {stocked[0]?.radius_km ?? 20} km of a measured centre. Most
          of what we hold is nowhere near any of these cities, so these counts do not add up
          to the total above.
        </p>
      </header>

      <section className="directory-block" aria-label="By city">
        <h2>By city</h2>
        {groups.length === 0 && <p className="directory-empty">No cities to browse yet.</p>}
        {groups.map((group) => (
          <div key={group.country} className="directory-country">
            <h3>{group.country}</h3>
            <ul className="directory-cities">
              {group.cities.map((city) => (
                <li key={city.slug}>
                  <Link href={cityPath(city)}>
                    <span className="directory-city-name">{city.name}</span>
                    {/* The count is the point of the row. A directory that hides how thin
                        an entry is makes the reader find out by clicking. */}
                    <span className="directory-count">{city.works}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="directory-block" aria-label="By title">
        <h2>By title</h2>
        <p className="directory-note">
          Filed by the first letter after any leading “the”, “a” or “an”, so The Third Man
          is under T for Third. Titles that begin with a number or another alphabet are
          under #.
        </p>
        <ul className="directory-letters">
          {DIRECTORY_LETTERS.map((letter) => {
            const count = letters[letter] ?? 0;
            return (
              <li key={letter}>
                {count > 0 ? (
                  <Link href={`/directory/films/${letterToSlug(letter)}`}>
                    <span className="directory-letter">
                      {letter === OTHER_LETTER ? "#" : letter.toUpperCase()}
                    </span>
                    <span className="directory-count">{count}</span>
                  </Link>
                ) : (
                  <span className="directory-letter is-empty">
                    {letter === OTHER_LETTER ? "#" : letter.toUpperCase()}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
