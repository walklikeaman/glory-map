"use client";

// A scene note we show in English, with the way back to what the source actually wrote.
// Nikita, 2026-11-11: translate every scene into English, "и кнопочку «Показать оригинал»
// надо оставить" — the English is ours, the original is the evidence.
import { useState } from "react";

export default function TranslatedNote({ note, original, as: Tag = "span", className }) {
  const [showOriginal, setShowOriginal] = useState(false);
  if (!note) return null;
  if (!original) return <Tag className={className}>{note}</Tag>;
  return (
    <>
      <Tag className={className} dir={showOriginal ? "auto" : undefined} lang={showOriginal ? undefined : "en"}>
        {showOriginal ? original : note}
      </Tag>
      <button
        type="button"
        className="note-original-toggle"
        aria-pressed={showOriginal}
        onClick={(event) => { event.stopPropagation(); setShowOriginal((value) => !value); }}
      >
        {showOriginal ? "Show English" : "Show original"}
      </button>
    </>
  );
}
