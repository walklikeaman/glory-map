---
type: source
created: 2026-07-22
updated: 2026-07-22
sources: [web, research]
---
# Personal collections source matrix

Research 22.07.2026 (9 agents, key facts verified with live queries).
Question: where to read the user's personal collections (films/series/books/music)
so the [[glorymap-app]] map can be filtered to their taste. Related:
[[personal-library]], [[film-imagery]].

## Tier 1 — "enter a nickname → we read it", no authorization (verified live)

| Service | Region | What it returns | How | Difficulty |
|---|---|---|---|---|
| **Letterboxd** | global | ~100 most recent views: rating, date, **ready-made tmdb:movieId** | RSS `letterboxd.com/{nick}/rss/`; server-side with a browser User-Agent (otherwise Cloudflare 403) | easy ★ |
| **Trakt.tv** | global | full view history, ratings, watchlist of a public profile (tmdb-ID inside) | headers `trakt-api-key` (client_id) + `trakt-api-version: 2`; OAuth only for private ones; from 30.06.26 mandatory pagination (limit ≤250) | easy ★ |
| **Kinopoisk** | RU | ~1500 most recent ratings by the numeric profile ID | `kinopoiskapiunofficial.tech /api/v1/kp_users/{id}/votes`, free key, 2 req/s | easy |
| **MyShows.me** | RU | the entire series list with statuses and ratings by nickname | JSON-RPC `api.myshows.me/v2/rpc/` method `profile.Shows` — no token at all | easy |
| **Last.fm** | global | top artists/tracks, full scrobble history by nickname | GET with api_key, "does not require authentication" | easy |
| **Goodreads** | global | read/to-read shelves: ratings, ISBN, reviews (~100/feed, per shelf) | RSS `goodreads.com/review/list_rss/{user_id}?shelf=read`; pull from the backend | easy |
| **AniList** | global | the entire anime/manga list with ratings | GraphQL `graphql.anilist.co` by nickname — no key even needed; 30 req/min | easy |
| **MyAnimeList** | global | anime/manga list of a public profile | header `X-MAL-CLIENT-ID` (key issued instantly) | easy |
| **Open Library** | global | reading log by nickname | `openlibrary.org/people/{nick}/books/already-read.json` | easy, few users |
| **ListenBrainz** | global | listening history by nickname | open API | easy, few users |
| **Deezer** | EU | public playlists by the numeric profile ID | no-auth endpoints are alive, OAuth is dead | medium, fragile |
| **Douban** | CN | ~10 most recent marks | RSS `douban.com/feed/people/{nick}/interests`; the full collection — heavy anti-bot | medium |

## Tier 2 — real OAuth, "sign in"

| Service | What | Limitations (July 2026) |
|---|---|---|
| **Spotify** | `/me/top/artists`, `/me/top/tracks`, playlists, saved | dev mode: **5 test users** in the allowlist (was 25), the owner needs **Premium**, 1 Client ID; fine for the jury demo, "anyone can sign in" — no |
| **Trakt OAuth** | private profiles, writes | free, app registration is instant |
| **Simkl** | history, watchlist (strong in anime) | OAuth works, smaller audience |
| **TMDB** | favorites/rated/watchlist of an account | session-based auth; a random user's data is empty — we keep TMDB as the metadata base |
| **Apple Music** | library, heavy rotation | only with a paid Apple Developer ($99) + a subscriber user |

## Tier 3 — "bring a file" (universal fallback)

- **IMDb** — Export → CSV (ratings/watchlist, has tt-IDs); desktop site only. *Already in the app.*
- **Letterboxd ZIP** — watched.csv + ratings.csv. *Already in the app (25 MB, locally in the browser).*
- **Goodreads CSV**, **StoryGraph CSV**, **Netflix** (Viewing Activity → Download all — alive),
  **LiveLib** (via third-party exporters), **Babelio CSV** (FR).
- **Google Takeout / YouTube** — the archive takes hours to generate, don't count on it for the demo.

## Dead / don't touch

Goodreads API (2020), Deezer OAuth, Yandex.Music (token against ToS),
LitRes (partner agreement only), Bookmate/Yandex.Books (unconfirmed),
Lovelybooks (nothing), Kindle (no API; only My Clippings.txt from the device),
scraping IMDb/Kinopoisk (anti-bot + ToS).

## Ideas: film stills ("IMDb has tons of stills")

You **can't** grab stills straight from IMDb: there's no media API, the galleries are behind anti-bot,
scraping is against ToS (photo licensing is enterprise via AWS Data Exchange).
Fast legal alternatives:

1. **TMDB images** — *already in the app*: `/api/film-image` compares the place photo
   against 24 TMDB backdrops via Vision with a confidence threshold ([[film-imagery]]).
   An untapped reserve: **series** have per-frame episode stills —
   `GET /tv/{id}/season/{s}/episode/{e}/images` (same key, same CDN).
2. **Fanart.tv API** — curated artwork (backgrounds/thumbs) by tmdb/tvdb-ID,
   free key; good as a second candidate pool for the Vision matcher.
3. **Wikimedia Commons** — "Film stills" categories for old/PD films,
   we already use Commons for "the place now", the API is the same.
4. **YouTube trailers** — the official trailer via the YouTube Data API →
   freeze-frames `i.ytimg.com/vi/{id}/maxresdefault.jpg`; legal and instant,
   but one frame per video.
5. Scraping film-grab.com / movie-screencaps / shotdeck — a gray area, **we don't take it**.

## Idea: "paste your Letterboxd nickname"

A Personal Library tab next to the ZIP import: a nickname field → the server pulls the RSS →
~100 most recent films with ready-made tmdb-IDs → instant intersection with the map.
Zero friction versus "download a ZIP on desktop"; the ZIP stays for the full history.
The same pattern scales: Trakt nickname, Kinopoisk ID, MyShows nickname, Goodreads URL
— one "connect a collection" screen with four fields. NOT doing it yet — recorded
as an idea (owner's decision 22.07).

## Full report

The raw research output with a source URL for each claim — in the output of the
`personal-collections-research` workflow (operator session 22.07.2026); the key links
are embedded in the tables above.
