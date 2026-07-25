#!/usr/bin/env python3
"""letterboxd_rss.py — fold your recent Letterboxd diary into data.json.

Why this exists: Trakt only knows what gets scrobbled to it, and several
services — Criterion Channel above all — have no scrobbler at all (neither
Trakt's own Streaming Scrobbler nor the Universal Trakt Scrobbler extension
support it). But you log those watches to Letterboxd by hand, and Letterboxd
publishes a public RSS diary feed that needs no API key and carries a real
TMDB id per entry. So anything you log anywhere lands here.

The feed is the ~50 most recent entries, so this is a *supplement*: it adds
watches Trakt missed and refreshes ratings/reviews. Full history still comes
from the Letterboxd ZIP export via build_data.py — and note the RSS carries
no tags, so diary tag counts (including "criterion channel") still need that
export.

Usage:
    python letterboxd_rss.py <in.json> <out.json> [--user handle]

The handle comes from --user, then LETTERBOXD_USER (env or datagen/.env),
then whatever is in the file's user.letterboxd.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Letterboxd serves 403 to obvious bots; identify as a normal browser.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
NS = {
    "letterboxd": "https://letterboxd.com",
    "tmdb": "https://themoviedb.org",
    "dc": "http://purl.org/dc/elements/1.1/",
}
RECENT_WATCHES_CAP = 40
SNIPPET_CHARS = 280


def _env_file():
    env = {}
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def fetch_feed(user: str) -> str:
    url = f"https://letterboxd.com/{user}/rss/"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def _text(item, path):
    el = item.find(path, NS)
    return el.text.strip() if el is not None and el.text else ""


def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]*>", " ", s or "")
    s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'")
    s = s.replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\s+", " ", s).strip()


def parse_entries(xml: str) -> list:
    """Diary entries only — the feed also carries list/story items, which have
    no watchedDate and are skipped."""
    root = ElementTree.fromstring(xml)
    out = []
    for item in root.iter("item"):
        watched = _text(item, "letterboxd:watchedDate")
        title = _text(item, "letterboxd:filmTitle")
        if not watched or not title:
            continue
        tmdb_raw = _text(item, "tmdb:movieId")
        year_raw = _text(item, "letterboxd:filmYear")
        rating_raw = _text(item, "letterboxd:memberRating")
        # The description is the review body (plus a poster <img>); an entry
        # with no review still carries the poster markup, hence strip first.
        review = strip_html(_text(item, "description"))
        review = re.sub(r"^Watched on \S+ \S+ \d{4}\.?\s*", "", review)
        out.append({
            "tmdb_id": int(tmdb_raw) if tmdb_raw.isdigit() else None,
            "title": title,
            "year": int(year_raw) if year_raw.isdigit() else 0,
            "rating": float(rating_raw) if rating_raw else None,  # 0.5-5.0
            "watched_date": watched,  # YYYY-MM-DD
            "rewatch": _text(item, "letterboxd:rewatch").lower() == "yes",
            "review": review,
            "uri": _text(item, "link"),
        })
    return out


def merge(data: dict, entries: list) -> dict:
    """Overlay RSS entries onto a data.json dict. Idempotent."""
    d = dict(data)
    with_ids = [e for e in entries if e["tmdb_id"]]

    # --- watched set: union (RSS only ever adds) ---
    watched = set(d.get("watched_tmdb_set") or [])
    before = len(watched)
    watched |= {e["tmdb_id"] for e in with_ids}
    d["watched_tmdb_set"] = sorted(watched)
    added = len(watched) - before

    # --- recent watches: merge, newest first, one row per film ---
    by_tmdb = {}
    for w in d.get("recent_watches") or []:
        if w.get("tmdb"):
            by_tmdb[w["tmdb"]] = dict(w)
    for e in with_ids:
        cur = by_tmdb.get(e["tmdb_id"])
        if cur is None:
            by_tmdb[e["tmdb_id"]] = {
                "title": e["title"], "year": e["year"], "tmdb": e["tmdb_id"],
                "last_watched": e["watched_date"], "plays": 2 if e["rewatch"] else 1,
            }
        elif e["watched_date"] > (cur.get("last_watched") or ""):
            cur["last_watched"] = e["watched_date"]
            cur["title"] = e["title"] or cur.get("title")
    d["recent_watches"] = sorted(
        by_tmdb.values(), key=lambda w: w.get("last_watched") or "", reverse=True
    )[:RECENT_WATCHES_CAP]

    # --- diary ratings + review quotes, keyed "Title|Year" like the export ---
    ratings = dict(d.get("diary_ratings") or {})
    quotes = dict(d.get("review_quotes") or {})
    new_reviews = 0
    for e in entries:
        key = f"{e['title']}|{e['year']}"
        if e["rating"] is not None:
            ratings[key] = e["rating"]
        if e["review"]:
            snippet = e["review"][:SNIPPET_CHARS]
            if len(e["review"]) > SNIPPET_CHARS:
                snippet += "..."
            if key not in quotes:
                new_reviews += 1
            quotes[key] = {
                "title": e["title"], "year": str(e["year"]),
                "rating": e["rating"] or 0, "snippet": snippet,
                "date": e["watched_date"], "uri": e["uri"],
            }
    d["diary_ratings"] = ratings
    d["review_quotes"] = quotes

    # --- stop recommending what you've now watched ---------------------
    # The unseen pools were picked before these watches were known. Prune them
    # (the background pool and `rewatch` mood picks are *meant* to be films you
    # have seen, so they are deliberately left alone). Today's focus row
    # backfills from the queue, so a thinned slate refills itself.
    pruned = 0

    def unseen(films):
        nonlocal pruned
        out = [f for f in films if f.get("tmdb_id") not in watched]
        pruned += len(films) - len(out)
        return out

    for key in ("queue", "focus_pool_extra"):
        if key in d:
            d[key] = unseen(d[key])
    if d.get("slates"):
        d["slates"] = [{**s, "focus": unseen(s.get("focus", []))} for s in d["slates"]]
    if d.get("todays_pick") and d["todays_pick"].get("tmdb_id") in watched:
        pool = d.get("queue") or d.get("focus_pool_extra") or []
        if pool:
            d["todays_pick"] = pool[0]
            pruned += 1
    if d.get("mood_picks"):
        d["mood_picks"] = {
            mood: [f for f in picks
                   if f.get("kind") == "rewatch" or f.get("tmdb_id") not in watched]
            for mood, picks in d["mood_picks"].items()
        }

    # --- refresh `seen` flags in the curated sections ---
    def mark_seen(o):
        if isinstance(o, dict):
            if isinstance(o.get("tmdb_id"), int) and "seen" in o:
                o["seen"] = o["tmdb_id"] in watched
            for v in o.values():
                mark_seen(v)
        elif isinstance(o, list):
            for v in o:
                mark_seen(v)
    for k in ("canon", "collections", "screenplays", "themed_weeks",
              "directors", "director_targets", "craft_dimensions"):
        if k in d:
            mark_seen(d[k])

    # --- stats: total from the union; this_week counts RSS-dated watches too,
    # so a Criterion night that never reached Trakt still shows up ---
    stats = dict(d.get("stats") or {})
    stats["total_watched"] = len(watched)
    week_ago = (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()
    recent_week = {w["tmdb"] for w in d["recent_watches"]
                   if (w.get("last_watched") or "") >= week_ago and w.get("tmdb")}
    stats["this_week"] = max(int(stats.get("this_week") or 0), len(recent_week))
    d["stats"] = stats

    blind = dict(d.get("blindspots") or {})
    if blind:
        blind["total_watched"] = len(watched)
        d["blindspots"] = blind

    meta = dict(d.get("diary_meta") or {})
    meta["rss_entries"] = len(entries)
    meta["rss_synced_at"] = datetime.now(timezone.utc).isoformat()
    d["diary_meta"] = meta

    d["_rss_summary"] = {"entries": len(entries), "newly_watched": added,
                         "new_reviews": new_reviews, "pruned": pruned}
    return d


def main():
    args = [a for a in sys.argv[1:]]
    user = None
    if "--user" in args:
        i = args.index("--user")
        user = args[i + 1]
        del args[i:i + 2]
    if len(args) < 2:
        sys.exit(__doc__)
    in_path, out_path = args[0], args[1]

    data = json.load(open(in_path, encoding="utf-8"))
    env = _env_file()
    user = (user or env.get("LETTERBOXD_USER") or os.environ.get("LETTERBOXD_USER")
            or (data.get("user") or {}).get("letterboxd"))
    if not user:
        sys.exit("No Letterboxd handle: pass --user, set LETTERBOXD_USER, or "
                 "set user.letterboxd in the data file.")

    print(f"Fetching letterboxd.com/{user}/rss/ ...")
    try:
        xml = fetch_feed(user)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            sys.exit(f"Letterboxd returned 404 for '{user}' — wrong handle? "
                     f"Check the username in your profile URL.")
        sys.exit(f"Letterboxd RSS failed: HTTP {e.code}")
    except Exception as e:  # network hiccup shouldn't be a hard CI failure
        sys.exit(f"Letterboxd RSS failed: {e}")

    entries = parse_entries(xml)
    if not entries:
        sys.exit("Feed had no diary entries — nothing to merge.")

    merged = merge(data, entries)
    summary = merged.pop("_rss_summary")
    json.dump(merged, open(out_path, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    newest = entries[0]
    print(f"  {summary['entries']} diary entries; "
          f"+{summary['newly_watched']} newly watched, "
          f"+{summary['new_reviews']} new reviews, "
          f"-{summary['pruned']} stale picks pruned")
    print(f"  newest: {newest['title']} ({newest['year']}) "
          f"on {newest['watched_date']}")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
