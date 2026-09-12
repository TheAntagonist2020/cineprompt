#!/usr/bin/env python3
"""letterboxd_profile.py — Letterboxd as the source of truth for what you've
seen and what you rated, with no login and no scraping.

Why this exists: the recommendation engine used to take its "seen" set from
Trakt alone, and Trakt only knows what got scrobbled. Roughly half of recent
watches (everything on the Criterion Channel, for a start) never reach it, so
the engine kept recommending films already watched — and it scored taste on
Trakt ratings rather than the Letterboxd ones that actually get written.

Letterboxd's site sits behind a bot challenge, so paging through the public
films grid from CI is not something to build on. What *is* reliable, and needs
no key: the public RSS diary feed (50 newest entries, TMDB id included), the
data already sitting in data.json (4,000+ rated titles from the original
export), and an export ZIP whenever you feel like downloading one.

This module keeps an accumulated profile in `datagen/.letterboxd_profile.json`
(persisted across CI runs like the TMDB cache):

    films  "Title|Year" -> {tmdb_id, rating (0.5-5), last_watched, plays, uri}
    diary  "date|Title|Year" -> {date, title, year, tmdb_id, rating, rewatch}

Every run: bootstrap from data.json (once), fold in the RSS feed (always), fold
in an export ZIP if one is given, then resolve any title still lacking a TMDB id
through the cached TMDB search. Nothing is ever forgotten, so the RSS window
becomes a complete diary going forward.

Usage:
    python letterboxd_profile.py [data.json] [--export path.zip|dir]
                                 [--user handle] [--no-rss] [--no-resolve]

Env: LETTERBOXD_USER (or --user, or data.json user.letterboxd)
     LETTERBOXD_EXPORT (path to the export ZIP/dir; same as --export)
     TMDB_API_KEY (only needed to resolve titles to TMDB ids)
"""
import csv
import io
import json
import os
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(HERE, ".letterboxd_profile.json")
DEFAULT_DATA = os.path.join(HERE, "..", "client", "public", "data.json")
VERSION = 1
# a title that failed to resolve is retried after this many days, not every run
RESOLVE_RETRY_DAYS = 30


# ---------------------------------------------------------------- keys -----
def year_str(year):
    """'2006' for 2006 / '2006' / 2006.0; '' for 0 / None / junk."""
    if year is None:
        return ""
    s = str(year).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s if s.isdigit() and int(s) > 0 else ""


def film_key(title, year):
    return f"{(title or '').strip()}|{year_str(year)}"


def split_key(key):
    title, _, year = key.rpartition("|")
    return title, year


def _now():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- store ----
def empty_profile():
    return {"version": VERSION, "films": {}, "diary": {}, "bootstrapped": False,
            "updated_at": None}


def load(path=CACHE_PATH):
    if os.path.exists(path):
        try:
            p = json.load(open(path, encoding="utf-8"))
            if isinstance(p, dict) and p.get("version") == VERSION:
                p.setdefault("films", {})
                p.setdefault("diary", {})
                return p
        except Exception:
            pass
    return empty_profile()


def save(profile, path=CACHE_PATH):
    profile["updated_at"] = _now()
    tmp = path + ".tmp"
    json.dump(profile, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, path)


def _film(profile, title, year):
    key = film_key(title, year)
    f = profile["films"].get(key)
    if f is None:
        f = {"title": (title or "").strip(), "year": year_str(year), "tmdb_id": None,
             "rating": None, "last_watched": None, "plays": 0, "uri": None}
        profile["films"][key] = f
    return f


def _touch(f, *, tmdb_id=None, rating=None, watched=None, uri=None, plays=None):
    """Merge one observation into a film record. Newer dates win; a rating
    always overwrites (the latest rating is the current opinion)."""
    if tmdb_id and not f.get("tmdb_id"):
        f["tmdb_id"] = int(tmdb_id)
        f.pop("resolve_tried", None)
    if rating is not None:
        try:
            r = float(rating)
            if 0 < r <= 5:
                f["rating"] = r
        except (TypeError, ValueError):
            pass
    if watched and (not f.get("last_watched") or watched > f["last_watched"]):
        f["last_watched"] = watched[:10]
    if uri and not f.get("uri"):
        f["uri"] = uri
    if plays:
        f["plays"] = max(int(f.get("plays") or 0), int(plays))


def _diary(profile, date, title, year, *, tmdb_id=None, rating=None, rewatch=False):
    if not date:
        return
    key = f"{date[:10]}|{film_key(title, year)}"
    e = profile["diary"].get(key)
    if e is None:
        e = {"date": date[:10], "title": (title or "").strip(), "year": year_str(year),
             "tmdb_id": None, "rating": None, "rewatch": bool(rewatch)}
        profile["diary"][key] = e
    if tmdb_id and not e.get("tmdb_id"):
        e["tmdb_id"] = int(tmdb_id)
    if rating is not None and e.get("rating") is None:
        try:
            e["rating"] = float(rating)
        except (TypeError, ValueError):
            pass
    if rewatch:
        e["rewatch"] = True


# ---------------------------------------------------------------- sources --
MIRROR_KEY = "letterboxd_profile"


def mirror_to_data(profile, data):
    """Write a compact copy of the profile into data.json. The profile cache
    and data.json ride in two different Actions caches, and data.json is also
    what a manual `git commit` of the snapshot carries — so an eviction of one
    never loses the diary. Kept out of the shipped shards (see
    script/data-shards.ts DEAD_KEYS)."""
    films = [[f["title"], f["year"], f.get("tmdb_id"), f.get("rating"), f.get("last_watched"),
              f.get("plays") or 0] for f in profile["films"].values() if f.get("title")]
    diary = [[e["date"], e["title"], e["year"], e.get("tmdb_id"), e.get("rating"),
              1 if e.get("rewatch") else 0] for e in profile["diary"].values()]
    data[MIRROR_KEY] = {"version": VERSION, "films": films, "diary": diary,
                        "updated_at": _now()}


def bootstrap_from_mirror(profile, data):
    m = data.get(MIRROR_KEY) or {}
    if not isinstance(m, dict) or m.get("version") != VERSION:
        return 0
    n = 0
    for title, year, tmdb_id, rating, last_watched, plays in m.get("films") or []:
        f = _film(profile, title, year)
        _touch(f, tmdb_id=tmdb_id, rating=rating, watched=last_watched, plays=plays)
        n += 1
    for date, title, year, tmdb_id, rating, rewatch in m.get("diary") or []:
        _diary(profile, date, title, year, tmdb_id=tmdb_id, rating=rating, rewatch=bool(rewatch))
    return n


def bootstrap_from_data(profile, data):
    """Seed the profile from whatever the current data.json already knows:
    a mirrored copy of a previous profile if one is there, else the
    export-derived diary ratings and review quotes, the tag explorer's dated
    films, and the recent-watches list (which carries TMDB ids)."""
    before = len(profile["films"])
    bootstrap_from_mirror(profile, data)
    for key, rating in (data.get("diary_ratings") or {}).items():
        title, year = split_key(key)
        if title:
            _touch(_film(profile, title, year), rating=rating)
    for key, q in (data.get("review_quotes") or {}).items():
        title, year = split_key(key)
        if not title:
            continue
        f = _film(profile, q.get("title") or title, q.get("year") or year)
        _touch(f, rating=q.get("rating") or None, watched=q.get("date"), uri=q.get("uri"))
        _diary(profile, q.get("date"), f["title"], f["year"], rating=q.get("rating") or None)
    for tag, entry in (data.get("tags") or {}).items():
        for tf in entry.get("films") or []:
            if not tf.get("title"):
                continue
            f = _film(profile, tf["title"], tf.get("year"))
            _touch(f, rating=tf.get("rating") or None, watched=tf.get("watched_date"),
                   uri=tf.get("uri"))
            _diary(profile, tf.get("watched_date"), f["title"], f["year"],
                   rating=tf.get("rating") or None)
    for w in data.get("recent_watches") or []:
        if not w.get("title"):
            continue
        f = _film(profile, w["title"], w.get("year"))
        _touch(f, tmdb_id=w.get("tmdb"), watched=w.get("last_watched"), plays=w.get("plays"))
        _diary(profile, w.get("last_watched"), f["title"], f["year"], tmdb_id=w.get("tmdb"))
    profile["bootstrapped"] = True
    return len(profile["films"]) - before


def _read_export(src):
    wanted = ("diary", "ratings", "watched", "reviews")
    out = {}
    if src.lower().endswith(".zip"):
        with zipfile.ZipFile(src) as z:
            for info in z.namelist():
                base = os.path.splitext(os.path.basename(info))[0].lower()
                if base in wanted:
                    with z.open(info) as fh:
                        out[base] = list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))
    else:
        for name in wanted:
            p = os.path.join(src, f"{name}.csv")
            if os.path.exists(p):
                with open(p, encoding="utf-8-sig") as fh:
                    out[name] = list(csv.DictReader(fh))
    return out


def _col(row, *names):
    low = {(k or "").lower(): v for k, v in row.items()}
    for n in names:
        v = low.get(n.lower())
        if v not in (None, ""):
            return v
    return None


def ingest_export(profile, src):
    """Fold a Letterboxd export (ZIP or unzipped folder) into the profile.
    This is the only way to get the *complete* history in one go; it's manual
    (Letterboxd → Settings → Import & Export → Export your data)."""
    csvs = _read_export(src)
    if not csvs:
        raise SystemExit(f"No Letterboxd CSVs found at {src}")
    n = 0
    for r in csvs.get("watched", []):
        name, year = _col(r, "Name"), _col(r, "Year")
        if name:
            _touch(_film(profile, name, year), uri=_col(r, "Letterboxd URI"),
                   watched=_col(r, "Date"))
            n += 1
    for r in csvs.get("ratings", []):
        name, year = _col(r, "Name"), _col(r, "Year")
        if name:
            _touch(_film(profile, name, year), rating=_col(r, "Rating"),
                   uri=_col(r, "Letterboxd URI"))
            n += 1
    for r in csvs.get("diary", []):
        name, year = _col(r, "Name"), _col(r, "Year")
        if not name:
            continue
        wd = _col(r, "Watched Date", "Date")
        rewatch = (_col(r, "Rewatch") or "").strip().lower() == "yes"
        f = _film(profile, name, year)
        _touch(f, rating=_col(r, "Rating"), watched=wd, uri=_col(r, "Letterboxd URI"))
        f["plays"] = max(int(f.get("plays") or 0), 1)
        _diary(profile, wd, name, year, rating=_col(r, "Rating"), rewatch=rewatch)
        n += 1
    return n


def ingest_rss(profile, entries):
    """Fold parsed RSS diary entries (see letterboxd_rss.parse_entries) in."""
    n = 0
    for e in entries:
        if not e.get("title"):
            continue
        f = _film(profile, e["title"], e.get("year"))
        _touch(f, tmdb_id=e.get("tmdb_id"), rating=e.get("rating"),
               watched=e.get("watched_date"), uri=e.get("uri"), plays=2 if e.get("rewatch") else 1)
        _diary(profile, e.get("watched_date"), e["title"], e.get("year"),
               tmdb_id=e.get("tmdb_id"), rating=e.get("rating"), rewatch=e.get("rewatch"))
        n += 1
    return n


# ---------------------------------------------------------------- resolve --
def resolve(profile, tmdb, limit=None):
    """Give every film a TMDB id via the cached TMDB search. Titles that fail
    are marked and retried a month later rather than on every run."""
    # ids known from the diary (RSS entries carry them) flow to the film first
    for e in profile["diary"].values():
        if e.get("tmdb_id"):
            f = profile["films"].get(film_key(e["title"], e["year"]))
            if f is not None and not f.get("tmdb_id"):
                f["tmdb_id"] = e["tmdb_id"]
    today = datetime.now(timezone.utc)
    todo = []
    for key, f in profile["films"].items():
        if f.get("tmdb_id") or not f.get("title"):
            continue
        tried = f.get("resolve_tried")
        if tried:
            try:
                age = (today - datetime.fromisoformat(tried)).days
                if age < RESOLVE_RETRY_DAYS:
                    continue
            except ValueError:
                pass
        todo.append(key)
    if limit:
        todo = todo[:limit]
    hits = 0
    for i, key in enumerate(todo, 1):
        f = profile["films"][key]
        tid = tmdb.resolve_id(f["title"], f["year"] or None)
        if tid:
            f["tmdb_id"] = int(tid)
            f.pop("resolve_tried", None)
            hits += 1
        else:
            f["resolve_tried"] = today.isoformat()
        if i % 200 == 0:
            print(f"  resolved {i}/{len(todo)}")
            tmdb.save()
    tmdb.save()
    # propagate ids into diary entries that lack one
    by_key = {k: f["tmdb_id"] for k, f in profile["films"].items() if f.get("tmdb_id")}
    for e in profile["diary"].values():
        if not e.get("tmdb_id"):
            tid = by_key.get(film_key(e["title"], e["year"]))
            if tid:
                e["tmdb_id"] = tid
    return len(todo), hits


# ---------------------------------------------------------------- views ----
def watched_ids(profile):
    return {f["tmdb_id"] for f in profile["films"].values() if f.get("tmdb_id")}


def rating_of(profile):
    """tmdb_id -> rating on Trakt's 1-10 scale (Letterboxd stars x 2)."""
    out = {}
    for f in profile["films"].values():
        if f.get("tmdb_id") and f.get("rating"):
            out[f["tmdb_id"]] = int(round(float(f["rating"]) * 2))
    return out


def last_of(profile):
    return {f["tmdb_id"]: f["last_watched"] for f in profile["films"].values()
            if f.get("tmdb_id") and f.get("last_watched")}


def play_of(profile):
    return {f["tmdb_id"]: max(1, int(f.get("plays") or 1)) for f in profile["films"].values()
            if f.get("tmdb_id")}


def ty_of(profile):
    return {f["tmdb_id"]: (f["title"], int(f["year"]) if f.get("year") else None)
            for f in profile["films"].values() if f.get("tmdb_id")}


def history(profile):
    """Dated watches, newest first, in the shape build_recommendations expects
    from Trakt's /history: [{movie: {title, year, ids: {tmdb}}, watched_at}]."""
    rows = []
    for e in profile["diary"].values():
        if not e.get("tmdb_id") or not e.get("date"):
            continue
        rows.append({
            "watched_at": e["date"] + "T20:00:00.000Z",
            "movie": {"title": e["title"], "year": int(e["year"]) if e.get("year") else None,
                      "ids": {"tmdb": e["tmdb_id"]}},
        })
    rows.sort(key=lambda r: r["watched_at"], reverse=True)
    return rows


def summary(profile):
    films = profile["films"]
    with_id = sum(1 for f in films.values() if f.get("tmdb_id"))
    rated = sum(1 for f in films.values() if f.get("rating"))
    dated = [e["date"] for e in profile["diary"].values()]
    months = Counter(d[:7] for d in dated)
    newest = max(dated) if dated else None
    return {"films": len(films), "with_tmdb_id": with_id, "rated": rated,
            "diary_entries": len(dated), "newest": newest,
            "best_month": months.most_common(1)[0] if months else None}


# ---------------------------------------------------------------- main -----
def main():
    args = list(sys.argv[1:])

    def take(flag, default=None):
        if flag in args:
            i = args.index(flag)
            v = args[i + 1]
            del args[i:i + 2]
            return v
        return default

    export = take("--export", os.environ.get("LETTERBOXD_EXPORT") or None)
    user = take("--user")
    no_rss = "--no-rss" in args
    no_resolve = "--no-resolve" in args
    args = [a for a in args if not a.startswith("--")]
    data_path = args[0] if args else DEFAULT_DATA

    data = json.load(open(data_path, encoding="utf-8")) if os.path.exists(data_path) else {}
    profile = load()

    if not profile.get("bootstrapped") and data:
        added = bootstrap_from_data(profile, data)
        print(f"bootstrapped {added} films from {os.path.relpath(data_path)}")

    if export:
        n = ingest_export(profile, export)
        print(f"export: folded {n} rows from {export}")

    if not no_rss:
        from letterboxd_rss import fetch_feed, parse_entries
        env_user = user or os.environ.get("LETTERBOXD_USER") or (data.get("user") or {}).get("letterboxd")
        if not env_user:
            print("rss: no Letterboxd handle (LETTERBOXD_USER / --user / data.user.letterboxd) — skipped")
        else:
            try:
                entries = parse_entries(fetch_feed(env_user))
                print(f"rss: {ingest_rss(profile, entries)} diary entries folded in "
                      f"(newest {entries[0]['title']} on {entries[0]['watched_date']})"
                      if entries else "rss: feed had no diary entries")
            except Exception as e:  # a feed hiccup must never lose the profile
                print(f"rss: failed ({type(e).__name__}: {e}) — continuing with what we have")

    if not no_resolve:
        try:
            from tmdb import TMDB
            tmdb = TMDB()
        except SystemExit as e:
            print(f"resolve: skipped ({e})")
        else:
            todo, hits = resolve(profile, tmdb)
            print(f"resolve: {hits}/{todo} titles matched to TMDB ids")

    save(profile)
    if data and os.path.exists(data_path):
        mirror_to_data(profile, data)
        json.dump(data, open(data_path, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"mirrored the profile into {os.path.relpath(data_path)}")
    s = summary(profile)
    print(f"profile: {s['films']} films ({s['with_tmdb_id']} with TMDB id, {s['rated']} rated), "
          f"{s['diary_entries']} diary entries, newest {s['newest']}, "
          f"best month {s['best_month']}")
    print(f"wrote {os.path.relpath(CACHE_PATH)}")


if __name__ == "__main__":
    main()
