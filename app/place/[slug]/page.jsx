// One place, at an address — and the answer to the question a film card cannot answer
// (step 4 of #129).
//
// A film card shows every place in one film. This shows every film at one place, and the
// difference is not cosmetic: 6 of the 70 places in the graph carry facts from more than
// one subject, and those six are exactly the pages no work card can ever show. Trafalgar
// Square is three films; a reader standing in it deserves all three.
//
// Rendered on the server for the same reason `/work/[slug]` is: the point of a page is
// that its link can be sent, opened cold and indexed, and a client-side fetch gives a URL
// whose content is invisible to most of what receives a shared link. The route handler is
// called directly rather than over HTTP — it is a function in this same process, and a
// server component fetching its own API needs an absolute origin it cannot reliably know.

import Link from "next/link";
import { notFound } from "next/navigation";

import { GET as placeRoute } from "../../api/place/route.js";
import { depictsElsewhereNote, placeCoverage, sceneLabel, subjectNoun } from "../../lib/place-card.mjs";
import { googleMapsUrl, streetViewUrl } from "../../lib/place-links.mjs";
import { placeIdFromSlug, placePath } from "../../lib/place-url.mjs";
import { placeBlocks } from "../../lib/work-card.mjs";
import { workPath } from "../../lib/work-url.mjs";
import { readRoute } from "../../lib/page-load.mjs";

export const dynamic = "force-dynamic";

async function loadPlace(slug) {
  const id = placeIdFromSlug(slug);
  // A slug carrying no uuid is not a place, and it is answered here rather than by asking
  // the database about a string somebody typed.
  if (!id) return null;
  const response = await placeRoute(
    new Request(`https://glorymap.local/api/place?id=${encodeURIComponent(id)}`),
  );
  const payload = await readRoute(response, "The place page");
  // The route 404s a place with no rows, so anything that got here has facts. The title is
  // still the minimum a page needs to print.
  return payload?.place?.name ? payload : null;
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const data = await loadPlace(slug);
  if (!data) return { title: "Not found · GloryMap" };
  const { place, facts = [] } = data;
  return {
    title: `${place.name} · GloryMap`,
    // States what is recorded rather than selling the place. A doorway with one fact must
    // not be advertised as a landmark.
    description: placeCoverage(facts) ?? `No facts recorded at ${place.name} yet.`,
  };
}

// One fact. The subject is the heading here — the place is the page, so repeating its name
// on every row would say nothing — and the source under it is the fact's OWN source, which
// on this card is a different page for every row.
function FactRow({ fact }) {
  const href = fact.subject_type === "work" && fact.subject_id
    ? workPath({ id: fact.subject_id, title: fact.subject_name })
    : null;
  const scene = sceneLabel(fact);

  return (
    <li className="work-place">
      <div className="work-place-head">
        <h3>
          {/* A creator has no page of its own yet ([[handoff]] — `creators` holds zero
              rows). Print the name; do not invent a link to something unbuilt. */}
          {href ? <Link href={href}>{fact.subject_name}</Link> : fact.subject_name}
        </h3>
        {fact.depicts_elsewhere && <span className="work-badge is-studio">Studio lot</span>}
        <span className="work-badge">{subjectNoun(fact)}</span>
      </div>
      {fact.sentence && <p className="work-place-sentence">{fact.sentence}</p>}
      {/* Joined from a list, never concatenated with separators: most rows carry no scene
          and no year, and a hand-written " · " prefix leaves a dangling dot on each of
          them. The evidence count is printed even at zero — a fact with nothing recorded
          behind it is a thing a reader is entitled to notice, and 8 of the graph's 92
          links are exactly that. */}
      <p className="work-place-meta">
        {[
          fact.role_label,
          scene,
          fact.stated_year,
          typeof fact.evidence_count === "number"
            ? `${fact.evidence_count} source${fact.evidence_count === 1 ? "" : "s"}`
            : null,
        ].filter(Boolean).join(" · ")}
      </p>
      {fact.sources?.length > 0
        ? (
          <p className="place-fact-sources">
            {fact.sources.map((source, index) => (
              <a
                key={source.url}
                className="work-place-source"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {index === 0 ? "Where this came from" : "Another source"}
              </a>
            ))}
          </p>
        )
        // Said out loud rather than left blank. A row with no line under it looks like a
        // row whose link failed to render, which is the opposite of what it means.
        : <p className="work-place-meta">No source recorded for this one.</p>}
    </li>
  );
}

export default async function PlacePage({ params }) {
  const { slug } = await params;
  const data = await loadPlace(slug);
  if (!data) notFound();

  const { place, facts = [] } = data;
  // The same blocks the film card uses, in the same order, with the same rule that
  // distance 2 is never a stop on a walk. Every fact in the graph today is distance 0, so
  // the lower blocks render nothing until `creators` holds rows — `placeBlocks` prints no
  // heading over an empty block, which is why building them now costs nothing.
  const blocks = placeBlocks(facts);
  const studio = depictsElsewhereNote(facts);
  const canonical = placePath(place);
  const maps = googleMapsUrl(place);
  const street = streetViewUrl(place);
  const where = [place.city, place.country].filter(Boolean).join(", ");

  return (
    <main className="work-page">
      <header className="work-header">
        <Link className="work-back" href="/">← Map</Link>
        <h1>{place.name}</h1>
        <p className="work-coverage">{placeCoverage(facts)}</p>
        {/* Said before the rows, not left to a label inside them. A reader who arrived at
            this address rather than at a film must not read "3 facts recorded here" as
            three films that happen here. */}
        {studio && <p className="work-note">{studio}</p>}
        <p className="place-where">
          {[where, place.precision].filter(Boolean).join(" · ")}
        </p>
        {/* The coordinate as text, in the form every maps app accepts when pasted. A copy
            button would need this page to become a client component, and selectable text
            is what a person on a phone actually uses. */}
        {place.coordinate && <p className="place-coordinate">{place.coordinate}</p>}
        <div className="work-links">
          {maps && <a href={maps} target="_blank" rel="noopener noreferrer">Open in Maps</a>}
          {/* The only free way to check whether this is the facade from the film without
              standing in front of it. A link to their product, on their terms — nothing is
              embedded. */}
          {street && <a href={street} target="_blank" rel="noopener noreferrer">Street View</a>}
          {place.source_url && (
            <a href={place.source_url} target="_blank" rel="noopener noreferrer">
              Wikidata
            </a>
          )}
        </div>
      </header>

      {blocks.map((block) => (
        <section
          key={block.distance}
          className={`work-block${block.routable ? "" : " is-aside"}`}
          aria-label={block.heading}
        >
          <h2>{block.heading}</h2>
          <p className="work-block-note">{block.note}</p>
          <ul className="work-places">
            {block.places.map((fact) => <FactRow key={fact.fact_id ?? fact.subject_id} fact={fact} />)}
          </ul>
        </section>
      ))}

      <footer className="work-footer">
        <a href={canonical}>Permanent link to this place</a>
        {" · "}
        <Link href="/directory">Browse the directory</Link>
      </footer>
    </main>
  );
}
