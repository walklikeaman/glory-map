"use client";

// The first run (#15), cut down after the owner tried it on a phone (2026-11-07).
//
// A guest gets ONE welcome screen. Somebody signed in gets a short deck of posters to
// swipe: right puts the film on their map, left skips it. Both are an offer, not a gate:
// "Skip" sits in the top corner of every screen, and leaving early keeps what was chosen.
// Every answer has a button and an arrow key as well as a swipe — a swipe nobody can see
// is not an interface — and the two directions are written beside the card.

import { useEffect, useRef, useState } from "react";
import { Heart, LogIn, Undo2, X } from "lucide-react";

import { CHOICE, CHOICES, choiceForSwipe, orderDeck, remainingCards, WELCOME } from "../lib/onboarding.mjs";

const ICONS = { [CHOICE.skip]: X, [CHOICE.like]: Heart };
const KIND = { film: "Film", series: "Series", book: "Book" };

function SkipButton({ onClick }) {
  return (
    <button type="button" className="onboarding-skip" onClick={onClick}>
      Skip
      <X size={16} aria-hidden="true" />
    </button>
  );
}

export default function Onboarding({ mode = "welcome", state, center = null, onDecide, onUndo, onFinish, onSignIn }) {
  const [cards, setCards] = useState(null);
  const [failed, setFailed] = useState(false);
  const [drag, setDrag] = useState(null);
  const origin = useRef(null);
  const inDeck = mode === "deck";

  useEffect(() => {
    if (!inDeck || cards) return undefined;
    const controller = new AbortController();
    // Dealt for where the map is: a deck of the world's hits would fill "Only my films"
    // with stories that have nothing in this city. Cards answered on an earlier visit are
    // left out before the deck is cut to size, so reopening it deals new posters.
    const query = center ? `?lat=${center[0].toFixed(4)}&lng=${center[1].toFixed(4)}` : "";
    fetch(`/api/deck${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => setCards(orderDeck(remainingCards(body.cards ?? [], state))))
      .catch((error) => { if (error?.name !== "AbortError") setFailed(true); });
    return () => controller.abort();
  }, [inDeck, cards]);

  const left = cards ? remainingCards(cards, state) : [];
  const card = left[0] ?? null;
  const picked = cards ? cards.filter((entry) => state.decisions[entry.id] && state.decisions[entry.id].choice !== CHOICE.skip).length : 0;

  function answer(choice) {
    if (card) onDecide(card, choice);
    setDrag(null);
  }

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") { onFinish(); return; }
      if (!inDeck) return;
      const choice = CHOICES.find((entry) => entry.key === event.key);
      if (choice && card) { event.preventDefault(); answer(choice.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!inDeck) {
    return (
      <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-panel">
          <SkipButton onClick={() => onFinish()} />
          <h2 id="onboarding-title">{WELCOME.title}</h2>
          <p className="onboarding-text">{WELCOME.text}</p>
          <div className="onboarding-stack">
            <button type="button" className="wide-button" onClick={() => onFinish()}>Show the map</button>
            {onSignIn && (
              <button type="button" className="ghost-button" onClick={onSignIn}>
                <LogIn size={16} aria-hidden="true" />
                Sign in to pick my films
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;
  const leaning = choiceForSwipe(dx, dy, 40);

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-panel is-deck">
        <SkipButton onClick={() => onFinish()} />
        <header className="onboarding-deck-head">
          <h2 id="onboarding-title">Which films are yours?</h2>
          <p className="section-note">
            Swipe right for the ones you want on your map, left for the rest. They go into your list, and the map can then show only them. Change it any time in Profile.
          </p>
        </header>

        <div className="deck-stage">
          {failed && <p className="section-empty">The posters could not be loaded. You can pick films later in Profile.</p>}
          {!failed && !cards && <p className="section-empty">Dealing the posters…</p>}
          {cards && !card && <p className="section-empty">That is all of them. Your map is ready.</p>}
          {card && (
            <>
              <article
                key={card.id}
                className={`deck-card${leaning ? ` is-${leaning}` : ""}`}
                style={{ transform: `translate(${dx}px, ${dy / 4}px) rotate(${dx / 18}deg)` }}
                onPointerDown={(event) => { origin.current = [event.clientX, event.clientY]; event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerMove={(event) => { if (origin.current) setDrag({ dx: event.clientX - origin.current[0], dy: event.clientY - origin.current[1] }); }}
                onPointerUp={() => { const choice = choiceForSwipe(dx, dy); origin.current = null; if (choice) answer(choice); else setDrag(null); }}
                onPointerCancel={() => { origin.current = null; setDrag(null); }}
              >
                {card.poster ? <img src={card.poster} alt="" draggable={false} /> : <div className="deck-card-blank" aria-hidden="true">{card.title.slice(0, 1)}</div>}
                <div className="deck-card-text">
                  <strong>{card.title}</strong>
                  <span>{[
                    KIND[card.kind] ?? card.kind,
                    card.year,
                    card.nearby > 0
                      ? `${card.nearby} ${card.nearby === 1 ? "place" : "places"} nearby`
                      : `${card.places} ${card.places === 1 ? "place" : "places"} elsewhere`,
                  ].filter(Boolean).join(" · ")}</span>
                </div>
                {leaning && <span className={`deck-card-stamp is-${leaning}`}>{CHOICES.find((choice) => choice.id === leaning).label}</span>}
              </article>
              <div className="deck-hints" aria-hidden="true">
                <span className={`deck-hint is-left${leaning === CHOICE.skip ? " is-on" : ""}`}>← Not for me</span>
                <span className={`deck-hint is-right${leaning === CHOICE.like ? " is-on" : ""}`}>On my map →</span>
              </div>
            </>
          )}
        </div>

        <div className="deck-buttons">
          {CHOICES.map(({ id, label }) => {
            const Icon = ICONS[id];
            return (
              <button key={id} type="button" className={`deck-button is-${id}`} disabled={!card} onClick={() => answer(id)}>
                <Icon size={22} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="onboarding-actions">
          <button type="button" className="ghost-button" onClick={onUndo} disabled={!cards || left.length === cards.length} aria-label="Take back the last answer">
            <Undo2 size={18} aria-hidden="true" />
          </button>
          <span className="section-note">{cards?.length ? `${cards.length - left.length} of ${cards.length} · ${picked} on your map` : ""}</span>
          <button type="button" className="wide-button" onClick={() => onFinish()}>Done</button>
        </div>
      </div>
    </div>
  );
}
