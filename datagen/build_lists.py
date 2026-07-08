#!/usr/bin/env python3
"""build_lists.py — rebuild Cineprompt's Canon + Collections sections from
Dalton's own MDBList lists, which carry exact TMDB ids (so seen/unseen is
precise, not scraped).

Replaces the stale built-in `criterion` with the real Complete Criterion
Collection and adds his curated lists as new checklists. Keeps the standard
built-in canons (Best Picture / Sight & Sound / AFI), re-marking their `seen`
flags against the current watched set. Writes `canon` + `canon_meta`, plus
`collections` + `collections_meta` for the full MDBList library.

Key: MDBLIST_API_KEY from the environment or datagen/.env.

Usage:
    python build_lists.py [data.json]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.mdblist.com"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(HERE, "..", "client", "public", "data.json")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Built-in canons to keep (read from existing data.json), in display order.
BUILTIN_ORDER = [
    ("best_picture", "Best Picture Winners"),
    ("sight_and_sound_2022", "Sight & Sound 2022"),
    ("afi_100", "AFI 100 Years…100 Movies"),
]

# Dalton's MDBList lists -> Canon categories. (mdblist_id, key, display_name)
# `criterion` intentionally reuses the existing key so it replaces the stale one.
MDBLIST_LISTS = [
    (184962, "criterion", "The Complete Criterion Collection"),
    (148032, "bespoke_canon", "Bespoke Canon"),
    (153831, "lb_greats", "Letterboxd Greats"),
    (122211, "all_killer", "All Killer No Filler"),
    (168335, "mubi", "MUBI"),
    (157997, "surreal", "Surreal, Psychedelic & Mind-Bending"),
    (165324, "films_1970s", "1000 Films: The 1970s"),
]

# Cineprompt-generated output should not feed back into source collections.
# The app is movie-shaped for now, so TV/show lists are skipped here.
SKIP_LIST_IDS = {184977}
SKIP_MEDIA_TYPES = {"show"}

LANE_PROFILES = {
    "streaming_now": {
        "label": "Streaming Now",
        "description": "available and time-sensitive",
        "weight": 12,
        "order": 0,
    },
    "pulp": {
        "label": "Pulp",
        "description": "genre fuel, crime, horror, action, sci-fi",
        "weight": 10,
        "order": 1,
    },
    "comfort": {
        "label": "Comfort",
        "description": "familiar, re-entry, low-friction watches",
        "weight": 8,
        "order": 2,
    },
    "deep_weird": {
        "label": "Deep Weird",
        "description": "surreal, psychedelic, formally strange",
        "weight": 9,
        "order": 3,
    },
    "canon": {
        "label": "Canon",
        "description": "major works and durable reputation",
        "weight": 8,
        "order": 4,
    },
    "assignment": {
        "label": "Assignment",
        "description": "criticism homework made navigable",
        "weight": 6,
        "order": 5,
    },
}


def _key():
    k = os.environ.get("MDBLIST_API_KEY")
    if k:
        return k.strip()
    p = os.path.join(HERE, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line.startswith("MDBLIST_API_KEY=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip()
    sys.exit("Set MDBLIST_API_KEY (environment or datagen/.env)")


KEY = _key()


def _get(path, params=None):
    params = dict(params or {})
    params["apikey"] = KEY
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Cineprompt/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 * (attempt + 1)); continue
            sys.exit(f"MDBList GET {path} -> HTTP {e.code}: {e.read().decode()[:200]}")
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1)


def fetch_list_items(list_id):
    """All movie items of an MDBList list (paginated)."""
    items, offset = [], 0
    while True:
        d = _get(f"/lists/{list_id}/items", {"limit": 1000, "offset": offset})
        movies = d.get("movies", []) if isinstance(d, dict) else d
        items.extend(movies or [])
        pg = d.get("pagination") if isinstance(d, dict) else None
        if not pg or not pg.get("has_more"):
            break
        offset += 1000
    return items


def fetch_user_lists():
    lists = _get("/lists/user")
    if isinstance(lists, dict):
        lists = lists.get("lists", [])
    return lists or []


def collection_key(list_info):
    return f"mdblist_{list_info.get('id')}"


def classify_collection(list_info):
    """Assign a critic-use lane to a personal MDBList list."""
    text = " ".join([
        list_info.get("name") or "",
        list_info.get("slug") or "",
        list_info.get("description") or "",
    ]).lower()

    if "streaming" in text:
        lane = "streaming_now"
    elif any(t in text for t in ("horror", "action", "sci", "fantasy", "r-rated", "crime", "thriller")):
        lane = "pulp"
    elif any(t in text for t in ("surreal", "psychedelic", "mind-bending")):
        lane = "deep_weird"
    elif any(t in text for t in ("criterion", "mubi", "digitized", "1950s", "1960s", "1970s", "1980s", "21st century")):
        lane = "assignment"
    elif any(t in text for t in ("nostalgia", "80s", "90s")):
        lane = "comfort"
    else:
        lane = "canon"

    profile = LANE_PROFILES[lane]
    return {
        "lane": lane,
        "lane_label": profile["label"],
        "lane_description": profile["description"],
        "lane_weight": profile["weight"],
        "lane_order": profile["order"],
    }


def to_canon_films(items, watched):
    """MDBList items -> sorted CanonFilm[], deduped by tmdb id."""
    out, seen_ids = [], set()
    for m in items:
        tid = (m.get("ids") or {}).get("tmdb") or m.get("id")
        tid = int(tid) if tid else None
        if tid is not None and tid in seen_ids:
            continue
        if tid is not None:
            seen_ids.add(tid)
        yr = m.get("release_year")
        out.append({
            "title": m.get("title"),
            "year": int(yr) if (yr and str(yr).isdigit()) else 0,
            "tmdb_id": tid,
            "seen": tid in watched if tid is not None else False,
        })
    # chronological, undated last; stable by title
    out.sort(key=lambda f: (f["year"] if f["year"] else 9999, (f["title"] or "").lower()))
    return out


def to_collection_films(items, watched):
    """MDBList items -> sorted collection films, deduped by TMDB id."""
    out, seen_ids = [], set()
    for m in items:
        tid = (m.get("ids") or {}).get("tmdb") or m.get("id")
        tid = int(tid) if tid else None
        if tid is not None and tid in seen_ids:
            continue
        if tid is not None:
            seen_ids.add(tid)
        yr = m.get("release_year")
        out.append({
            "title": m.get("title"),
            "year": int(yr) if (yr and str(yr).isdigit()) else 0,
            "tmdb_id": tid,
            "imdb_id": (m.get("ids") or {}).get("imdb"),
            "poster": m.get("poster"),
            "overview": m.get("overview"),
            "seen": tid in watched if tid is not None else False,
        })
    out.sort(key=lambda f: (f["year"] if f["year"] else 9999, (f["title"] or "").lower()))
    return out


def remark_seen(films, watched):
    for f in films:
        if isinstance(f, dict) and "tmdb_id" in f:
            f["seen"] = bool(f.get("tmdb_id")) and f["tmdb_id"] in watched
    return films


def build(data_path):
    d = json.load(open(data_path, encoding="utf-8"))
    watched = set(d.get("watched_tmdb_set", []))
    canon = dict(d.get("canon") or {})
    meta = []

    # 1) keep built-in canons, re-marking seen
    for key, name in BUILTIN_ORDER:
        if isinstance(canon.get(key), list):
            remark_seen(canon[key], watched)
            meta.append({"key": key, "name": name})

    # 2) build/replace from MDBList
    for list_id, key, name in MDBLIST_LISTS:
        items = fetch_list_items(list_id)
        films = to_canon_films(items, watched)
        if not films:
            print(f"  ! {name}: 0 items, skipped")
            continue
        canon[key] = films
        if not any(m["key"] == key for m in meta):
            meta.append({"key": key, "name": name})
        s = sum(1 for f in films if f["seen"])
        print(f"  {name}: {len(films)} films, {s} seen ({100*s/len(films):.1f}%)")

    d["canon"] = canon
    d["canon_meta"] = meta

    collections, collections_meta = {}, []
    for l in fetch_user_lists():
        list_id = int(l.get("id") or 0)
        media_type = (l.get("mediatype") or "").lower()
        if not list_id or list_id in SKIP_LIST_IDS or media_type in SKIP_MEDIA_TYPES:
            continue

        name = l.get("name") or f"MDBList {list_id}"
        films = to_collection_films(fetch_list_items(list_id), watched)
        if not films:
            print(f"  ! collection {name}: 0 items, skipped")
            continue

        seen = sum(1 for f in films if f["seen"])
        key = collection_key(l)
        lane = classify_collection(l)
        collections[key] = films
        collections_meta.append({
            "key": key,
            "name": name,
            "description": l.get("description") or "",
            "mdblist_id": list_id,
            "slug": l.get("slug") or "",
            "private": bool(l.get("private")),
            "media_type": l.get("mediatype") or "movie",
            "total": len(films),
            "seen": seen,
            "unseen": len(films) - seen,
            **lane,
        })
        print(f"  collection {name}: {len(films)} films, {seen} seen ({100*seen/len(films):.1f}%)")

    collections_meta.sort(key=lambda m: (m["name"] or "").lower())
    d["collections"] = collections
    d["collections_meta"] = collections_meta
    json.dump(d, open(data_path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"\nWrote {data_path}")
    print(f"  canon categories: {len(meta)} -> {[m['key'] for m in meta]}")
    print(f"  collections: {len(collections_meta)} -> {[m['name'] for m in collections_meta]}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    build(args[0] if args else DEFAULT_DATA)
