// What an SEO page makes of the route it reads (QA 03.11).
//
// The pages read their API routes in-process and used to treat any non-OK answer as "no
// such page": a statement timeout on /directory/films/n?page=2 answered 404. A 404 tells a
// crawler the URL is gone; a 5xx tells it to come back. Only the route's own 404 means
// missing — anything else is thrown, and the error boundary answers 500.
export async function readRoute(response, what) {
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${what} is unavailable (${response.status})`);
  return response.json();
}
