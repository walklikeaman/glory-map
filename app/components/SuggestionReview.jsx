"use client";

// The moderator's queue of readers' suggestions (#48). Each card shows what the reader said
// and where they put it; the moderator picks the work it belongs to, names the page that
// backs it, and verifies it onto the map or rejects it with a reason the reader will see.

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, LogIn, MapPin, RefreshCw, X } from "lucide-react";

import { getSupabaseBrowserClient } from "../lib/supabase-browser.mjs";

const ENDPOINT = "/api/review/suggestions";

function osmLink(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

async function sessionToken(supabase) {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

function WorkPicker({ initial, value, onChange }) {
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState([]);
  const [state, setState] = useState("idle");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setState("idle"); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=6`, { signal: controller.signal });
        const body = await response.json();
        setResults(response.ok ? body.suggestions ?? [] : []);
        setState(response.ok ? "done" : "failed");
      } catch (error) {
        if (error?.name !== "AbortError") setState("failed");
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  return (
    <fieldset className="review-works">
      <legend>Work</legend>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the graph" />
      {state === "loading" && <small className="section-note">Searching…</small>}
      {state === "failed" && <small>Search is unavailable.</small>}
      {state === "done" && results.length === 0 && (
        <small className="section-note">Not in the graph. It cannot be verified until the work is.</small>
      )}
      {results.map((work) => (
        <label key={work.work_id} className="review-work">
          <input type="radio" checked={value?.work_id === work.work_id} onChange={() => onChange(work)} />
          <span>{work.title}{work.year ? ` (${work.year})` : ""} · {work.kind_label} · {work.place_count} places</span>
        </label>
      ))}
    </fieldset>
  );
}

function SuggestionCard({ suggestion, busy, onDecide }) {
  const [work, setWork] = useState(null);
  const [sourceUrl, setSourceUrl] = useState(suggestion.source_url ?? "");
  const [reason, setReason] = useState("");
  const when = new Date(suggestion.created_at).toLocaleString();

  return (
    <li className="section-block review-card">
      <h3>{suggestion.place_name}</h3>
      <p className="section-note">
        For <strong>{suggestion.work_title}</strong> · sent {when}
      </p>
      {suggestion.scene && <p className="review-scene">&ldquo;{suggestion.scene}&rdquo;</p>}
      <p className="review-links">
        <a href={osmLink(suggestion.lat, suggestion.lng)} target="_blank" rel="noreferrer">
          <MapPin size={14} aria-hidden="true" /> {suggestion.lat}, {suggestion.lng}
        </a>
        {suggestion.source_url && (
          <a href={suggestion.source_url} target="_blank" rel="noreferrer nofollow ugc">
            <ExternalLink size={14} aria-hidden="true" /> The reader&apos;s source
          </a>
        )}
      </p>
      <WorkPicker initial={suggestion.work_title} value={work} onChange={setWork} />
      <label>Source that backs it
        <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} inputMode="url" placeholder="https://" />
      </label>
      <label>Reason <em>the reader sees it when you reject</em>
        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
      </label>
      <div className="review-actions">
        <button
          type="button"
          className="wide-button"
          disabled={busy || !work || !sourceUrl.trim()}
          onClick={() => onDecide({ id: suggestion.id, action: "verify", workId: work?.work_id, sourceUrl, reason })}
        >
          <Check size={18} aria-hidden="true" />Verify onto the map
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={busy || reason.trim().length < 3}
          onClick={() => onDecide({ id: suggestion.id, action: "reject", reason })}
        >
          <X size={18} aria-hidden="true" />Reject
        </button>
      </div>
    </li>
  );
}

export default function SuggestionReview() {
  const [supabase] = useState(() => getSupabaseBrowserClient());
  const [state, setState] = useState("loading");
  const [message, setMessage] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setState("unconfigured"); return; }
    setState("loading");
    const token = await sessionToken(supabase);
    if (!token) { setState("signed_out"); return; }
    try {
      const response = await fetch(ENDPOINT, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) { setState("signed_out"); return; }
      if (!response.ok) { setMessage(body.error ?? "Could not load the suggestions."); setState("error"); return; }
      setSuggestions(body.suggestions ?? []);
      setTotal(body.total ?? 0);
      setState("ready");
    } catch {
      setMessage("Could not reach the server.");
      setState("error");
    }
  }, [supabase]);

  useEffect(() => {
    load();
    if (!supabase) return undefined;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") queueMicrotask(load);
    });
    return () => data.subscription.unsubscribe();
  }, [load, supabase]);

  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/review` },
    });
  }

  async function decide(decision) {
    setBusyId(decision.id);
    setNotice("");
    try {
      const token = await sessionToken(supabase);
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(decision),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 409) {
        setNotice(body.error ?? "Could not save the review.");
        return;
      }
      setSuggestions((list) => list.filter((entry) => entry.id !== decision.id));
      setTotal((count) => Math.max(0, count - 1));
      setNotice(response.status === 409
        ? "Somebody else already reviewed it."
        : body.status === "verified"
          ? (body.linked ? "Verified. The place was already in the queue, so it is linked to it." : "Verified. It is on the map as a checked place.")
          : "Rejected. The reader will see the reason.");
    } catch {
      setNotice("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="review-page">
      <header className="review-head">
        <h1>Readers&apos; suggestions</h1>
        {state === "ready" && (
          <button type="button" className="ghost-button" onClick={load}>
            <RefreshCw size={16} aria-hidden="true" />Refresh
          </button>
        )}
      </header>

      {state === "loading" && <p className="section-note">Loading…</p>}
      {state === "unconfigured" && <p className="section-note">Accounts are not configured on this deployment.</p>}
      {state === "signed_out" && (
        <section className="section-block">
          <p>Sign in with a moderator account to review suggestions.</p>
          <button type="button" className="wide-button" onClick={signIn}>
            <LogIn size={18} aria-hidden="true" />Sign in with Google
          </button>
        </section>
      )}
      {state === "error" && <p role="alert">{message}</p>}
      {notice && <p className="section-note" role="status">{notice}</p>}

      {state === "ready" && (
        suggestions.length === 0
          ? <p className="section-note">Nothing is waiting. New suggestions appear here when readers send them.</p>
          : (
            <>
              <p className="section-note">
                {total} waiting{total > suggestions.length ? `, the oldest ${suggestions.length} shown` : ""}.
                Nobody but the reader sees them until you verify one.
              </p>
              <ul className="review-list">
                {suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    busy={busyId === suggestion.id}
                    onDecide={decide}
                  />
                ))}
              </ul>
            </>
          )
      )}
    </main>
  );
}
