# 🎬 GloryMap

### Your favorite stories are already part of your life. GloryMap helps you step inside them.

Every day, we watch films, follow series for years, and get lost in books that stay with us long after the final scene or page. Their streets, cafés, houses, landscapes, and hidden corners begin to feel familiar—even when we have never visited them.

GloryMap turns that connection into a real journey.

[🌍 Explore the GloryMap demo](https://codex-hackathon-starter.vercel.app)

## 💭 The problem

Our taste is scattered across streaming platforms, watchlists, reading apps, ratings, and saved collections. These services are good at recommending what to watch or read next, but they rarely help us experience the stories we already love in the real world.

Traditional travel apps have the opposite problem: they show popular attractions, not the places that carry personal meaning for us.

Someone who grew up with a ten-season series should be able to visit its most memorable locations. A reader should be able to walk through the setting of a favorite novel. A film lover should be able to turn a weekend in a new city into a route through scenes they know by heart.

## ✨ The GloryMap experience

GloryMap is built to bring your favorite films, series, and books together and place their real-world locations on one personal map.

Today, the working product imports Letterboxd ZIP exports and Letterboxd or IMDb CSV files, while title search discovers locations for films, series, and books. Direct connectors for streaming and reading services such as Netflix, Prime Video, Disney+, Goodreads, and Kindle are part of the longer-term vision. Choose a city or use your current location to see which available stories have meaningful places nearby.

Instead of asking, “What are the top tourist attractions here?”, GloryMap asks a better question:

> **Which places in this city already mean something to you?**

## 🗺️ Your collections, on the map

Your personal library is at the heart of GloryMap.

- 🎞️ **Films from your collections** become filming locations, recognizable scenes, and real places you can visit.
- 📺 **Series you followed for years** become a map of recurring homes, streets, landmarks, and moments.
- 📚 **Books from your reading collections** become story settings and places connected to the worlds you imagined.
- 🌍 **Every city becomes personal** because the map is filtered through your own taste rather than a generic popularity ranking.

When you change cities, GloryMap recalculates the map and shows the titles from your collections that have known locations there. If a story has several places in the area, they appear together—ready to become a route.

## 🌟 What you can do

### Discover meaningful places

Explore filming locations and story settings connected to your favorite films, series, and books. Search by city, title, or your current position.

### Understand why each place matters

Open a location card to see the work, scene, relationship to the story, address, distance, imagery, and supporting source. Spoiler-sensitive details stay hidden until you choose to reveal them.

### Compare the story with the real world

See a reference from the story alongside the place today. Use **Recreate the shot** to line up your own photo with the original composition.

### Build a personal story walk

Add several places and turn them into a real pedestrian route. GloryMap calculates walking distance and duration so the experience works outside the browser, not only on the map.

### Plan around your day

Choose how much time you have—30, 60, or 120 minutes—and let GloryMap create a tour around your location and the stories you care about.

### Listen as you explore

Use the AI voice guide to hear the context behind each stop while you walk. Spoiler-free narration is available when you want the atmosphere without revealing the plot.

### Save the places that matter

Mark locations you want to visit and keep building a personal travel wishlist inspired by the stories you love.

## 🚶 From collection to journey

```text
Your films, series, and books
              ↓
      Your personal library
              ↓
    Choose a city or location
              ↓
 Stories with real places nearby
              ↓
   Explore scenes and locations
              ↓
 Build a walkable personal tour
```

## ❤️ Why it matters

Stories are emotional landmarks. They remind us of particular years, people, places, and versions of ourselves. Visiting a location from a beloved film, a long-running series, or a formative book is different from checking off another attraction—it feels like meeting something familiar in the real world.

GloryMap makes travel more personal by connecting three things that usually live apart:

- the stories that shaped us;
- the places where those stories live;
- and the time we have to explore them.

## 🔍 Built around trustworthy discovery

GloryMap combines public location knowledge, source-backed research, current place imagery, and walking directions. Each location explains its connection to the work and links back to supporting evidence whenever available.

Coverage is intentionally honest: a title appears only when GloryMap has a meaningful location for it in the selected area. The goal is not to fill the map with vague pins—it is to help every visible place earn its place in the journey.

## 🔐 Personal by design

Your collections shape the experience, but they remain yours. GloryMap never uploads the original ZIP or CSV and never asks for streaming or reading passwords. Guests keep the normalized library on the device; signed-in users can privately sync that normalized list to their Supabase account and use it on another device. Photos used to recreate a scene remain local.

## 🧱 Architecture

GloryMap is a full-stack Next.js application designed around one clear path: turn a personal collection into trustworthy places, then turn those places into a walkable journey.

```text
Personal collections
        ↓
Browser library and preferences
        ↓
Next.js experience ───────────────┐
        ↓                         │
Server API routes                │
   ├─ place discovery            │
   ├─ scene-image matching       │
   ├─ walking routes             │
   └─ AI tours and narration     │
        ↓                         │
Wikidata · OpenStreetMap · TMDB · OpenAI
        ↓
Personal map → selected stops → story walk
```

### Frontend and interaction design

The interface is built with **Next.js 15**, **React 19**, **React Leaflet**, and **Leaflet**. A single responsive experience connects collection import, city and title search, map browsing, location cards, route building, timed tours, voice controls, and the recreate-the-shot flow. We designed each feature as part of the same journey instead of as a separate demo screen, so a person can move from discovery to an actual walk without losing context.

Personal collection data, preferences, saved places, and uploaded comparison photos remain browser-side. That gives the most personal part of the product a privacy-first boundary while server routes handle operations that require protected credentials or controlled access to external services.

### Backend and data layer

Next.js route handlers form a small backend-for-frontend layer:

- `/api/cities` resolves a city through OpenStreetMap Nominatim;
- `/api/locations` discovers film, series, and book locations from Wikidata within the active map area;
- `/api/locations/discover` supplements sparse results with source-backed AI research;
- `/api/film-image` compares current-place evidence with TMDB candidates and returns an image only when the match clears a conservative confidence gate;
- `/api/route` builds pedestrian routes through OpenStreetMap routing;
- `/api/tour` creates a structured story-led tour from verified stops;
- `/api/narration` produces optional spoken guidance without exposing the OpenAI key to the browser.

The application validates AI inputs and outputs, keeps location evidence attached to each result, and falls back to deterministic behavior when an AI service is unavailable. Supabase provides the shared location and scene data contract, while live discovery expands coverage beyond a single city.

### Delivery and quality gates

GitHub is part of the product workflow, not only a place where the final code was uploaded. We divided work into task-sized feature and fix branches, integrated each vertical slice through pull requests, and kept `main` as the reviewable demo baseline. This let frontend, backend, data, design, and deployment work progress independently while preserving one end-to-end user journey.

The repository includes separate **GitHub Actions** workflows for staging and production:

- merging a pull request to `main` can build and deploy a Vercel staging artifact;
- production is a manual workflow with an explicit confirmation gate and a selectable Git ref;
- Vercel credentials stay in GitHub environment secrets rather than in the repository;
- automated tests and a production build are used as the local merge gate.

## 🤖 How we used Codex and GPT-5.6

We used **Codex powered by GPT-5.6** as an engineering partner throughout the project—not as a one-shot code generator. The work moved through a repeatable loop: inspect the current repository, define a small testable outcome, implement it on a focused branch, run tests and a production build, verify the real user flow, review the diff, and publish it through a pull request.

### 1. Turning the idea into an executable architecture

Codex helped translate the initial product idea into a concrete system: a personal media library, a map of verified story locations, detail cards, route planning, and an AI guide. We used it to identify the smallest end-to-end demo path, define the data boundaries between the browser, Next.js API routes, public knowledge sources, and Supabase, and record decisions in repository documentation so later sessions did not have to rediscover them.

### 2. Building the scaffold and vertical slices

We first established the Next.js application shell, responsive visual language, map layout, and server-route conventions. We then added features as vertical slices: city search, live location discovery, collection matching, multi-location title search, scene imagery, nearby browsing, route construction, timed tours, narration, and recreate-the-shot. Codex inspected the existing implementation before each change so new work reused established contracts instead of creating parallel systems.

### 3. Developing frontend and backend together

On the frontend, Codex supported interaction design, React state flows, map behavior, responsive layouts, accessibility copy, loading and error states, and preservation of routes while the viewport changes. On the backend, it helped implement and review API contracts, schemas, Wikidata queries, source validation, caching boundaries, signed scene-matching requests, walking-route normalization, and safe server-only use of external credentials.

This full-stack loop was important: every backend capability was checked through the interface that actually consumes it, and every interface promise was traced back to a real data or API path.

### 4. Using GPT-5.6 inside GloryMap

GPT-5.6 also powers product features through the OpenAI API. It creates structured tour stories from the locations already selected and verified by GloryMap and helps research additional in-city locations when public structured data is sparse. A separately configurable OpenAI vision model supports evidence-aware matching between a real place and candidate scene imagery, while an OpenAI text-to-speech model produces narration. Model responses pass through strict schemas and application-level checks; the model cannot silently introduce an unknown stop into a route.

### 5. Running GitHub and release processes

Codex helped keep changes isolated in branches, prepare focused commits, write reviewable pull-request descriptions, resolve integration conflicts, and inspect CI results. It also helped create the staging and production GitHub Actions workflows, including the production confirmation gate. Small branches made design, frontend, backend, AI, and deployment work easier to review and safer to combine.

### 6. Testing, debugging, and preserving knowledge

For every meaningful slice, Codex generated or extended Node tests, ran the complete suite, produced a Next.js production build, and used real browser or endpoint checks where behavior could not be proven statically. When an issue appeared, we traced the execution path and fixed the root cause—for example, map refresh behavior, sparse discovery validation, or scene-image candidate coverage—then added a regression test. Decisions, incidents, and validation evidence were logged in the repository wiki to make the process cumulative rather than session-dependent.

## 🚀 Run locally

### Prerequisites

- Git
- A current Node.js LTS release with npm
- An OpenAI API key for the full AI tour, research, visual-matching, and narration experience
- A TMDB API Read Access Token for the full film-imagery experience

### Setup

```bash
git clone https://github.com/walklikeaman/glory-map.git
cd glory-map
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Replace placeholder values in `.env.local` with your own credentials; never commit that file. The repository documents every supported variable in `.env.example`, including optional model overrides.

### Enable personal accounts and library sync

1. Apply `supabase/migrations/20260722000000_user_media_libraries.sql` in the Supabase SQL Editor or through your normal migration workflow.
2. In **Supabase Dashboard → Authentication → Providers**, enable Google, Facebook, or both and add the OAuth client credentials supplied by those platforms.
3. In **Authentication → URL Configuration**, set the production Site URL and allow both the production URL and `http://localhost:3000` as redirect URLs.
4. Keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` and in the corresponding Vercel environment.

The browser processes the source archive locally. After login, GloryMap merges the guest, device, and cloud libraries, saves one normalized list under the authenticated Supabase user ID, and protects it with row-level security.

### Validate a change

```bash
npm test
npm run build
```

### Suggested evaluation path

1. Open GloryMap and connect a personal story collection.
2. Choose a city or use the nearby-location experience.
3. Confirm that works from the collection with known locations appear on the map.
4. Open a place card and review its story relationship, imagery, and supporting source.
5. Select three to five stops and build a walking route.
6. Create a timed tour or play the optional AI voice guide.

## 🚀 Try GloryMap

Open the demo, connect your story collection, choose a city, and see where your favorite worlds meet the real one.

### [🌍 Launch the live demo →](https://codex-hackathon-starter.vercel.app)

## ✅ What judges can test today

No account or credentials are required for the deployed application.

1. Open the [live demo](https://codex-hackathon-starter.vercel.app).
2. Search for a city, or keep London selected.
3. Explore the visible pins or search for a film, series, or book.
4. Open a location card to inspect its story context, source, and imagery.
5. Add at least three locations and select **Build route**.
6. Choose 30, 60, or 120 minutes and generate a nearby AI-guided tour.
7. Optionally import a Letterboxd ZIP or Letterboxd/IMDb CSV. The file is
   processed locally in the browser and is never uploaded.

No sample data is required: public story locations load automatically. Features
that use live external services may take several seconds.

**GloryMap — visit the places that already feel like home.** 🍿📚🗺️
