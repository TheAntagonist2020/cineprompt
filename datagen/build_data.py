#!/usr/bin/env python3
"""build_data.py — rebuild Cineprompt's time-sensitive data from a Letterboxd
export, using TMDB for ids/metadata. Cloudflare-free (no Trakt API, no scraping).

It refreshes the *dynamic* sections (watched set, recent watches, stats, by_month,
blindspots, diary ratings/tags, review quotes, slates, todays_pick) and preserves
the *curated* sections from a base data.json (canon, screenplays, themed_weeks,
craft_dimensions, director_targets, moods_meta, queue/pools), updating their
`seen` flags against the fresh watched set.

Usage:
    python build_data.py <letterboxd_export_dir_or_zip> <base_data.json> <out.json>
"""
import csv
import io
import json
import os
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

from tmdb import TMDB

DECADES_FOR_DIST = True


# ---------------------------------------------------------------- CSV loading
def _read_csvs(src):
    """Return {name: [row dicts]} for the Letterboxd export CSVs."""
    out = {}
    wanted = ("diary", "ratings", "reviews", "watched", "watchlist")
    if src.lower().endswith(".zip"):
        with zipfile.ZipFile(src) as z:
            for info in z.namelist():
                base = os.path.splitext(os.path.basename(info))[0].lower()
                if base in wanted:
                    with z.open(info) as f:
                        text = io.TextIOWrapper(f, encoding="utf-8-sig")
                        out[base] = list(csv.DictReader(text))
    else:
        for name in wanted:
            p = os.path.join(src, f"{name}.csv")
            if os.path.exists(p):
                with open(p, encoding="utf-8-sig") as f:
                    out[name] = list(csv.DictReader(f))
    return out


def _col(row, *names):
    for n in names:
        if n in row and row[n] not in (None, ""):
            return row[n]
    # case-insensitive fallback
    low = {k.lower(): v for k, v in row.items()}
    for n in names:
        if n.lower() in low and low[n.lower()] not in (None, ""):
            return low[n.lower()]
    return None


def _stars_to_10(rating_str):
    """Letterboxd rating is 0.5-5.0 stars; Cineprompt distributions use 1-10."""
    try:
        return int(round(float(rating_str) * 2))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- main build
def build(export_src, base_path, out_path):
    csvs = _read_csvs(export_src)
    if not csvs.get("diary") and not csvs.get("watched"):
        sys.exit("No diary.csv/watched.csv found in the export. Check the path.")

    base = json.load(open(base_path, encoding="utf-8"))
    tmdb = TMDB()

    diary = csvs.get("diary", [])
    ratings = csvs.get("ratings", [])
    reviews = csvs.get("reviews", [])
    watched_rows = csvs.get("watched", []) or diary

    # --- resolve every distinct (title, year) to a tmdb id (+metadata) ---
    pairs = {}
    for rows in (watched_rows, diary, ratings, reviews):
        for r in rows:
            name = _col(r, "Name")
            year = _col(r, "Year")
            if name:
                pairs[(name, year)] = None
    print(f"Resolving {len(pairs)} distinct films via TMDB (cached)...")
    id_of = {}
    meta_of = {}
    done = 0
    for (name, year) in pairs:
        tid = tmdb.resolve_id(name, year)
        id_of[(name, year)] = tid
        if tid:
            meta_of[tid] = tmdb.movie(tid)
        done += 1
        if done % 200 == 0:
            print(f"  {done}/{len(pairs)}")
            tmdb.save()
    tmdb.save()

    def tid_for(row):
        return id_of.get((_col(row, "Name"), _col(row, "Year")))

    # --- watched set ---
    watched_ids = set()
    for r in watched_rows:
        t = tid_for(r)
        if t:
            watched_ids.add(t)
    for r in diary:
        t = tid_for(r)
        if t:
            watched_ids.add(t)

    # --- recent watches (from diary, by watched date desc) ---
    play_count = Counter()
    last_seen = {}
    title_year = {}
    for r in diary:
        t = tid_for(r)
        if not t:
            continue
        wd = _col(r, "Watched Date", "Date") or ""
        play_count[t] += 1
        if t not in last_seen or wd > last_seen[t]:
            last_seen[t] = wd
        title_year[t] = (_col(r, "Name"), _col(r, "Year"))
    recent = sorted(last_seen.items(), key=lambda kv: kv[1], reverse=True)[:50]
    recent_watches = []
    for t, wd in recent:
        nm, yr = title_year.get(t, (None, None))
        recent_watches.append({
            "title": nm,
            "year": int(yr) if (yr and str(yr).isdigit()) else 0,
            "tmdb": t,
            "last_watched": wd,
            "plays": play_count[t],
        })

    # --- stats ---
    total_minutes = sum((meta_of.get(t) or {}).get("runtime", 0) for t in watched_ids)
    rating_vals = [_stars_to_10(_col(r, "Rating")) for r in ratings]
    rating_vals = [v for v in rating_vals if v]
    dist = Counter(str(v) for v in rating_vals)
    today = datetime.now().date()
    week_ago = today - timedelta(days=7)

    def _wd_date(r):
        s = _col(r, "Watched Date", "Date") or ""
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        except ValueError:
            return None

    this_week = sum(1 for r in diary if (_wd_date(r) and _wd_date(r) >= week_ago))
    stats = {
        "total_watched": len(watched_ids),
        "total_minutes": total_minutes,
        "total_rated": len(rating_vals),
        "this_week": this_week,
        "ratings_distribution": {str(k): dist.get(str(k), 0) for k in range(1, 11)},
    }

    # --- by_month (diary, last 12 months) ---
    by_month = Counter()
    for r in diary:
        d = _wd_date(r)
        if d:
            by_month[d.strftime("%Y-%m")] += 1
    by_month = dict(sorted(by_month.items())[-12:])

    # --- blindspots ---
    by_decade = Counter()
    genres = Counter()
    languages = Counter()
    countries = Counter()
    runtime_min_by_decade = Counter()
    for t in watched_ids:
        m = meta_of.get(t) or {}
        yr = m.get("year")
        if yr and str(yr).isdigit():
            dec = (int(yr) // 10) * 10
            by_decade[str(dec)] += 1
            runtime_min_by_decade[str(dec)] += m.get("runtime", 0)
        for g in m.get("genres", []):
            genres[g] += 1
        if m.get("original_language"):
            languages[m["original_language"]] += 1
        for c in m.get("production_countries", []):
            countries[c] += 1
    total_dec = sum(by_decade.values()) or 1
    decade_pct = {k: round(100 * v / total_dec, 1) for k, v in by_decade.items()}
    under = sorted(by_decade.items(), key=lambda kv: kv[1])[:4]
    under_decades = [int(k) for k, _ in under]

    # loved directors: avg rating per director among rated films
    dir_ratings = defaultdict(list)
    rating_by_pair = {}
    for r in ratings:
        rv = _stars_to_10(_col(r, "Rating"))
        if rv:
            rating_by_pair[(_col(r, "Name"), _col(r, "Year"))] = rv / 2.0
    dir_seen = Counter()
    for t in watched_ids:
        m = meta_of.get(t) or {}
        for dname in m.get("directors", []):
            dir_seen[dname] += 1
        ny = title_year.get(t)
        if ny and ny in rating_by_pair:
            for dname in m.get("directors", []):
                dir_ratings[dname].append(rating_by_pair[ny])
    loved = []
    for dname, rs in dir_ratings.items():
        if len(rs) >= 3:
            loved.append({"name": dname, "avg_rating": round(sum(rs) / len(rs), 2), "seen": dir_seen[dname]})
    loved.sort(key=lambda x: (-x["avg_rating"], -x["seen"]))
    loved = loved[:20]

    blindspots = {
        "by_decade": dict(sorted(by_decade.items())),
        "decade_pct": dict(sorted(decade_pct.items())),
        "under_watched_decades": under_decades,
        "languages": dict(languages.most_common()),
        "genres": dict(genres.most_common()),
        "countries": dict(countries.most_common()),
        "loved_directors": loved,
        "director_seen_counts": dict(dir_seen.most_common(200)),
        "total_watched": len(watched_ids),
        "total_runtime_min": total_minutes,
        "ratings_distribution": stats["ratings_distribution"],
    }

    # --- diary ratings + tags + review quotes ---
    diary_ratings = {}
    for r in ratings:
        rv = _stars_to_10(_col(r, "Rating"))
        nm, yr = _col(r, "Name"), _col(r, "Year")
        if rv and nm:
            diary_ratings[f"{nm}|{yr}"] = round(rv / 2.0, 1)

    tag_counter = Counter()
    tag_films = defaultdict(list)
    for r in diary:
        tags = _col(r, "Tags") or ""
        for tag in [x.strip().lower() for x in tags.split(",") if x.strip()]:
            tag_counter[tag] += 1
            tag_films[tag].append({
                "title": _col(r, "Name"),
                "year": int(_col(r, "Year")) if (_col(r, "Year") or "").isdigit() else 0,
                "rating": (rating_by_pair.get((_col(r, "Name"), _col(r, "Year"))) or 0),
                "uri": _col(r, "Letterboxd URI"),
                "watched_date": _col(r, "Watched Date", "Date"),
            })
    tags_out = {}
    for tag, cnt in tag_counter.most_common(60):
        tags_out[tag] = {
            "count": cnt,
            "unique_films": len({(f["title"], f["year"]) for f in tag_films[tag]}),
            "films": tag_films[tag][:60],
            "related_tags": [],
            "category": "other",
        }

    review_quotes = {}
    for r in reviews:
        txt = (_col(r, "Review") or "").strip().replace("\n", " ")
        nm, yr = _col(r, "Name"), _col(r, "Year")
        if txt and nm:
            snippet = txt[:280] + ("..." if len(txt) > 280 else "")
            review_quotes[f"{nm}|{yr}"] = {
                "title": nm,
                "year": yr,
                "rating": rating_by_pair.get((nm, yr), 0),
                "snippet": snippet,
                "date": _col(r, "Watched Date", "Date"),
                "uri": _col(r, "Letterboxd URI"),
            }

    diary_meta = {
        "total_entries": len(diary),
        "criterion_channel_count": tag_counter.get("criterion channel", 0),
        "unique_titles": len({(_col(r, "Name"), _col(r, "Year")) for r in diary}),
        "by_year": dict(Counter((_wd_date(r).strftime("%Y") if _wd_date(r) else "?") for r in diary)),
        "by_rating": {str(k): v for k, v in sorted(dist.items())},
        "tag_categories": {"other": len(tags_out)},
        "total_tags": sum(tag_counter.values()),
    }

    # --- update `seen` flags in curated sections against fresh watched set ---
    def mark_seen(obj):
        if isinstance(obj, dict):
            if "tmdb_id" in obj and isinstance(obj.get("tmdb_id"), int) and "seen" in obj:
                obj["seen"] = obj["tmdb_id"] in watched_ids
            for v in obj.values():
                mark_seen(v)
        elif isinstance(obj, list):
            for v in obj:
                mark_seen(v)

    for key in ("canon", "collections", "screenplays", "themed_weeks", "directors", "director_targets", "craft_dimensions"):
        if key in base:
            mark_seen(base[key])

    # --- assemble: fresh dynamic data over the curated base ---
    d = dict(base)
    d["user"] = base.get("user", {})
    d["stats"] = stats
    d["blindspots"] = blindspots
    d["watched_tmdb_set"] = sorted(watched_ids)
    d["recent_watches"] = recent_watches
    d["by_month"] = by_month
    d["diary_ratings"] = diary_ratings
    d["tags"] = tags_out
    d["diary_meta"] = diary_meta
    d["review_quotes"] = review_quotes
    now_iso = datetime.now(timezone.utc).astimezone().isoformat()
    d["generated_at"] = now_iso
    d["last_sync"] = now_iso
    d["version"] = base.get("version", "v4.1")

    # --- slates: 14-day window from today, focus/background from existing pools
    #     (filtered against the fresh watched set) ---
    from refresh_slates import seeded_shuffle
    focus_pool, seen = [], set()
    for f in (base.get("queue", []) + base.get("focus_pool_extra", [])):
        ftid = f.get("tmdb_id")
        if ftid in seen or ftid in watched_ids:
            continue
        seen.add(ftid)
        focus_pool.append(f)
    bg_pool = [b for b in base.get("background_pool", [])]
    if focus_pool and bg_pool:
        seed = today.toordinal()
        fr = seeded_shuffle(focus_pool, seed)
        br = seeded_shuffle(bg_pool, seed + 7)
        slates = []
        for n in range(14):
            day = today + timedelta(days=n)
            slates.append({
                "date": day.isoformat(),
                "weekday": day.strftime("%A"),
                "focus": [fr[(n * 3 + k) % len(fr)] for k in range(3)],
                "background": [br[(n * 2 + k) % len(br)] for k in range(2)],
            })
        d["slates"] = slates
        d["todays_pick"] = slates[0]["focus"][0]

    json.dump(d, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
    print("\nWrote", out_path)
    print(f"  watched: {len(watched_ids)} | rated: {stats['total_rated']} | "
          f"this_week: {stats['this_week']} | recent: {len(recent_watches)}")
    print(f"  newest watch: {recent_watches[0]['title']} ({recent_watches[0]['last_watched']})"
          if recent_watches else "  (no diary entries)")
    print(f"  tags: {len(tags_out)} | review_quotes: {len(review_quotes)}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit("Usage: python build_data.py <export_dir_or_zip> <base_data.json> <out.json>")
    build(sys.argv[1], sys.argv[2], sys.argv[3])
