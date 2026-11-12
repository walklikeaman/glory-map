// One letter of the catalogue (#158) — the page that finally gives every work a link.
//
// This is the crawlable half of the directory: 27 pages between them address all 6,392
// works we hold a located place for, each row a real URL to the film card built in #146.

import Link from "next/link";
import { notFound } from "next/navigation";

import { GET as filmsRoute } from "../../../api/directory/films/route.js";
import { OTHER_LETTER, letterFromSlug, letterToSlug } from "../../../lib/directory.mjs";
import { workPath } from "../../../lib/work-url.mjs";
import { readRoute, retryOn502 } from "../../../lib/page-load.mjs";

export const dynamic = "force-dynamic";

function letterLabel(letter) {
  return letter === OTHER_LETTER ? "#" : letter.toUpperCase();
}

async function loadLetter(slug, page) {
  const url = new URL("https://glorymap.local/api/directory/films");
  url.searchParams.set("letter", slug);
  if (page) url.searchParams.set("page", page);
  const response = await retryOn502(() => filmsRoute(new Request(url)));
  return readRoute(response, "The directory");
}

export async function generateMetadata({ params }) {
  const { letter: slug } = await params;
  const letter = letterFromSlug(slug);
  if (!letter) return { title: "Not found · GloryMap" };
  return {
    title: `Films under ${letterLabel(letter)} · GloryMap`,
    description: `Every film and series under ${letterLabel(letter)} that we hold a source-backed place for.`,
  };
}

export default async function DirectoryLetterPage({ params, searchParams }) {
  const { letter: slug } = await params;
  const { page: requestedPage } = (await searchParams) ?? {};
  if (!letterFromSlug(slug)) notFound();

  const data = await loadLetter(slug, requestedPage);
  if (!data) notFound();

  const { letter, works = [], page } = data;
  const base = `/directory/films/${letterToSlug(letter)}`;

  return (
    <main className="directory-page">
      <header className="directory-header">
        <Link className="work-back" href="/directory">← Directory</Link>
        <h1>{letterLabel(letter)}</h1>
        <p className="directory-lede">
          {page.total === 0
            ? "Nothing under this letter yet."
            : `${page.from}–${page.to} of ${page.total} film${page.total === 1 ? "" : "s"}.`}
        </p>
      </header>

      <ul className="directory-works">
        {works.map((work) => (
          <li key={work.id}>
            <Link href={workPath(work) ?? "/directory"}>
              <span className="directory-work-title">
                {work.title}
                {work.year ? <span className="work-year"> ({work.year})</span> : null}
              </span>
              {/* Printed for every row, including the ones that say 1. 2,667 of the works
                  here hold exactly one place, and a directory that hides that is selling
                  a tour it cannot walk. */}
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
