// A public page for one visitor's shot, so a shared link opens to the photo and its
// preview card shows it (#54 rest).
//
// Only an approved shot has a page. A pending or rejected one answers 404, the same as an
// id that never existed, so a link cannot tell a stranger that somebody's held-back photo
// is there.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The preview card fetches the film frame on our server. Only TMDB's image host is
// fetched: a reference URL is a reader's text, and the server must not fetch whatever a
// stranger typed.
const FRAME_HOSTS = new Set(["image.tmdb.org"]);

export function shotIdFromParam(value) {
  const id = String(value ?? "").trim();
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function shotPath(id) {
  const clean = shotIdFromParam(id);
  return clean ? `/shot/${clean}` : null;
}

export function frameUrlForCard(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && FRAME_HOSTS.has(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// What the page and the card print. null for anything that must not be shown.
export function shotPageModel(row) {
  if (!row || row.status !== "approved" || !shotIdFromParam(row.id)) return null;
  const placeName = String(row.place_name ?? "").trim() || null;
  const caption = String(row.caption ?? "").trim() || null;
  const recreation = row.kind === "recreation";
  const frameUrl = recreation ? frameUrlForCard(row.reference_url) : null;
  const where = placeName ?? "a film location";
  return {
    id: row.id.toLowerCase(),
    placeName,
    caption,
    recreation,
    frameUrl,
    storagePath: row.storage_path,
    title: recreation ? `A recreated shot at ${where}` : `A visitor's shot of ${where}`,
    description: caption
      ?? (recreation
        ? `Then and now: a visitor stood where the film was shot${placeName ? ` at ${placeName}` : ""}.`
        : `How ${where} looks today, shared on GloryMap.`),
    createdAt: row.created_at ?? null,
  };
}
