// One film, at an address (#146).
//
// Everything on this page already existed and nothing rendered it. `/api/work` has
// answered with the sentence each source stated, the precision badge, the evidence count
// and — since #129 — how many degrees each place stands from the film, and the only
// surface in the product was a map you had to drag to. 6,392 works hold at least one
// located place; none of them had a URL.
//
// **Rendered on the server, deliberately.** The point of the page is that a link to it can
// be sent, opened cold and indexed. A client-side fetch would give a shareable URL whose
// content is invisible to anything that does not run JavaScript, which is most of what
// receives a shared link.
//
// The route handler is called directly rather than over HTTP: it is a function in this
// same process, and a server component fetching its own API needs an absolute origin it
// has no reliable way to know.

import Link from "next/link";
import { notFound } from "next/navigation";

import { GET as workRoute } from "../../api/work/route.js";
import WorkMiniMap from "../../components/WorkMiniMap.jsx";
import {
  candidatesNote, coverageLine, firstAndRest, mapLinkFor, miniMapPoints, placeBlocks, stillsCaption, workLinks,
} from "../../lib/work-card.mjs";
import { placePath } from "../../lib/place-url.mjs";
import { workIdFromSlug, workPath } from "../../lib/work-url.mjs";

export const dynamic = "force-dynamic";

async function loadWork(slug) {
  const id = workIdFromSlug(slug);
  if (!id) return null;
  const response = await workRoute(
    new Request(`https://glorymap.local/api/work?id=${encodeURIComponent(id)}`),
  );
  if (!response.ok) return null;
  const payload = await response.json();
  // `/api/work` ALWAYS returns a `work` object — for a work we do not hold it is that
  // object with every field null and `in_graph: false`, because the route is built to
  // still show a poster and links for a film reached live from Wikidata. Keying the page
  // on its presence therefore rendered a blank card under HTTP 200 for any stale or
  // mistyped uuid. A page needs something to print, and the title is the minimum.
  return payload?.work?.title ? payload : null;
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const data = await loadWork(slug);
  if (!data) return { title: "Not found · GloryMap" };
  const { work, places, candidates, candidates_total: candidatesTotal } = data;
  const count = Array.isArray(places) ? places.length : 0;
  const waiting = Number(candidatesTotal) || (Array.isArray(candidates) ? candidates.length : 0);
  return {
    title: `${work.title}${work.year ? ` (${work.year})` : ""} · GloryMap`,
    // The description states the count rather than selling the page. A film we hold one
    // place for should not be advertised as a tour, and one whose places are all still
    // candidates must not be described as though somebody had checked them.
    description: count > 0
      ? `${count} place${count === 1 ? "" : "s"} recorded for ${work.title}, each with the source that stated it.`
      : waiting > 0
        ? `${waiting} unconfirmed place${waiting === 1 ? "" : "s"} for ${work.title}, each with the guide that reported it.`
        : `No places recorded for ${work.title} yet.`,
  };
}

// `href` is passed in rather than derived from the row, because this component renders two
// different kinds of thing. A FACT has a canonical place behind it and a page of its own.
// A CANDIDATE has neither — its id is a queue row's, and linking it would send the reader
// to a 404 while implying we hold a place we have not agreed to hold.
function PlaceRow({ place, href = null }) {
  return (
    <li className="work-place">
      <div className="work-place-head">
        <h3>{href ? <Link href={href}>{place.name}</Link> : place.name}</h3>
        {/* The lot badge leads, because it is the one that changes what the reader should
            do with the row: a precision of "Exact point" over a backlot is exact about a
            place they cannot go, for a scene set 3,000 km away. */}
        {place.depicts_elsewhere && <span className="work-badge is-studio">Studio lot</span>}
        {place.precision && <span className="work-badge">{place.precision}</span>}
      </div>
      {/* The source's own words when we have them; the template only when we do not. */}
      {place.sentence && <p className="work-place-sentence">{place.sentence}</p>}
      {/* Built as a list and joined, not concatenated with separators: most of our places
          carry no city, and a hand-written " · " prefix leaves a dangling dot in front of
          every one of them. Evidence count is printed even when it is zero — a place with
          nothing recorded behind it is a thing a reader is entitled to notice. */}
      <p className="work-place-meta">
        {[
          [place.city, place.country].filter(Boolean).join(", "),
          place.role_label,
          // Said plainly rather than left to be noticed: 10,981 queue rows have no
          // coordinate, and a row listed without one would otherwise send the reader
          // looking for a pin that was never there.
          place.mappable === false ? "No coordinate yet — not on the map" : null,
          typeof place.evidence_count === "number"
            ? `${place.evidence_count} source${place.evidence_count === 1 ? "" : "s"}`
            : null,
        ].filter(Boolean).join(" · ")}
      </p>
      {place.source_url && (
        <a className="work-place-source" href={place.source_url} target="_blank" rel="noopener noreferrer">
          Where this came from
        </a>
      )}
    </li>
  );
}

// UX-7: a block prints its first ten rows; the rest stay on the page, behind one
// "Show all" toggle, so a work with 900 rows is not 18,000 px of cards on a phone.
function PlaceList({ rows, hrefFor = () => null, keyFor }) {
  const { first, rest } = firstAndRest(rows);
  return (
    <>
      <ul className="work-places">
        {first.map((place) => <PlaceRow key={keyFor(place)} place={place} href={hrefFor(place)} />)}
      </ul>
      {rest.length > 0 && (
        <details className="work-show-all">
          <summary>Show all {rows.length}</summary>
          <ul className="work-places">
            {rest.map((place) => <PlaceRow key={keyFor(place)} place={place} href={hrefFor(place)} />)}
          </ul>
        </details>
      )}
    </>
  );
}

export default async function WorkPage({ params }) {
  const { slug } = await params;
  const data = await loadWork(slug);
  if (!data) notFound();

  const {
    work, places = [], tally, stills = [], stills_verified: verified, stills_note: note,
    ratings = [], links = [], candidates = [], candidates_total: candidatesTotal = candidates.length,
  } = data;
  const blocks = placeBlocks(places);
  const caption = stillsCaption({ stills, verified, note });
  const canonical = workPath(work);
  const points = miniMapPoints({ places, candidates });

  return (
    <main className="work-page">
      <header className="work-header">
        <Link className="work-back" href="/">← Map</Link>
        <div className="work-title-row">
          {work.poster && <img className="work-poster" src={work.poster} alt="" width="76" height="114" />}
          <div>
            <h1>
              {work.title}
              {work.year && <span className="work-year"> ({work.year})</span>}
            </h1>
            {/* Coverage before anything else. Thin coverage and a broken page look identical
                otherwise, and thin is the normal state here. */}
            <p className="work-coverage">{coverageLine({ places, tally, candidates: candidatesTotal })}</p>
          </div>
        </div>
        <WorkMiniMap points={points} href={mapLinkFor(points)} title={work.title} />
        {!work.in_graph && (
          <p className="work-note">
            This work is not in our graph — what follows comes from what we could look up live.
          </p>
        )}
        <div className="work-links">
          {workLinks(links).map((link) => (
            <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
          ))}
        </div>
        {ratings.length > 0 && (
          <ul className="work-ratings">
            {ratings.map((rating) => (
              <li key={rating.source}>
                {rating.url
                  ? <a href={rating.url} target="_blank" rel="noopener noreferrer">{rating.display}</a>
                  : rating.display}
                <small>{rating.source.replace(/_/g, " ")}</small>
              </li>
            ))}
          </ul>
        )}
      </header>

      {blocks.map((block) => (
        <section
          key={block.distance}
          className={`work-block${block.routable ? "" : " is-aside"}`}
          aria-label={block.heading}
        >
          <h2>{block.heading}</h2>
          <p className="work-block-note">{block.note}</p>
          {/* The other end of the same table (#129, step 4). A place where two films
              meet has a page showing both, and this link is the only way into it from a
              card that can only ever show one of them. */}
          <PlaceList rows={block.places} hrefFor={placePath} keyFor={(place) => place.fact_id ?? place.id} />
        </section>
      ))}

      {candidates.length > 0 && (
        // Set apart with the same treatment distance 2 gets, and for the same reason: a
        // reader must never mistake a row nobody has checked for one we stand behind.
        // Nothing here is in the graph, and the block says so before the first row.
        <section className="work-block is-aside" aria-label="Unconfirmed places">
          <h2>Unconfirmed places</h2>
          <p className="work-block-note">{candidatesNote(candidates.length, candidatesTotal)}</p>
          <PlaceList rows={candidates} keyFor={(candidate) => candidate.id} />
        </section>
      )}

      {stills.length > 0 && (
        <section className="work-block" aria-label="Frames">
          <h2>Frames</h2>
          {/* Two tiers, and conflating them is a failure this project already shipped
              once. Unmatched frames belong to the film and say so; nothing here is pinned
              to a street without a place_frames row behind it. */}
          <p className="work-block-note">{caption}</p>
          <div className="work-stills">
            {stills.map((still) => (
              <img key={still.url} src={still.url} alt="" loading="lazy" />
            ))}
          </div>
        </section>
      )}

      <footer className="work-footer">
        <a href={canonical}>Permanent link to this film</a>
        {" · "}
        {/* The way out of a single card and into the rest of the catalogue. Without it a
            shared link is a dead end: the reader has one film and no way to learn there
            are 6,392 more. */}
        <Link href="/directory">Browse the directory</Link>
      </footer>
    </main>
  );
}
