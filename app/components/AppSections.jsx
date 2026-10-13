"use client";

// Map / Routes / Add / Collection / Profile (#22).
//
// Everything the app holds was one screen deep in the map's panel, and a visit, a want
// and a suggestion had nowhere to be seen together. The sections are views over state the
// map already owns: switching to one hides the place card and the panel, and switching
// back finds the city, the open place and the route where they were — nothing here
// resets anything.
//
// On a phone the menu is the bottom bar, where a thumb is; on a desktop it is a rail
// beside the panel, clear of the walk control at the bottom and the "Only my films" chip
// at the top.

import { useState } from "react";
import { Award, Check, Heart, LogIn, Map as MapIcon, MapPin, PlusCircle, Route, Trash2, User, X } from "lucide-react";

import { achievementsOf, collectionOf, gloryOf, levelOf, toggleWant } from "../lib/place-marks.mjs";
import { suggestionStatusLabel, validateSuggestion } from "../lib/suggestions.mjs";

export const SECTIONS = Object.freeze([
  { id: "map", label: "Map", Icon: MapIcon },
  { id: "routes", label: "Routes", Icon: Route },
  { id: "add", label: "Add", Icon: PlusCircle },
  { id: "collection", label: "Collection", Icon: Heart },
  { id: "profile", label: "Profile", Icon: User },
]);

export function AppNav({ section, onSection }) {
  return (
    <nav className="app-nav" aria-label="Sections">
      {SECTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={section === id ? "is-active" : ""}
          aria-current={section === id ? "page" : undefined}
          onClick={() => onSection(id)}
        >
          <Icon size={20} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

// An empty section is a dead end on a phone: the way out was the small cross in the
// corner. The empty state hands over the next step instead.
function BackToMap({ onBack }) {
  return (
    <button type="button" className="ghost-button section-empty-action" onClick={onBack}>
      <MapIcon size={18} aria-hidden="true" />
      Find places on the map
    </button>
  );
}

const day = (at) => new Date(at).toLocaleDateString();

function PlaceRow({ entry, onShow, children }) {
  return (
    <li className="section-row">
      <button type="button" className="section-row-main" onClick={() => onShow(entry.position)} disabled={!entry.position}>
        <strong>{entry.place ?? "A place"}</strong>
        <span>{[entry.film, children].filter(Boolean).join(" · ")}</span>
      </button>
    </li>
  );
}

function RoutesView({ routeStops, routeResult, routeStatus, onBuildRoute, timedTour, onStartTimedTour, restoredWalk, onShow, onBack }) {
  const nothing = routeStops.length === 0 && !timedTour && !restoredWalk;
  return (
    <>
      {nothing && (
        <div className="section-empty-state">
          <p className="section-empty">
            No route yet. Open a place and add it from its Route tab, or generate a timed tour from the map&rsquo;s panel.
          </p>
          <BackToMap onBack={onBack} />
        </div>
      )}
      {routeStops.length > 0 && (
        <section className="section-block">
          <h3>Your route · {routeStops.length} of 5 stops</h3>
          {routeResult && (
            <p className="section-note">{routeResult.distanceKm.toFixed(1)} km on foot · {routeResult.durationMinutes} min</p>
          )}
          <ol className="section-list">
            {routeStops.map((stop, index) => (
              <PlaceRow key={stop.id} entry={{ place: `${index + 1}. ${stop.place}`, film: stop.film, position: stop.position }} onShow={onShow} />
            ))}
          </ol>
          {!routeResult && (
            <button type="button" className="wide-button" disabled={routeStops.length < 3 || routeStatus !== "idle"} onClick={() => onBuildRoute()}>
              <Route size={18} aria-hidden="true" />
              {routeStops.length < 3 ? `Add ${3 - routeStops.length} more to build a route` : "Build route"}
            </button>
          )}
        </section>
      )}
      {timedTour && (
        <section className="section-block">
          <h3>{timedTour.guide?.title ?? "Timed tour"}</h3>
          <p className="section-note">{timedTour.stops.length} stops · {timedTour.route.durationMinutes} min</p>
          <button type="button" className="wide-button" onClick={onStartTimedTour}>
            <Route size={18} aria-hidden="true" />
            Walk this tour
          </button>
        </section>
      )}
      {restoredWalk && (
        <section className="section-block">
          <h3>Saved on this phone</h3>
          <p className="section-note">A walk of {restoredWalk.stops?.length ?? 0} stops, kept for offline use.</p>
        </section>
      )}
    </>
  );
}

function CollectionView({ marks, onMarks, onShow, onBack }) {
  const { want, visited, works } = collectionOf(marks);
  if (want.length === 0 && visited.length === 0) {
    return (
      <div className="section-empty-state">
        <p className="section-empty">
          Nothing collected yet. On a place&rsquo;s card, &ldquo;Want to visit&rdquo; saves it here, and &ldquo;I&rsquo;m here&rdquo; records the visit.
        </p>
        <BackToMap onBack={onBack} />
      </div>
    );
  }
  return (
    <>
      <section className="section-block">
        <h3>Want to visit · {want.length}</h3>
        {want.length === 0 ? <p className="section-note">Nothing saved to visit.</p> : (
          <ul className="section-list">
            {want.map((entry) => (
              <li key={entry.key} className="section-row">
                <button type="button" className="section-row-main" onClick={() => onShow(entry.position)} disabled={!entry.position}>
                  <strong>{entry.place ?? "A place"}</strong>
                  <span>{entry.film}</span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${entry.place} from want to visit`}
                  onClick={() => onMarks(toggleWant(marks, { id: entry.key, ...entry }))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section-block">
        <h3>Visited · {visited.length}{works.length ? ` · from ${works.length} ${works.length === 1 ? "work" : "works"}` : ""}</h3>
        {visited.length === 0 ? <p className="section-note">No visits yet.</p> : (
          <ul className="section-list">
            {visited.map((entry) => (
              <PlaceRow key={entry.key} entry={entry} onShow={onShow}>
                {`${day(entry.at)}${entry.demo ? " · demo" : ""}`}
              </PlaceRow>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ProfileView({ marks, accountUser, onOpenInterests, onOpenAccount }) {
  const glory = gloryOf(marks);
  const { level, toNext } = levelOf(glory);
  const { visited } = collectionOf(marks);
  const achievements = achievementsOf(marks);
  const name = accountUser?.user_metadata?.name || accountUser?.email || "Guest";
  return (
    <>
      <section className="section-block profile-head">
        <div className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
        <div>
          <h3>{name}</h3>
          <p className="section-note">Level {level} · {glory} Glory · {toNext} to level {level + 1}</p>
        </div>
      </section>
      {/* The one way in on a phone, where the header has no room for the account button
          (#108). Neutral: which provider is chosen in the panel it opens. */}
      <button type="button" className="ghost-button" onClick={onOpenAccount}>
        {accountUser ? <User size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
        {accountUser ? "Account and library" : "Sign in"}
      </button>
      <section className="section-block">
        <h3>Places visited · {visited.length}</h3>
        {visited.length === 0 ? (
          <p className="section-note">No visits yet. Stand at a place and tap &ldquo;I&rsquo;m here&rdquo; on its card.</p>
        ) : (
          <ul className="section-list">
            {visited.slice(0, 5).map((entry) => (
              <li key={entry.key} className="section-row is-static">
                <Check size={16} aria-hidden="true" />
                <span><strong>{entry.place}</strong> · {day(entry.at)}{entry.demo ? " · demo" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section-block">
        <h3>Achievements · {achievements.length}</h3>
        {achievements.length === 0 ? (
          <p className="section-note">Your first check-in unlocks &ldquo;First place&rdquo;.</p>
        ) : (
          <ul className="section-list">
            {achievements.map((achievement) => (
              <li key={achievement.id} className="section-row is-static">
                <Award size={16} aria-hidden="true" />
                <span><strong>{achievement.title}</strong> · {day(achievement.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section-block">
        <h3>Your interests</h3>
        <p className="section-note">Swipe through the best-known stories on the map; what you like fills &ldquo;Only my films&rdquo;.</p>
        <button type="button" className="ghost-button" onClick={onOpenInterests}>
          <Heart size={16} aria-hidden="true" />
          Pick your interests
        </button>
      </section>
      <p className="section-note">Kept on this device. {accountUser ? "" : "Signing in keeps your movie list, not these visits."}</p>
    </>
  );
}

function AddView({ suggestions, onSuggestions, mapCenter, userPosition, userIsDemo }) {
  const [form, setForm] = useState({ place: "", work: "", scene: "", sourceUrl: "", where: "map" });
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(null);
  const ownPosition = userPosition && !userIsDemo ? userPosition : null;
  const position = form.where === "me" && ownPosition ? ownPosition : mapCenter;
  const field = (name) => ({ value: form[name], onChange: (event) => setForm({ ...form, [name]: event.target.value }) });

  function submit(event) {
    event.preventDefault();
    const result = validateSuggestion({ ...form, lat: position?.[0], lng: position?.[1] });
    if (result.errors) { setErrors(result.errors); setSaved(null); return; }
    onSuggestions([result.suggestion, ...suggestions]);
    setErrors({});
    setSaved(result.suggestion);
    setForm({ place: "", work: "", scene: "", sourceUrl: "", where: form.where });
  }

  return (
    <>
      <form className="section-block suggest-form" onSubmit={submit} noValidate>
        <h3>Suggest a place</h3>
        <label>Place<input {...field("place")} placeholder="Leadenhall Market" aria-invalid={Boolean(errors.place)} />{errors.place && <small>{errors.place}</small>}</label>
        <label>Film, series or book<input {...field("work")} placeholder="Harry Potter" aria-invalid={Boolean(errors.work)} />{errors.work && <small>{errors.work}</small>}</label>
        <label>What happens there <em>optional</em><input {...field("scene")} placeholder="Diagon Alley" /></label>
        <fieldset>
          <legend>Where it is</legend>
          <label className="suggest-where"><input type="radio" name="where" checked={form.where === "map"} onChange={() => setForm({ ...form, where: "map" })} /> The map&rsquo;s centre</label>
          <label className="suggest-where"><input type="radio" name="where" disabled={!ownPosition} checked={form.where === "me"} onChange={() => setForm({ ...form, where: "me" })} /> My location{ownPosition ? "" : " (not known yet)"}</label>
          <small className="section-note">{position ? `${position[0].toFixed(5)}, ${position[1].toFixed(5)}` : ""}</small>
          {errors.position && <small>{errors.position}</small>}
        </fieldset>
        <label>Source <em>optional</em><input {...field("sourceUrl")} inputMode="url" placeholder="https://" aria-invalid={Boolean(errors.sourceUrl)} />{errors.sourceUrl && <small>{errors.sourceUrl}</small>}</label>
        <button type="submit" className="wide-button"><MapPin size={18} aria-hidden="true" />Save suggestion</button>
        {saved && <p className="section-note" role="status">&ldquo;{saved.place}&rdquo; saved. {suggestionStatusLabel(saved.status)}.</p>}
      </form>
      {suggestions.length > 0 && (
        <section className="section-block">
          <h3>Your suggestions · {suggestions.length}</h3>
          <ul className="section-list">
            {suggestions.map((entry) => (
              <li key={entry.id} className="section-row is-static">
                <span><strong>{entry.place}</strong> · {entry.work}<br /><small>{suggestionStatusLabel(entry.status)}</small></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const TITLES = { routes: "Routes", add: "Add a place", collection: "Collection", profile: "Profile" };

export function SectionSheet({ section, onClose, ...props }) {
  if (section === "map") return null;
  return (
    <section className="section-sheet" aria-label={TITLES[section]}>
      <header className="section-header">
        <h2>{TITLES[section]}</h2>
        <button type="button" className="icon-button" aria-label="Back to the map" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="section-body">
        {section === "routes" && <RoutesView {...props} onBack={onClose} />}
        {section === "collection" && <CollectionView {...props} onBack={onClose} />}
        {section === "profile" && <ProfileView {...props} />}
        {section === "add" && <AddView {...props} />}
      </div>
    </section>
  );
}
