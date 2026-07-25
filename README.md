# Cineprompt

A personal film dashboard for Dalton Johnson ([daltonjohnson](https://letterboxd.com/daltonjohnson/) · [lunarafilm.com](https://lunarafilm.com)). It turns a Letterboxd + Trakt + TMDB viewing history (4,500+ films) into a daily "what to watch" cockpit: a rotating daily slate, a scored recommendation queue, blind-spot analysis, director completion targets, canon checklists, screenplay reading lists, craft (cinematographer/composer) tracking, themed weeks, a tag explorer, and a mood-based picker.

The app is a **static single-page app**: all content is precomputed by a Python pipeline into one `client/public/data.json` file, which the React client loads at startup. The Express server only serves the built client — there is no database or API at runtime.

## Stack

- **Client:** React 18, Vite 7, TypeScript, wouter (hash routing), Tailwind + shadcn/ui, framer-motion, Recharts
- **Server:** Express 5 (static file serving + Vite middleware in dev)
- **Data pipeline:** Python 3 (`datagen/`) pulling from TMDB, Trakt, and a Letterboxd export

## Prerequisites

- Node.js 18+ (developed on Node 24)
- Python 3.10+ (only needed to regenerate data)

## Run it

```bash
npm install
npm run dev        # http://localhost:5000
```

Set a different port with `PORT=3000 npm run dev` (or `HOST=...` to change the bind address).

### Production build

```bash
npm run build      # client -> dist/public, server -> dist/index.cjs
npm start          # serves the build on PORT (default 5000)
```

## Data

The client reads `client/public/data.json`. Credentials live in `datagen/.env`
(git-ignored — copy `datagen/.env.example` and fill in your keys):
`TMDB_API_KEY`, `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`, `TRAKT_USER`,
`LETTERBOXD_USER`.

Three levels of refresh, lightest to heaviest:

- **Roll the daily slate** — no API keys, instant. Reuses the films already in
  `data.json` and just rolls the 14-day "Today" window forward from today (the
  Today page sticks on an old day if the window is in the past):
  ```bash
  npm run data:refresh
  ```

- **Sync your watch history** from Trakt — updates the watched set, stats, recent
  watches, and blindspots (does not re-pick recommendations):
  ```bash
  npm run data:sync
  ```

- **Fold in your recent Letterboxd diary** — reads your public RSS feed (no API
  key, no export). This is how watches from services with no scrobbler reach the
  site: **the Criterion Channel has no Trakt integration of any kind**, so those
  nights only arrive if you log them on Letterboxd. Adds any films Trakt missed,
  plus fresh ratings and review snippets:
  ```bash
  npm run data:letterboxd
  ```
  The feed carries the ~50 most recent entries and **no tags**, so full history
  and diary tag counts (including `criterion channel`) still come from the ZIP
  export via `build_data.py`. Safe to re-run — the merge is idempotent.

- **Rebuild the recommendation engine** — the full discovery pipeline. Pulls your
  taste profile from Trakt, finds fresh **unseen** films (canon lists + loved-
  director filmographies + TMDB discovery across your under-watched decades and
  languages), scores them on *canonical quality + blindspot-fill + director
  affinity*, and regenerates the challenge pool, comfort-rewatch background pool,
  director targets, mood buckets, and slates. Backs up `data.json` first
  (to `data-backups/` at the project root — kept out of the web build, last 5 kept):
  ```bash
  npm run data:rebuild
  ```
  First run is slow while TMDB metadata is fetched into `datagen/.tmdb_cache.json`;
  re-runs are fast.

### How recommendations work

`datagen/build_recommendations.py` is the engine. The philosophy, visible in each
film's `reasons`, is to **challenge you with worthy films you haven't seen** while
keeping a few comfort rewatches for background viewing:

- **Challenge pool** (`queue` + `focus_pool_extra`) — unseen films scored on TMDB
  canonical quality, membership in the canon lists (Sight & Sound / Best Picture /
  Criterion / AFI), how well they fill your under-watched decades and languages,
  and affinity with directors you rate highly. A vote-count quality floor keeps
  out junk; a per-director cap keeps the pool broad.
- **Background pool** — your own highest-rated films, surfaced as rewatches to
  "keep on in the background."

The older `build_data.py` (Letterboxd export) and `build_from_trakt.py` (Trakt
sync) are still here; they refresh the *seen* side but recycle the existing pools.
`build_recommendations.py` supersedes them for keeping the unseen picks fresh.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR on port 5000 |
| `npm run build` | Production build (client + bundled server) |
| `npm start` | Serve the production build |
| `npm run check` | TypeScript type-check (no emit) |
| `npm run data:refresh` | Roll the daily slate window forward to today (no API) |
| `npm run data:sync` | Sync watched set / stats / blindspots from Trakt |
| `npm run data:letterboxd` | Fold in recent Letterboxd diary via public RSS (catches Criterion Channel & anything Trakt missed) |
| `npm run data:rebuild` | Full recommendation rebuild (discovers fresh unseen picks) |
| `npm run cf:deploy` | Build + deploy to Cloudflare Pages (manual; CI does this automatically) |

## Deployment & auto-update

The live site runs on **Cloudflare Pages** and keeps itself current automatically.
A **GitHub Actions** workflow ([.github/workflows/update.yml](.github/workflows/update.yml))
re-pulls your Trakt history, rebuilds the unseen-recommendation engine, and redeploys
**twice a day** (and on demand) — so the site always reflects what you've watched,
gated privately to your email via Cloudflare Access. Full setup in
[DEPLOY.md](DEPLOY.md).

## Project layout

```
client/          React SPA
  public/data.json   precomputed app data (~5 MB)
  src/pages/         one file per route (today, queue, directors, ...)
  src/lib/data.ts    data types + loader + helpers
  src/lib/mood.tsx   mood-engine pick logic
server/          Express app (index, routes, static, vite middleware)
datagen/         Python data pipeline (TMDB / Trakt / Letterboxd)
  build_recommendations.py  the discovery engine (fresh unseen picks)
  rebuild.py                backup + rebuild wrapper (npm run data:rebuild)
  build_from_trakt.py       watch-history sync
  letterboxd_rss.py         recent diary via public RSS (no API key)
  refresh_slates.py         roll the daily slate window
  tmdb.py                   TMDB client + cache
shared/          shared types
```

## Notes

- Routing is hash-based (`/#/queue`), so the app works from any static host or `file://` without server rewrites.
- Posters/backdrops are loaded directly from TMDB's CDN; an internet connection is needed for images.
