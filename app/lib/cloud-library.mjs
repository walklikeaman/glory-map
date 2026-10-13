import { RATING_SCALE, isMediaSource } from "./media-sources.mjs";

const TABLE_NAME = "user_media_libraries";
const MAX_LIBRARY_SIZE = 10000;

function optionalString(value, maxLength = 1000) {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function optionalNumber(value) {
  return Number.isFinite(value) ? value : null;
}

export function normalizeCloudLibrary(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_LIBRARY_SIZE).flatMap((movie) => {
    if (!movie || typeof movie !== "object") return [];
    const title = optionalString(movie.title, 500)?.trim();
    if (!title) return [];

    const sources = Array.isArray(movie.sources)
      // Whatever [[media-sources]] knows about, rather than a list that has to be found
      // and updated when a service is added.
      ? [...new Set(movie.sources.filter(isMediaSource))]
      : [];

    return [{
      id: optionalString(movie.id, 600) || `${sources[0] || "account"}:${title.toLowerCase()}:${movie.year || ""}`,
      title,
      year: optionalNumber(movie.year),
      rating: optionalNumber(movie.rating),
      // Which scale that number is on. Dropped here, a synced library would come back
      // looking legacy and be doubled on the next read ([[personal-library]]).
      ratingScale: movie.ratingScale === RATING_SCALE ? RATING_SCALE : null,
      watchedDate: optionalString(movie.watchedDate, 100),
      url: optionalString(movie.url, 2000),
      imdbId: /^tt\d+$/.test(movie.imdbId || "") ? movie.imdbId : null,
      sources,
      // Without it a synced book would come back as a film and be matched against films.
      ...(movie.kind === "book" ? { kind: "book" } : {}),
    }];
  });
}

export async function loadCloudLibrary(client, userId) {
  const { data, error } = await client
    .from(TABLE_NAME)
    .select("movies")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return normalizeCloudLibrary(data?.movies);
}

export async function saveCloudLibrary(client, userId, movies) {
  const normalized = normalizeCloudLibrary(movies);
  const { error } = await client.from(TABLE_NAME).upsert({
    user_id: userId,
    movies: normalized,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (error) throw error;
  return normalized;
}
