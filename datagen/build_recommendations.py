#!/usr/bin/env python3
"""build_recommendations.py — the Cineprompt discovery engine.

The other builders (build_from_trakt / build_data) only RECYCLE a fixed pool of
recommendations that was curated once and baked into data.json. As you watch
those films they drop out and are never replaced, so the "challenge me with
films I haven't seen" engine slowly goes empty.

This script regenerates that engine from scratch every run:

  1. Pull the taste profile from Trakt  (watched set, ratings, history, stats).
  2. Enrich the watched set via TMDB     (genres / languages / countries /
     directors + avg ratings)  ->  full blindspot picture + loved directors.
  3. Discover UNSEEN candidate films from four angles:
       - canon lists already in data.json (Best Picture / Sight & Sound /
         AFI / Criterion) that you haven't seen
       - the unseen filmographies of directors you rate highly
       - TMDB discover for your under-watched decades
       - TMDB discover for world-cinema languages you rarely watch
       - the TMDB canonical top (high rating + high vote count)
  4. Score every candidate on the same philosophy your data already uses:
         canonical quality + blindspot-fill + director affinity
     with a vote-count quality floor so junk (concert videos, mis-resolved
     credits) never makes the cut.
  5. Write fresh queue / focus_pool_extra (the challenge pool), a comfort
     background_pool (your highest-rated rewatches), refreshed director_targets,
     fully-populated blindspots, regenerated mood buckets, and a 14-day slate.

Curated structural sections (canon, screenplays, themed_weeks, craft_dimensions,
moods_meta, user) are preserved from the base data.json, with their `seen`
flags updated against the fresh watched set.

Usage:
    python build_recommendations.py <base_data.json> <out.json>
    python build_recommendations.py            # uses client/public/data.json in place
"""
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

# star characters in the reasons need a utf-8 console (Windows + CI/POSIX locale)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from tmdb import TMDB
from refresh_slates import seeded_shuffle
from build_from_trakt import trakt_get, trakt_paged, USER, CID

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(HERE, "..", "client", "public", "data.json")

# ---- tunables -------------------------------------------------------------
FOCUS_QUEUE = 50          # primary "challenge" pool size
FOCUS_EXTRA = 45          # secondary focus pool
BACKGROUND_N = 45         # comfort rewatch pool size
PER_DIRECTOR_CAP = 3      # max films from one director across the focus pool
VOTE_FLOOR = 250          # discover candidates need this many TMDB votes
DIR_VOTE_FLOOR = 120      # a loved director's own films get a gentler floor
MIN_RUNTIME = 60          # kill featurettes / concert videos
QUALITY_VOTE_AVG = 6.3    # a film must clear this to be worth your time
MOOD_PICK_CAP = 80        # films per mood bucket

# world-cinema languages worth surfacing if you rarely watch them
WORLD_LANGS = ["ja", "fr", "it", "ko", "de", "es", "ru", "sv",
               "fa", "zh", "da", "pl", "cs", "hi", "pt", "fi"]
LANG_NAMES = {
    "ja": "Japanese", "fr": "French", "it": "Italian", "ko": "Korean",
    "de": "German", "es": "Spanish", "ru": "Russian", "sv": "Swedish",
    "fa": "Persian", "zh": "Chinese", "da": "Danish", "pl": "Polish",
    "cs": "Czech", "hi": "Hindi", "pt": "Portuguese", "fi": "Finnish",
    "no": "Norwegian", "tr": "Turkish", "nl": "Dutch", "en": "English",
}
CANON_LABEL = {
    "best_picture": "Best Picture winners",
    "sight_and_sound_2022": "Sight & Sound 2022",
    "afi_100": "AFI 100",
    "criterion": "Criterion Collection",
    "bespoke_canon": "your Bespoke Canon",
    "lb_greats": "your Letterboxd Greats",
    "all_killer": "All Killer No Filler",
    "mubi": "MUBI",
    "surreal": "Surreal, Psychedelic & Mind-Bending",
    "films_1970s": "1000 Films: the 70s",
}
CANON_BONUS = {
    "sight_and_sound_2022": 16, "best_picture": 12,
    "criterion": 12, "afi_100": 10,
    # your own curated lists — weighted like canon so genre picks compete
    "bespoke_canon": 16, "all_killer": 13, "lb_greats": 12,
    "mubi": 11, "surreal": 10, "films_1970s": 9,
}

# Genre/pulp signal — the crime, horror, thriller and genre pictures that keep
# the slate from reading like homework.
PULP_GENRES = {"Horror", "Thriller", "Action", "Crime", "Science Fiction",
               "Mystery", "Western"}
PULP_GENRE_IDS = {"Horror": 27, "Thriller": 53, "Crime": 80,
                  "Science Fiction": 878, "Action": 28}
CANON_CAND_CAP = 300   # max candidates pulled from any single canon list (cost bound)
COLLECTION_CAND_CAP = 220  # max candidates pulled from any single personal list
LANE_BONUS_FALLBACK = {
    "streaming_now": 12,
    "pulp": 10,
    "deep_weird": 9,
    "comfort": 8,
    "canon": 8,
    "assignment": 6,
}
# Target tonal mix for the focus pool — intersperse the pulp, don't bury it.
REGISTER_TARGET = {"pulp": 0.40, "middle": 0.30, "heavy": 0.30}


def register(f):
    """Tonal register: 'heavy' (arthouse/challenge), 'pulp' (genre), 'middle'."""
    g = set(f.get("genres", []))
    lang = f.get("original_language") or ""
    yr = int(f["year"]) if str(f.get("year", "")).isdigit() else 0
    rt = f.get("runtime") or 0
    # Genre-forward AND watchable (English or modern), not an epic -> pulp.
    if (g & PULP_GENRES) and (lang == "en" or yr >= 1968) and rt < 150:
        return "pulp"
    # Very long, or older/serious world cinema, or any remaining foreign -> heavy.
    if rt >= 155 or (lang and lang != "en"):
        return "heavy"
    return "middle"


def lang_name(code):
    return LANG_NAMES.get(code, (code or "").upper())


# ---------------------------------------------------------------- Trakt pull
def pull_trakt():
    if not CID:
        sys.exit("Set TRAKT_CLIENT_ID in datagen/.env")
    print(f"Pulling Trakt taste profile for {USER}...")
    # /watched/movies is paginated (100/page) — page through it all, or the
    # watched set silently truncates to 100 and every "unseen" pick is wrong.
    watched = trakt_paged(f"/users/{USER}/watched/movies", {"limit": 100}, page_limit=200) or []
    ratings = trakt_get(f"/users/{USER}/ratings/movies")[0] or []
    stats = trakt_get(f"/users/{USER}/stats")[0] or {}
    history = trakt_paged(f"/users/{USER}/history/movies", {"limit": 100}, page_limit=15)
    print(f"  watched={len(watched)} ratings={len(ratings)} history={len(history)}")

    watched_ids, play_of, last_of, ty_of = set(), {}, {}, {}
    for w in watched:
        m = w.get("movie", {})
        tid = (m.get("ids") or {}).get("tmdb")
        if not tid:
            continue
        watched_ids.add(tid)
        play_of[tid] = w.get("plays", 1)
        last_of[tid] = (w.get("last_watched_at") or "")[:10]
        ty_of[tid] = (m.get("title"), m.get("year"))

    rating_of = {}
    for r in ratings:
        m = r.get("movie", {})
        tid = (m.get("ids") or {}).get("tmdb")
        if tid and r.get("rating"):
            rating_of[tid] = r["rating"]          # 1-10
            ty_of.setdefault(tid, (m.get("title"), m.get("year")))

    return {
        "watched_ids": watched_ids, "play_of": play_of, "last_of": last_of,
        "ty_of": ty_of, "rating_of": rating_of, "history": history, "stats": stats,
    }


# ---------------------------------------------------------------- enrichment
def enrich(tmdb, prof):
    """Walk the watched set through TMDB (cached) to build blindspots + loved
    directors + the set of directors/genres/languages the taste profile loves."""
    watched_ids = prof["watched_ids"]
    rating_of = prof["rating_of"]
    print(f"Enriching {len(watched_ids)} watched films via TMDB (cached)...")
    genres = Counter(); langs = Counter(); countries = Counter()
    by_decade = Counter()
    dir_seen = Counter(); dir_ratings = defaultdict(list)
    genre_ratings = defaultdict(list)
    done = 0
    for tid in watched_ids:
        m = tmdb.movie(tid)
        done += 1
        if done % 500 == 0:
            print(f"  {done}/{len(watched_ids)}"); tmdb.save()
        if not m:
            continue
        yr = m.get("year")
        if yr and str(yr).isdigit():
            by_decade[str((int(yr) // 10) * 10)] += 1
        for g in m.get("genres", []):
            genres[g] += 1
            if tid in rating_of:
                genre_ratings[g].append(rating_of[tid])
        if m.get("original_language"):
            langs[m["original_language"]] += 1
        for c in m.get("production_countries", []):
            countries[c] += 1
        for dn in m.get("directors", []):
            dir_seen[dn] += 1
            if tid in rating_of:
                dir_ratings[dn].append(rating_of[tid] / 2.0)   # -> 0-5 scale
    tmdb.save()

    loved = [{"name": n, "avg_rating": round(sum(rs) / len(rs), 2), "seen": dir_seen[n]}
             for n, rs in dir_ratings.items() if len(rs) >= 3]
    loved.sort(key=lambda x: (-x["avg_rating"], -x["seen"]))

    total_dec = sum(by_decade.values()) or 1
    decade_pct = {k: round(100 * v / total_dec, 1) for k, v in by_decade.items()}
    under_decades = [int(k) for k, _ in sorted(by_decade.items(), key=lambda kv: kv[1])[:4]]

    # languages you watch the least among the world-cinema set (but have touched)
    lang_blind = [c for c in WORLD_LANGS if langs.get(c, 0) < max(8, langs.get("en", 0) * 0.01)]

    # genres you rate highly (affinity nudge)
    loved_genres = {g for g, rs in genre_ratings.items()
                    if len(rs) >= 5 and sum(rs) / len(rs) >= 7.0}

    return {
        "genres": genres, "langs": langs, "countries": countries,
        "by_decade": by_decade, "decade_pct": decade_pct,
        "under_decades": under_decades, "lang_blind": lang_blind,
        "loved": loved, "dir_seen": dir_seen,
        "dir_avg": {d["name"]: d["avg_rating"] for d in loved},
        "loved_genres": loved_genres,
    }


# ---------------------------------------------------------------- candidates
def gather_candidates(tmdb, base, prof, enr):
    """Return {tmdb_id: {"sources": set(), "canon": set(), "collections": set()}}."""
    watched = prof["watched_ids"]
    cand = defaultdict(lambda: {"sources": set(), "canon": set(), "collections": set()})

    # 1) canon lists already in the data — unseen entries are prime challenges.
    #    Includes your curated MDBList lists (genre/pulp), capped per list.
    for list_key, films in (base.get("canon") or {}).items():
        n = 0
        for f in films:
            tid = f.get("tmdb_id")
            if tid and tid not in watched:
                cand[tid]["sources"].add("canon")
                cand[tid]["canon"].add(list_key)
                n += 1
                if n >= CANON_CAND_CAP:
                    break

    # 1b) the broader MDBList library. These are personal terrain, but capped
    # per list so huge archive lists do not overwhelm the curated canon signal.
    for list_key, films in (base.get("collections") or {}).items():
        n = 0
        for f in films:
            tid = f.get("tmdb_id")
            if tid and tid not in watched:
                cand[tid]["sources"].add("collection")
                cand[tid]["collections"].add(list_key)
                n += 1
                if n >= COLLECTION_CAND_CAP:
                    break

    # 2) unseen filmographies of directors you rate highly
    loved_top = enr["loved"][:24]
    print(f"Scanning {len(loved_top)} loved directors' filmographies...")
    # resolve director name -> person id (reuse ids already in the data where we can)
    name_to_pid = {}
    for sect in ("director_targets", "directors"):
        for name, obj in (base.get(sect) or {}).items():
            if isinstance(obj, dict) and isinstance(obj.get("id"), int):
                name_to_pid[name] = obj["id"]
    for d in loved_top:
        pid = name_to_pid.get(d["name"]) or tmdb.person_search(d["name"])
        if not pid:
            continue
        for f in tmdb.person_directed(pid):
            tid = f.get("tmdb_id")
            if (tid and tid not in watched
                    and (f.get("vote_count") or 0) >= DIR_VOTE_FLOOR
                    and (f.get("vote_average") or 0) >= QUALITY_VOTE_AVG):
                cand[tid]["sources"].add(f"dir::{d['name']}")
    tmdb.save()

    # 3) discover by under-watched decade (acclaimed, well-voted)
    for dec in enr["under_decades"]:
        results = tmdb.discover({
            "sort_by": "vote_average.desc",
            "vote_count.gte": max(VOTE_FLOOR, 400),
            "primary_release_date.gte": f"{dec}-01-01",
            "primary_release_date.lte": f"{dec + 9}-12-31",
            "with_runtime.gte": MIN_RUNTIME,
        }, pages=2)
        for r in results:
            tid = r.get("id")
            if tid and tid not in watched:
                cand[tid]["sources"].add(f"decade::{dec}")

    # 4) discover world-cinema languages you rarely watch
    for code in enr["lang_blind"][:6]:
        results = tmdb.discover({
            "sort_by": "vote_average.desc",
            "vote_count.gte": VOTE_FLOOR,
            "with_original_language": code,
            "with_runtime.gte": MIN_RUNTIME,
        }, pages=1)
        for r in results:
            tid = r.get("id")
            if tid and tid not in watched:
                cand[tid]["sources"].add(f"lang::{code}")

    # 5) the canonical top — broadly acclaimed films you may have missed
    results = tmdb.discover({
        "sort_by": "vote_average.desc",
        "vote_count.gte": 3000,
        "with_runtime.gte": MIN_RUNTIME,
    }, pages=3)
    for r in results:
        tid = r.get("id")
        if tid and tid not in watched:
            cand[tid]["sources"].add("canonical")

    # 6) genre/pulp discovery — acclaimed crime, horror, thriller, sci-fi, action
    #    (cult-friendly vote floor) so the pool has real genre to intersperse.
    for name, gid in PULP_GENRE_IDS.items():
        results = tmdb.discover({
            "sort_by": "vote_average.desc",
            "vote_count.gte": 600,
            "with_genres": str(gid),
            "with_runtime.gte": MIN_RUNTIME,
        }, pages=2)
        for r in results:
            tid = r.get("id")
            if tid and tid not in watched:
                cand[tid]["sources"].add(f"genre::{name}")

    print(f"  {len(cand)} distinct unseen candidates gathered.")
    return cand


# ---------------------------------------------------------------- scoring
def score_candidate(m, info, enr):
    """Return (score, reasons[]) for an enriched candidate movie dict `m`."""
    q = m.get("vote_average") or 0
    vc = m.get("vote_count") or 0
    reasons = []
    score = q * 8.0                                   # canonical quality, ~0-80

    # director affinity
    best_dir, best_avg = None, 0
    for dn in m.get("directors", []):
        a = enr["dir_avg"].get(dn, 0)
        if a > best_avg:
            best_dir, best_avg = dn, a
    if best_dir and best_avg >= 4.0:
        score += (best_avg - 3.5) * 9
        reasons.append(f"you've rated {best_dir}'s work {best_avg:g}★ avg")

    # canon membership (strongest single signal)
    canon_keys = sorted(info["canon"], key=lambda k: -CANON_BONUS.get(k, 0))
    if canon_keys:
        k = canon_keys[0]
        score += CANON_BONUS.get(k, 10)
        reasons.append(f"on the {CANON_LABEL.get(k, k)} list")

    # broader personal-list membership. This is a nudge, not a canon hammer:
    # it lets genre/action/horror/watch-now lists participate in the slate.
    collection_keys = sorted(info.get("collections", []))
    if collection_keys:
        meta_by_key = enr.get("collection_meta", {})
        best = max(
            collection_keys,
            key=lambda k: (
                meta_by_key.get(k, {}).get("lane_weight", 0),
                meta_by_key.get(k, {}).get("unseen", 0),
            ),
        )
        meta = meta_by_key.get(best, {})
        name = meta.get("name", best)
        lane = meta.get("lane")
        lane_label = meta.get("lane_label") or "personal"
        lane_bonus = meta.get("lane_weight") or LANE_BONUS_FALLBACK.get(lane, 7)
        score += lane_bonus
        reasons.append(f"on your {lane_label} lane via {name}")

    # decade blindspot
    yr = m.get("year")
    if yr and str(yr).isdigit():
        dec = (int(yr) // 10) * 10
        if dec in enr["under_decades"]:
            score += 10
            reasons.append(f"under-watched decade ({dec}s)")

    # language blindspot
    lc = m.get("original_language")
    if lc and lc in enr["lang_blind"]:
        score += 8
        reasons.append(f"rarely-watched {lang_name(lc)}-language cinema")

    # genre affinity
    gmatch = [g for g in m.get("genres", []) if g in enr["loved_genres"]]
    if gmatch:
        score += 3
        reasons.append(f"your kind of {gmatch[0].lower()}")

    # trust nudge for very well-voted films
    score += min(vc / 4000.0, 1.0) * 4

    if not reasons:
        if q >= 7.5:
            reasons.append(f"canonical ({q:.1f} on TMDB)")
        else:
            reasons.append("highly rated")

    return min(round(score), 99), reasons


def to_focus_film(m, score, reasons):
    return {
        "tmdb_id": m["tmdb_id"], "title": m.get("title"),
        "original_title": m.get("original_title"), "year": m.get("year"),
        "overview": m.get("overview", ""), "tagline": m.get("tagline", ""),
        "runtime": m.get("runtime", 0), "genres": m.get("genres", []),
        "directors": m.get("directors", []), "writers": m.get("writers", []),
        "cast": m.get("cast", []), "poster": m.get("poster"),
        "backdrop": m.get("backdrop"), "vote_average": m.get("vote_average", 0),
        "vote_count": m.get("vote_count", 0), "imdb_id": m.get("imdb_id"),
        "original_language": m.get("original_language"),
        "production_countries": m.get("production_countries", []),
        "score": score, "reasons": reasons,
    }


# ---------------------------------------------------------------- mood buckets
def mood_of(film):
    """Return the set of mood ids a film belongs to."""
    out = set()
    yr = film.get("year")
    dec = (int(yr) // 10) * 10 if (yr and str(yr).isdigit()) else None
    if dec == 1970:
        out.add("70s")
    elif dec == 1980:
        out.add("80s")
    elif dec == 1990:
        out.add("90s")
    if dec is not None and dec < 1950:
        out.add("early-cinema")

    g = set(film.get("genres", []))
    gmap = {
        "Horror": "horror", "Crime": "crime", "Comedy": "comedy",
        "Western": "western", "Science Fiction": "scifi", "War": "war",
        "Documentary": "documentary", "Animation": "animation", "Romance": "romance",
    }
    for name, mid in gmap.items():
        if name in g:
            out.add(mid)
    if g & {"Action", "Thriller"}:
        out.add("action-thriller")

    lc = film.get("original_language")
    if (lc and lc != "en") or ("criterion" in " ".join(film.get("reasons", [])).lower()):
        out.add("criterion")
    if dec is not None and 1967 <= (int(yr)) <= 1980 and "US" in film.get("production_countries", []):
        out.add("new-hollywood")
    if dec == 1980 and (g & {"Science Fiction", "Thriller", "Horror"}):
        out.add("neon-synth")
    if (film.get("vote_average") or 0) >= 7.5 and (film.get("vote_count") or 0) >= 2000:
        out.add("pure-vibes")

    rt = film.get("runtime") or 0
    if 0 < rt <= 100:
        out.add("short")
    elif rt >= 150:
        out.add("long")
    return out


def build_mood_picks(meta_ids, films):
    buckets = {mid: [] for mid in meta_ids}
    ranked = sorted(films, key=lambda f: f.get("score", 0), reverse=True)
    for f in ranked:
        for mid in mood_of(f):
            if mid in buckets and len(buckets[mid]) < MOOD_PICK_CAP:
                buckets[mid].append(f)
    return {mid: arr for mid, arr in buckets.items() if arr}


# ---------------------------------------------------------------- main
def build(base_path, out_path):
    base = json.load(open(base_path, encoding="utf-8"))
    tmdb = TMDB()
    prof = pull_trakt()
    watched = prof["watched_ids"]

    # Guard against a partial / rate-limited Trakt pull: if the watched set came
    # back far smaller than what's already on record, the "unseen" filter would
    # be wrong and we'd recommend films you've seen. Abort rather than ship it.
    prev_watched = len(base.get("watched_tmdb_set", []))
    if prev_watched >= 500 and len(watched) < prev_watched * 0.7:
        sys.exit(
            f"Trakt pull looks partial: {len(watched)} watched vs {prev_watched} "
            f"on record. Aborting so degraded data isn't written (try again shortly)."
        )

    enr = enrich(tmdb, prof)
    enr["collection_meta"] = {m["key"]: m for m in (base.get("collections_meta") or [])}

    cand = gather_candidates(tmdb, base, prof, enr)

    # --- resolve + score every candidate -----------------------------------
    print(f"Resolving + scoring {len(cand)} candidates via TMDB (cached)...")
    scored = []
    done = 0
    for tid, info in cand.items():
        m = tmdb.movie(tid)
        done += 1
        if done % 300 == 0:
            print(f"  {done}/{len(cand)}"); tmdb.save()
        if not m or m.get("tmdb_id") in watched:
            continue
        vc = m.get("vote_count") or 0
        is_canon = bool(info["canon"])
        floor = DIR_VOTE_FLOOR if (is_canon or any(s.startswith("dir::") for s in info["sources"])) else VOTE_FLOOR
        if not is_canon and (vc < floor or (m.get("vote_average") or 0) < QUALITY_VOTE_AVG):
            continue
        if (m.get("runtime") or 0) < MIN_RUNTIME and "short" not in mood_of(m):
            continue
        if not m.get("poster"):
            continue
        sc, reasons = score_candidate(m, info, enr)
        scored.append((sc, to_focus_film(m, sc, reasons)))
    tmdb.save()
    scored.sort(key=lambda x: x[0], reverse=True)
    print(f"  {len(scored)} candidates passed the quality floor.")

    # --- assemble focus pool: QUOTA by tonal register so the pulp is
    #     interspersed, not buried under prestige; per-director cap for breadth ---
    total = FOCUS_QUEUE + FOCUS_EXTRA
    targets = {r: max(1, round(total * frac)) for r, frac in REGISTER_TARGET.items()}
    buckets = {"pulp": [], "middle": [], "heavy": []}
    dir_count, used = Counter(), set()

    def eligible(f):
        return not any(dir_count[d] >= PER_DIRECTOR_CAP for d in (f.get("directors") or ["?"]))

    def take(f):
        for d in (f.get("directors") or ["?"]):
            dir_count[d] += 1
        used.add(f["tmdb_id"])

    # Pass 1: fill each register to its target from the highest-scored candidates.
    for sc, f in scored:
        if f["tmdb_id"] in used or not eligible(f):
            continue
        r = register(f)
        if len(buckets[r]) >= targets[r]:
            continue
        take(f); buckets[r].append(f)

    # Pass 2: if a register ran dry, backfill from the remaining best.
    combined = buckets["pulp"] + buckets["heavy"] + buckets["middle"]
    if len(combined) < total:
        for sc, f in scored:
            if f["tmdb_id"] in used or not eligible(f):
                continue
            take(f); combined.append(f)
            if len(combined) >= total:
                break

    # Round-robin interleave (lead pulp) so the queue alternates registers
    # instead of frontloading 30 arthouse films.
    final = combined[:total]
    by_reg = {"pulp": [], "heavy": [], "middle": []}
    for f in final:
        by_reg[register(f)].append(f)
    focus, ri = [], {"pulp": 0, "heavy": 0, "middle": 0}
    while len(focus) < len(final):
        for r in ("pulp", "heavy", "middle"):
            if ri[r] < len(by_reg[r]):
                focus.append(by_reg[r][ri[r]]); ri[r] += 1
    queue = focus[:FOCUS_QUEUE]
    focus_extra = focus[FOCUS_QUEUE:FOCUS_QUEUE + FOCUS_EXTRA]

    # --- background pool: your highest-rated films, as comfort rewatches ----
    rated_desc = sorted(prof["rating_of"].items(), key=lambda kv: (-kv[1],
                        prof["last_of"].get(kv[0], "")), reverse=False)
    rated_desc = sorted(prof["rating_of"].items(),
                        key=lambda kv: (kv[1], prof["last_of"].get(kv[0], "")),
                        reverse=True)
    background = []
    for tid, rv in rated_desc:
        if rv < 8:                      # 8/10+ on Trakt == a real favourite
            break
        m = tmdb.movie(tid)
        if not m or not m.get("poster"):
            continue
        bf = to_focus_film(m, min(round((m.get("vote_average") or 0) * 8 + 10), 99),
                           [f"you rated this {rv/2:g}★"])
        bf.update({
            "kind": "rewatch",
            "letterboxd_rating": round(rv / 2.0, 1),
            "diary_rating": round(rv / 2.0, 1),
            "last_watched": prof["last_of"].get(tid, ""),
            "plays": prof["play_of"].get(tid, 1),
        })
        background.append(bf)
        if len(background) >= BACKGROUND_N:
            break
    tmdb.save()

    # --- director_targets: unseen quality next-up per director -------------
    print("Rebuilding director targets...")
    name_to_pid = {}
    for sect in ("director_targets", "directors"):
        for name, obj in (base.get(sect) or {}).items():
            if isinstance(obj, dict) and isinstance(obj.get("id"), int):
                name_to_pid[name] = obj["id"]
    target_names = [d["name"] for d in enr["loved"][:40]]
    director_targets = {}
    for name in target_names:
        pid = name_to_pid.get(name) or tmdb.person_search(name)
        if not pid:
            continue
        films = tmdb.person_directed(pid)
        next_up, seen_count, total_rt = [], 0, 0
        for f in films:
            tid = f["tmdb_id"]
            if tid in watched:
                seen_count += 1
                continue
            if (f.get("vote_count") or 0) < DIR_VOTE_FLOOR or (f.get("vote_average") or 0) < QUALITY_VOTE_AVG:
                continue
            fm = tmdb.movie(tid)
            if not fm or not fm.get("poster") or (fm.get("runtime") or 0) < MIN_RUNTIME:
                continue
            total_rt += fm.get("runtime", 0)
            next_up.append({
                "tmdb_id": tid, "title": fm.get("title"), "year": fm.get("year"),
                "poster": fm.get("poster"), "vote_average": fm.get("vote_average", 0),
                "vote_count": fm.get("vote_count", 0), "overview": fm.get("overview", ""),
                "runtime": fm.get("runtime", 0), "seen": False,
            })
        next_up.sort(key=lambda x: (x["vote_average"], x["vote_count"]), reverse=True)
        if next_up:
            director_targets[name] = {
                "id": pid, "seen_count": seen_count,
                "unseen_quality_count": len(next_up),
                "total_runtime_minutes": total_rt,
                "total_runtime_hours": round(total_rt / 60, 1),
                "next_up": next_up[:8],
            }
    tmdb.save()

    # --- stats / recent / by_month / blindspots ----------------------------
    today = datetime.now().date()
    week_ago = today - timedelta(days=7)
    by_month = Counter(); this_week = 0
    recent_watches, seen_recent = [], set()
    for h in prof["history"]:
        m = h.get("movie", {})
        tid = (m.get("ids") or {}).get("tmdb")
        ds = (h.get("watched_at") or "")[:10]
        try:
            d = datetime.strptime(ds, "%Y-%m-%d").date()
            if d >= week_ago:
                this_week += 1
            by_month[d.strftime("%Y-%m")] += 1
        except ValueError:
            pass
        if tid and tid not in seen_recent:
            seen_recent.add(tid)
            recent_watches.append({
                "title": m.get("title"), "year": m.get("year") or 0, "tmdb": tid,
                "last_watched": ds, "plays": prof["play_of"].get(tid, 1),
            })
    by_month = dict(sorted(by_month.items())[-12:])
    recent_watches = recent_watches[:50]

    dist = Counter(str(v) for v in prof["rating_of"].values() if v)
    movie_stats = (prof["stats"].get("movies", {})
                   if isinstance(prof["stats"], dict) else {})
    stats = {
        "total_watched": movie_stats.get("watched", len(watched)),
        "total_minutes": movie_stats.get("minutes", 0),
        "total_rated": len(prof["rating_of"]),
        "this_week": this_week,
        "ratings_distribution": {str(k): dist.get(str(k), 0) for k in range(1, 11)},
    }
    blindspots = {
        "by_decade": dict(sorted(enr["by_decade"].items())),
        "decade_pct": dict(sorted(enr["decade_pct"].items())),
        "under_watched_decades": enr["under_decades"],
        "languages": dict(enr["langs"].most_common()),
        "genres": dict(enr["genres"].most_common()),
        "countries": dict(enr["countries"].most_common()),
        "loved_directors": enr["loved"][:20],
        "director_seen_counts": dict(enr["dir_seen"].most_common(200)),
        "total_watched": len(watched),
        "total_runtime_min": stats["total_minutes"],
        "ratings_distribution": stats["ratings_distribution"],
    }
    diary_ratings = {}
    for tid, rv in prof["rating_of"].items():
        nm, yr = prof["ty_of"].get(tid, (None, None))
        if nm:
            diary_ratings[f"{nm}|{yr}"] = round(rv / 2.0, 1)

    # --- update seen flags in curated sections -----------------------------
    def mark_seen(o):
        if isinstance(o, dict):
            if isinstance(o.get("tmdb_id"), int) and "seen" in o:
                o["seen"] = o["tmdb_id"] in watched
            for v in o.values():
                mark_seen(v)
        elif isinstance(o, list):
            for v in o:
                mark_seen(v)
    for k in ("canon", "collections", "screenplays", "themed_weeks", "craft_dimensions", "directors"):
        if k in base:
            mark_seen(base[k])

    # --- mood buckets from the fresh pools ---------------------------------
    meta_ids = [m["id"] for m in base.get("moods_meta", [])]
    mood_pool = queue + focus_extra + background
    mood_picks = build_mood_picks(meta_ids, mood_pool)

    # --- slates: 14-day window. Each day is a deliberate MIX of registers so a
    #     night reads as "a challenge + a genre pick + a wildcard", not homework.
    #     The leading register rotates daily so today's #1 isn't always arthouse.
    reg_pool = {"pulp": [], "heavy": [], "middle": []}
    for f in (queue + focus_extra):
        reg_pool[register(f)].append(f)
    seedbase = today.toordinal()
    reg_pool["heavy"] = seeded_shuffle(reg_pool["heavy"], seedbase + 1)
    reg_pool["pulp"] = seeded_shuffle(reg_pool["pulp"], seedbase + 2)
    reg_pool["middle"] = seeded_shuffle(reg_pool["middle"], seedbase + 3)
    br = seeded_shuffle(background, seedbase + 7)
    all_focus = seeded_shuffle(queue + focus_extra, seedbase)  # fallback

    BASE_PLAN = ["heavy", "pulp", "middle"]
    ri = {"heavy": 0, "pulp": 0, "middle": 0}
    slates = []
    for n in range(14):
        day = today + timedelta(days=n)
        plan = BASE_PLAN[n % 3:] + BASE_PLAN[:n % 3]
        trio = []
        for r in plan:
            pool = reg_pool[r]
            if pool:
                trio.append(pool[ri[r] % len(pool)]); ri[r] += 1
        # backfill from the shuffled union if a register was empty
        k = 0
        while len(trio) < 3 and all_focus:
            c = all_focus[(n * 3 + k) % len(all_focus)]
            if c["tmdb_id"] not in {t["tmdb_id"] for t in trio}:
                trio.append(c)
            k += 1
            if k > len(all_focus):
                break
        slates.append({
            "date": day.isoformat(), "weekday": day.strftime("%A"),
            "focus": trio[:3],
            "background": [br[(n * 2 + j) % len(br)] for j in range(2)] if br else [],
        })

    # --- assemble ----------------------------------------------------------
    d = dict(base)
    now_iso = datetime.now(timezone.utc).astimezone().isoformat()
    d.update({
        "stats": stats, "blindspots": blindspots,
        "watched_tmdb_set": sorted(watched), "recent_watches": recent_watches,
        "by_month": by_month, "diary_ratings": {**base.get("diary_ratings", {}), **diary_ratings},
        "queue": queue, "focus_pool_extra": focus_extra, "background_pool": background,
        "director_targets": director_targets, "mood_picks": mood_picks,
        "slates": slates, "todays_pick": slates[0]["focus"][0],
        "generated_at": now_iso, "last_sync": now_iso,
        "version": base.get("version", "v5"),
    })
    # Fail loudly rather than ship a thin/empty data.json (e.g. if TMDB/Trakt
    # were unreachable or rate-limited and most calls silently returned None).
    if len(queue) < 10 or len(background) < 5:
        sys.exit(
            f"Refusing to write degraded data: queue={len(queue)} "
            f"background={len(background)} (a network/rate-limit failure?). "
            f"Left {out_path} untouched."
        )

    json.dump(d, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)

    print("\nWrote", out_path)
    print(f"  watched: {len(watched)} | rated: {stats['total_rated']} | this_week: {this_week}")
    print(f"  queue: {len(queue)} | focus_extra: {len(focus_extra)} | background: {len(background)}")
    print(f"  director_targets: {len(director_targets)} | mood buckets: {len(mood_picks)}")
    if queue:
        print(f"  top pick: {queue[0]['title']} ({queue[0]['year']}) score={queue[0]['score']}")
        print(f"           reasons: {queue[0]['reasons']}")
    print(f"  blindspot langs: {len(blindspots['languages'])} | genres: {len(blindspots['genres'])}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base = args[0] if len(args) > 0 else DEFAULT_DATA
    out = args[1] if len(args) > 1 else base
    build(base, out)
