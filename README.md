# Cineprompt

A personal film dashboard for Dalton Johnson ([daltonjohnson](https://letterboxd.com/daltonjohnson/) · [lunarafilm.com](https://lunarafilm.com)). It turns a Letterboxd (+ optional Trakt) + TMDB viewing history (4,500+ films) into a daily "what to watch" instruction: **one pick for tonight** with a play button, a rotating daily slate behind it, a scored recommendation queue tuned to what you have actually been watching lately, blind-spot analysis, director completion targets, canon checklists, screenplay reading lists, craft (cinematographer/composer) tracking, themed weeks, a tag explorer, and a mood-based picker.

Your choices in the app — **Shortlist**, **Not tonight**, **Watched** — are saved on the device first and mirrored to a Cloudflare D1 store, so they survive a reload, a rebuild, and a switch from phone to TV. The pipeline reads them back (see [DEPLOY.md](DEPLOY.md#let-the-pipeline-see-your-in-app-choices)) so the phone nudge and the Stremio row agree with the app.

The app is a **static single-page app**: all content is precomputed by a Python pipeline into one `client/public/data.json` file. At build time that file is split into a small core payload plus lazily-fetched, route-scoped shards (see [Data payload](#data-payload)), which the React client loads on demand. The Express server only serves the built client — there is no database or API at runtime.

Press <kbd>⌘K</kbd> (or <kbd>/</kbd>) anywhere to search the whole library — every film in every filmography, collection, and canon list, plus directors and collections by name.

## Stack

- **Client:** React 18, Vite 7, TypeScript, wouter (hash routing), Tailwind + shadcn/ui, framer-motion, Recharts
- **Server:** Express 5 (static file serving + Vite middleware in dev)
- **Data pipeline:** Python 3 (`datagen/`) pulling from Letterboxd (public RSS + export), TMDB, and optionally Trakt

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
(git-ignored — copy `datagen/.env.example` and fill in your keys). Required:
`TMDB_API_KEY` and `LETTERBOXD_USER`. Optional: `TRAKT_CLIENT_ID` /
`TRAKT_USER` (adds scrobbled plays and a rating fallback; nothing depends on it).

### Letterboxd is the source of truth

The engine's idea of what you've **seen** and what you **like** comes from an
accumulated Letterboxd profile (`datagen/.letterboxd_profile.json`, kept across
CI runs and mirrored into `data.json`):

- **The public RSS diary** (no key, no login) is folded in on every run. It only
  carries the 50 newest entries, but nothing is ever forgotten, so from the day
  the profile starts it becomes a complete diary going forward.
- **What the data already knew**: the 4,000+ rated titles and dated reviews from
  the original export seed the profile on first run.
- **An export ZIP** whenever you want the full history in one go (Letterboxd →
  Settings → Import & Export → Export your data), dropped at
  `datagen/letterboxd-export.zip` or passed with `--export`:
  ```bash
  python datagen/letterboxd_profile.py client/public/data.json --export ~/Downloads/letterboxd-export.zip
  ```

Titles are matched to TMDB ids through the cached TMDB search, so the first run
is a few minutes and later runs are instant. Letterboxd's site itself is behind
a bot challenge, so the pipeline deliberately never scrapes it.

Trakt, if configured, is layered on top: its watched set is unioned in, its
ratings fill gaps Letterboxd hasn't rated. Where both rate a film, Letterboxd wins.

Levels of refresh, lightest to heaviest:

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

- **Update the Letterboxd profile** — folds the RSS diary into the accumulated
  profile and resolves new titles to TMDB ids. Run before a rebuild:
  ```bash
  npm run data:profile
  ```

- **Fold in your recent Letterboxd diary** — the lighter, post-rebuild merge:
  reads your public RSS feed, adds any films the rebuild missed, prunes them
  from the picks, refreshes ratings and review snippets:
  ```bash
  npm run data:letterboxd
  ```
  The feed carries **no tags**, so diary tag counts (including `criterion
  channel`) still come from the ZIP export via `build_data.py`.

- **Apply your in-app choices** — given a `state.json` pulled from D1 (the
  workflow does this with `wrangler d1 execute`), prunes dismissed / watched /
  not-tonight films from every pool and puts your shortlist first:
  ```bash
  npm run data:state
  ```

- **Rebuild the recommendation engine** — the full discovery pipeline. Builds
  your taste profile from Letterboxd (plus Trakt if configured), finds fresh
  **unseen** films (canon lists + loved-director filmographies + new releases +
  TMDB discovery across your under-watched decades and languages), scores them on
  *canonical quality + era fit + director affinity*, and regenerates the challenge
  pool, comfort-rewatch background pool, director targets, mood buckets, and slates. Backs up `data.json` first
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
  Criterion / AFI and your own MDBList lists), **era fit** — how much the film's
  decade and genre look like your last 18 months of logging — and affinity with
  directors you rate highly. A vote-count quality floor keeps out junk; a
  per-director cap keeps the pool broad.

  Era fit replaced the old "under-watched decade" bonus. That bonus pointed the
  queue at the 1920s-40s (anyone's least-watched decades) and the slate read like
  a syllabus: 32 of 94 picks pre-1960 while the diary's best months were mostly
  new releases, 2000s, 80s and 90s. Blind spots keep their own page; the queue
  is tuned to the run you're actually on. Today shows what it's tuned to.
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
| `npm run data:profile` | Update the Letterboxd profile (RSS diary + TMDB ids); `--export path.zip` folds in a full export |
| `npm run data:sync` | Sync watched set / stats / blindspots from Trakt (optional) |
| `npm run data:letterboxd` | Fold in recent Letterboxd diary via public RSS (catches Criterion Channel & anything Trakt missed) |
| `npm run data:state` | Apply in-app choices from a `state.json` pulled from D1 (prune dismissed/watched, shortlist first) |
| `npm run data:rebuild` | Full recommendation rebuild (discovers fresh unseen picks) |
| `npm run data:shards` | Re-split `data.json` into the client shards (dev/build do this automatically) |
| `npm run cf:deploy` | Build + deploy to Cloudflare Pages (manual; CI does this automatically) |

## Data payload

The pipeline writes one ~6.5 MB `client/public/data.json`. The client never
fetches that file. On every dev start and every build,
[`script/data-shards.ts`](script/data-shards.ts) derives from it:

| File | Size | Fetched |
| --- | --- | --- |
| `data/core.json` | 1.1 MB (382 KB gz) | at startup — everything first paint needs |
| `data/collections.json` | 1.4 MB | on `/collections` |
| `data/tags.json` | 787 KB | on `/tags` |
| `data/search.json` | 676 KB | on first ⌘K |
| `data/canon.json` | 475 KB | on `/canon` |
| `data/craft.json` | 97 KB | on `/craft` |
| `data/directors/<slug>.json` | 3–55 KB × 143 | one file, on that director's page |

That takes the critical path from **1.77 MB gzipped to 382 KB** — an 82.5%
cut — because ~1.2 MB was data no client code read at all (`review_quotes`,
`diary_ratings`, `watched_tmdb_set`) and the rest belonged to one deep route
each. Nav links warm their shard on hover, so navigation usually finds the
data already there.

The pipeline is untouched by this: it keeps reading and writing
`client/public/data.json` exactly as before, and the split runs downstream.
`client/public/data/` is git-ignored — always reproducible with
`npm run data:shards`.

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
  public/data.json   precomputed app data (~6.5 MB, pipeline output)
  public/data/       generated shards the client actually fetches (git-ignored)
  public/sw.js       service worker (offline + instant repeat loads)
  src/pages/         one file per route (today, queue, directors, ...)
  src/components/tonight.tsx  the one-pick "Tonight" hero on Today
  src/lib/filmState.tsx       local-first film state (Shortlist / Not tonight / Watched), mirrored to D1
  src/lib/data.ts    data types + core/shard loaders + helpers
  src/lib/mood.tsx   mood-engine pick logic
  src/components/command-palette.tsx  ⌘K search over the whole library
script/
  data-shards.ts     splits data.json into core + lazy shards (build step)
  make_icons.py      regenerates the favicon / PWA icons from the reel logo
server/          Express app (index, routes, static, vite middleware)
datagen/         Python data pipeline (TMDB / Trakt / Letterboxd)
  build_recommendations.py  the discovery engine (fresh unseen picks)
  rebuild.py                backup + rebuild wrapper (npm run data:rebuild)
  letterboxd_profile.py     the accumulated Letterboxd profile (seen set, ratings, diary)
  letterboxd_rss.py         recent diary via public RSS (no API key)
  apply_state.py            fold in-app choices (D1) into the picks
  build_from_trakt.py       optional Trakt watch-history sync
  refresh_slates.py         roll the daily slate window
  tmdb.py                   TMDB client + cache
shared/          shared types
```

## Why Criterion Channel watches must be logged by hand

Criterion is a large share of the viewing here (400+ diary entries) and it is the
one service that **cannot** be tracked automatically. This was investigated
properly in July 2026 so it doesn't need re-litigating:

- **No Trakt integration.** Trakt's own Streaming Scrobbler covers Netflix,
  Apple TV+, Disney+, Prime Video, Hulu, Max and Paramount+ only. The
  Universal Trakt Scrobbler extension supports 28 services, none of them
  Criterion; [the request](https://github.com/trakt-tools/universal-trakt-scrobbler/issues/339)
  has been open since 2023.
- **No customer API.** The Channel runs on Vimeo OTT (VHX), whose API is
  scoped to the *site owner's* key — Criterion's, not yours.
- **No readable playback metadata.** Viewing happens on an NVIDIA Shield, so
  browser-extension scrobblers are irrelevant. The Android app publishes only
  `"The Criterion Channel"` to Android's MediaSession — never the film title —
  so nothing on the device can tell *which* film played. Verified on the Shield
  (Android 11, Criterion app v10.303.1).

So: log Criterion watches to Letterboxd as usual. The Letterboxd profile picks
them up from the RSS feed on every scheduled run and every "Sync now", and never
forgets them — that path exists precisely because this one doesn't. Trakt is a
supplement, not a requirement.

## Notes

- Routing is hash-based (`/#/queue`), so the app works from any static host or `file://` without server rewrites.
- Posters/backdrops are loaded directly from TMDB's CDN; an internet connection is needed for images.
