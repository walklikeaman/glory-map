// One visitor's shot, at an address somebody can send (#54 rest). The preview card that a
// messenger shows for the link is `opengraph-image.jsx` beside this file.
//
// Server-rendered like the work and place pages: a shared link is opened cold, often by a
// crawler that runs no script.

import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { loadSharedShot } from "../../api/shots/route.js";
import { SITE_URL } from "../../lib/site-url.mjs";
import { shotPath } from "../../lib/shot-page.mjs";

export const dynamic = "force-dynamic";

// The metadata and the page ask for the same shot in one request: one read, one signing.
const getShot = cache((id) => loadSharedShot(id));

export async function generateMetadata({ params }) {
  const { id } = await params;
  const shot = await getShot(id);
  if (!shot) return { title: "Not found · GloryMap", robots: { index: false } };
  const title = `${shot.title} · GloryMap`;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description: shot.description,
    alternates: { canonical: shotPath(shot.id) },
    openGraph: { title, description: shot.description, url: shotPath(shot.id), type: "article", siteName: "GloryMap" },
    twitter: { card: "summary_large_image", title, description: shot.description },
  };
}

export default async function ShotPage({ params }) {
  const { id } = await params;
  const shot = await getShot(id);
  if (!shot) notFound();

  return (
    <main className="work-page shot-page">
      <header className="work-header">
        <Link className="work-back" href="/">← Map</Link>
        <h1>{shot.title}</h1>
        {shot.caption && <p className="work-coverage">{shot.caption}</p>}
      </header>
      <div className={shot.frameUrl ? "shot-pair" : "shot-single"}>
        {shot.frameUrl && (
          <figure>
            <img src={shot.frameUrl} alt="The film's frame" />
            <figcaption>Then</figcaption>
          </figure>
        )}
        <figure>
          <img src={shot.url} alt={shot.caption ?? "A visitor's photo of this place"} />
          <figcaption>{shot.frameUrl ? "Now" : "Today"}</figcaption>
        </figure>
      </div>
      <p className="shot-page-note">
        A photo shows how the place looks today. It does not prove a film was shot here.
      </p>
      <div className="work-links">
        <Link href="/">Find more film places on GloryMap</Link>
      </div>
    </main>
  );
}
