#!/usr/bin/env python3
"""build_from_trakt.py — refresh Cineprompt's live data from the Trakt API.

Trakt is now reachable (public profile, api-key only) and returns TMDB ids
natively, so this is the cleanest source for watch history. Refreshes the
dynamic sections (watched set, recent watches, stats, by_month, diary ratings,
decade blindspots, slates) and preserves the curated sections from a base
data.json. With --enrich it also recomputes genre/language/director blindspots
from TMDB (slow first run, cached afterwards).

Usage:
    python build_from_trakt.py <base_data.json> <out.json> [--enrich]
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

from tmdb import TMDB

API = "https://api.trakt.tv"
UA = "CinemapromptV2/1.0"


def _env():
    env = {}
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


ENV = _env()
# Fall back to real environment variables so this works in CI (no .env file).
CID = ENV.get("TRAKT_CLIENT_ID") or os.environ.get("TRAKT_CLIENT_ID")
USER = ENV.get("TRAKT_USER") or os.environ.get("TRAKT_USER", "TheAntagonist2049")
HEADERS = {"trakt-api-version": "2", "trakt-api-key": CID, "User-Agent": UA,
           "Content-Type": "application/json"}


def trakt_get(path, params=None):
    """GET a Trakt endpoint; returns (json, response_headers)."""
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r), dict(r.headers)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 * (attempt + 1)); continue
            if e.code == 404:
                return None, {}
            time.sleep(1)
        except Exception:
            time.sleep(1)
    return None, {}


def trakt_paged(path, params=None, page_limit=100):
    """Fetch all pages of a paginated Trakt list endpoint."""
    params = dict(params or {})
    params["limit"] = params.get("limit", 100)
    out = []
    page = 1
    while page <= page_limit:
        params["page"] = page
        data, headers = trakt_get(path, params)
        if not data:
            break
        out.extend(data)
        hlow = {k.lower(): v for k, v in headers.items()}
        total_pages = int(hlow.get("x-pagination-page-count", page) or page)
        if page >= total_pages:
            break
        page += 1
    return out


def main(base_path, out_path, enrich=False):
    if not CID:
        sys.exit("Set TRAKT_CLIENT_ID in datagen/.env")
    base = json.load(open(base_path, encoding="utf-8"))
    tmdb = TMDB()

    print(f"Pulling Trakt data for {USER}...")
    watched = trakt_get(f"/users/{USER}/watched/movies")[0] or []
    ratings = trakt_get(f"/users/{USER}/ratings/movies")[0] or []
    stats = trakt_get(f"/users/{USER}/stats")[0] or {}
    print(f"  watched={len(watched)} ratings={len(ratings)}")

    # recent history (chronological) — pull enough pages to cover ~12 months
    history = trakt_paged(f"/users/{USER}/history/movies", {"limit": 100}, page_limit=15)
    print(f"  history rows={len(history)}")

    # --- watched set + plays + last_watched (tmdb ids native) ---
    watched_ids = set()
    play_of = {}
    last_of = {}
    ty_of = {}
    for w in watched:
        m = w.get("movie", {})
        tid = (m.get("ids") or {}).get("tmdb")
        if not tid:
            continue
        watched_ids.add(tid)
        play_of[tid] = w.get("plays", 1)
        last_of[tid] = (w.get("last_watched_at") or "")[:10]
        ty_of[tid] = (m.get("title"), m.get("year"))

    # --- recent watches from history (most recent distinct films) ---
    recent_watches = []
    seen_recent = set()
    for h in history:
        m = h.get("movie", {})
        tid = (m.get("ids") or {}).get("tmdb")
        if not tid or tid in seen_recent:
            continue
        seen_recent.add(tid)
        recent_watches.append({
            "title": m.get("title"),
            "year": m.get("year") or 0,
            "tmdb": tid,
            "last_watched": (h.get("watched_at") or "")[:10],
            "plays": play_of.get(tid, 1),
        })
        if len(recent_watches) >= 50:
            break

    # --- ratings (Trakt rating is 1-10) ---
    rating_of = {}
    for r in ratings:
        m = r.get("movie", {})
        tid = (m.get("ids") or {}).get("tmdb")
        if tid:
            rating_of[tid] = r.get("rating")
    dist = Counter(str(v) for v in rating_of.values() if v)

    # --- this week + by_month from history ---
    today = datetime.now().date()
    week_ago = today - timedelta(days=7)
    by_month = Counter()
    this_week = 0
    for h in history:
        ds = (h.get("watched_at") or "")[:10]
        try:
            d = datetime.strptime(ds, "%Y-%m-%d").date()
        except ValueError:
            continue
        if d >= week_ago:
            this_week += 1
        by_month[d.strftime("%Y-%m")] += 1
    by_month = dict(sorted(by_month.items())[-12:])

    movie_stats = stats.get("movies", {}) if isinstance(stats, dict) else {}
    stat_block = {
        "total_watched": movie_stats.get("watched", len(watched_ids)),
        "total_minutes": movie_stats.get("minutes", 0),
        "total_rated": len(rating_of),
        "this_week": this_week,
        "ratings_distribution": {str(k): dist.get(str(k), 0) for k in range(1, 11)},
    }

    # --- decade blindspots (years from Trakt; no TMDB needed) ---
    by_decade = Counter()
    for tid in watched_ids:
        _, yr = ty_of.get(tid, (None, None))
        if yr:
            by_decade[str((int(yr) // 10) * 10)] += 1
    total_dec = sum(by_decade.values()) or 1
    decade_pct = {k: round(100 * v / total_dec, 1) for k, v in by_decade.items()}
    under = [int(k) for k, _ in sorted(by_decade.items(), key=lambda kv: kv[1])[:4]]

    blind = dict(base.get("blindspots", {}))
    blind.update({
        "by_decade": dict(sorted(by_decade.items())),
        "decade_pct": dict(sorted(decade_pct.items())),
        "under_watched_decades": under,
        "total_watched": len(watched_ids),
        "ratings_distribution": stat_block["ratings_distribution"],
    })

    diary_ratings = {}
    for tid, rv in rating_of.items():
        nm, yr = ty_of.get(tid, (None, None))
        if nm and rv:
            diary_ratings[f"{nm}|{yr}"] = round(rv / 2.0, 1)

    # --- optional TMDB enrichment for genre/language/director blindspots ---
    if enrich:
        print(f"Enriching {len(watched_ids)} watched films via TMDB (cached)...")
        genres = Counter(); langs = Counter(); countries = Counter()
        dir_seen = Counter(); dir_ratings = defaultdict(list)
        done = 0
        for tid in watched_ids:
            m = tmdb.movie(tid)
            done += 1
            if done % 250 == 0:
                print(f"  {done}/{len(watched_ids)}"); tmdb.save()
            if not m:
                continue
            for g in m.get("genres", []):
                genres[g] += 1
            if m.get("original_language"):
                langs[m["original_language"]] += 1
            for c in m.get("production_countries", []):
                countries[c] += 1
            for dn in m.get("directors", []):
                dir_seen[dn] += 1
                if tid in rating_of:
                    dir_ratings[dn].append(rating_of[tid] / 2.0)
        tmdb.save()
        loved = [{"name": n, "avg_rating": round(sum(rs) / len(rs), 2), "seen": dir_seen[n]}
                 for n, rs in dir_ratings.items() if len(rs) >= 3]
        loved.sort(key=lambda x: (-x["avg_rating"], -x["seen"]))
        blind.update({
            "genres": dict(genres.most_common()),
            "languages": dict(langs.most_common()),
            "countries": dict(countries.most_common()),
            "loved_directors": loved[:20],
            "director_seen_counts": dict(dir_seen.most_common(200)),
        })

    # --- update seen flags in curated sections ---
    def mark_seen(o):
        if isinstance(o, dict):
            if isinstance(o.get("tmdb_id"), int) and "seen" in o:
                o["seen"] = o["tmdb_id"] in watched_ids
            for v in o.values():
                mark_seen(v)
        elif isinstance(o, list):
            for v in o:
                mark_seen(v)
    for k in ("canon", "screenplays", "themed_weeks", "directors", "director_targets", "craft_dimensions"):
        if k in base:
            mark_seen(base[k])

    # --- assemble ---
    d = dict(base)
    d["stats"] = stat_block
    d["blindspots"] = blind
    d["watched_tmdb_set"] = sorted(watched_ids)
    d["recent_watches"] = recent_watches
    d["by_month"] = by_month
    d["diary_ratings"] = {**base.get("diary_ratings", {}), **diary_ratings}
    now_iso = datetime.now(timezone.utc).astimezone().isoformat()
    d["generated_at"] = now_iso
    d["last_sync"] = now_iso

    # --- slates from existing pools, filtered against fresh watched set ---
    from refresh_slates import seeded_shuffle
    fp, seen = [], set()
    for f in (base.get("queue", []) + base.get("focus_pool_extra", [])):
        t = f.get("tmdb_id")
        if t not in seen and t not in watched_ids:
            seen.add(t); fp.append(f)
    bp = list(base.get("background_pool", []))
    if fp and bp:
        s = today.toordinal()
        fr = seeded_shuffle(fp, s); br = seeded_shuffle(bp, s + 7)
        slates = []
        for n in range(14):
            day = today + timedelta(days=n)
            slates.append({
                "date": day.isoformat(), "weekday": day.strftime("%A"),
                "focus": [fr[(n * 3 + k) % len(fr)] for k in range(3)],
                "background": [br[(n * 2 + k) % len(br)] for k in range(2)],
            })
        d["slates"] = slates
        d["todays_pick"] = slates[0]["focus"][0]

    json.dump(d, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
    print("\nWrote", out_path)
    print(f"  watched: {len(watched_ids)} | rated: {stat_block['total_rated']} | "
          f"this_week: {stat_block['this_week']} | minutes: {stat_block['total_minutes']}")
    if recent_watches:
        r0 = recent_watches[0]
        print(f"  newest watch: {r0['title']} ({r0['year']}) on {r0['last_watched']}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    enrich = "--enrich" in sys.argv
    if len(args) < 2:
        sys.exit("Usage: python build_from_trakt.py <base_data.json> <out.json> [--enrich]")
    main(args[0], args[1], enrich)
