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

// One more try after a 502 (QA 12.11). The catalogue's first query after a quiet spell can
// hit the DB's statement timeout; the same query a moment later answers in 0.3 s. A visitor
// should get the page, not a 500, for that.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryOn502(call, { waits = [1500], wait = sleep } = {}) {
  let response = await call();
  for (const ms of waits) {
    if (response.status !== 502) break;
    await wait(ms);
    response = await call();
  }
  return response;
}
