"""Publish the picks as a Stremio addon: static JSON on a public URL.

A Stremio addon is nothing more than a manifest plus one JSON file per
catalog. Stremio renders each catalog as a row of posters and can play
anything whose id is an IMDb id, which every pick here has. Install once and
it follows the Stremio account onto the Shield, the phone, everywhere.

Rows:
  Tonight     the same three films as the phone nudge (plus the day's wildcard)
  Queue       the full ranked queue
  Deep cuts   the road-not-taken lane, when the payload has it
  Background  films to have on while doing something else

Only titles, posters, blurbs and the "why" reasons are published. Notes,
shortlist and the site itself stay behind Access on the main hostname.

Usage:  python datagen/stremio_addon.py client/public/data.json addon-dist
Env:    ADDON_BASE_URL  public URL the addon is served from
                        (default https://cineprompt-addon.pages.dev)
        NUDGE_TODAY / NUDGE_TZ  same meaning as in nudge.py (Tonight row)
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nudge  # noqa: E402  (shares the pick logic so Tonight matches the phone)

TMDB = "https://image.tmdb.org/t/p"
IMDB_RE = re.compile(r"tt\d{5,9}")
BASE_URL = (os.environ.get("ADDON_BASE_URL") or "https://cineprompt-addon.pages.dev").rstrip("/")
ADDON_ID = "org.cineprompt.picks"
ICON_SRC = Path(__file__).resolve().parent.parent / "client" / "public" / "icon-512.png"


def meta(film):
    """One Stremio meta preview, or None if the film has no usable IMDb id."""
    imdb = str(film.get("imdb_id") or "")
    if not IMDB_RE.fullmatch(imdb):
        return None
    m = {"id": imdb, "type": "movie", "name": film.get("title") or imdb, "posterShape": "poster"}

    poster, backdrop = film.get("poster"), film.get("backdrop")
    if isinstance(poster, str) and poster.startswith("/"):
        m["poster"] = f"{TMDB}/w342{poster}"
    if isinstance(backdrop, str) and backdrop.startswith("/"):
        m["background"] = f"{TMDB}/w1280{backdrop}"

    reasons = [nudge.tidy(r) for r in (film.get("reasons") or []) if r][:3]
    desc = (film.get("overview") or "").strip()
    if reasons:
        desc = (desc + "\n\n" if desc else "") + "Why: " + " · ".join(reasons)
    if desc:
        m["description"] = desc

    year = str(film.get("year") or "").strip()
    if year:
        m["releaseInfo"] = year
    rating = film.get("vote_average")
    if isinstance(rating, (int, float)) and rating > 0:
        m["imdbRating"] = f"{rating:.1f}"
    genres = [g for g in (film.get("genres") or []) if g]
    if genres:
        m["genres"] = genres
    directors = [d for d in (film.get("directors") or []) if d]
    if directors:
        m["director"] = directors
    runtime = nudge.minutes(film)
    if runtime:
        m["runtime"] = f"{runtime} min"
    return m


def tonight(data):
    pool = nudge.candidate_pool(data)
    picks = nudge.pick_films(pool, nudge.local_today(), "evening") if pool else []
    wildcard = data.get("wildcard")
    if isinstance(wildcard, dict) and wildcard not in picks:
        picks = picks + [wildcard]
    return picks


def build(data, out):
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    (out / "catalog" / "movie").mkdir(parents=True)

    lanes = [
        ("cineprompt-tonight", "Cineprompt — Tonight", tonight(data)),
        ("cineprompt-queue", "Cineprompt — Queue", data.get("queue") or []),
        ("cineprompt-deepcuts", "Cineprompt — Deep cuts", data.get("deep_cuts") or []),
        ("cineprompt-background", "Cineprompt — Background", data.get("background_pool") or []),
    ]
    catalogs, report = [], []
    for cid, name, films in lanes:
        metas, seen = [], set()
        for film in films:
            m = meta(film) if isinstance(film, dict) else None
            if m and m["id"] not in seen:
                seen.add(m["id"])
                metas.append(m)
        if not metas:
            report.append(f"  {name:26} (empty, omitted)")
            continue
        (out / "catalog" / "movie" / f"{cid}.json").write_text(
            json.dumps({"metas": metas}, ensure_ascii=False), encoding="utf-8"
        )
        catalogs.append({"type": "movie", "id": cid, "name": name})
        report.append(f"  {name:26} {len(metas):3} films")

    day = nudge.local_today()
    manifest = {
        "id": ADDON_ID,
        "version": f"1.{day:%Y%m%d}.0",
        "name": "Cineprompt",
        "description": "Tonight's picks, the queue and the deep cuts from Cineprompt, "
                       "rebuilt from your Trakt and Letterboxd history twice a day.",
        "logo": f"{BASE_URL}/icon-512.png",
        "resources": ["catalog"],
        "types": ["movie"],
        "idPrefixes": ["tt"],
        "catalogs": catalogs,
        "behaviorHints": {"configurable": False, "configurationRequired": False},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # Stremio's web client reads the addon cross-origin; the apps don't care.
    (out / "_headers").write_text(
        "/*\n  Access-Control-Allow-Origin: *\n  Access-Control-Allow-Headers: *\n"
        "  Cache-Control: public, max-age=300\n",
        encoding="utf-8",
    )
    if ICON_SRC.exists():
        shutil.copy(ICON_SRC, out / "icon-512.png")

    host = BASE_URL.split("://", 1)[-1]
    rows = "".join(f"<li>{c['name']}</li>" for c in catalogs)
    (out / "index.html").write_text(f"""<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cineprompt for Stremio</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1.25rem;color:#e8e8e8;background:#111}}
a.btn{{display:inline-block;padding:.8rem 1.2rem;background:#7b5cff;color:#fff;border-radius:.6rem;text-decoration:none;font-weight:600}}
code{{background:#222;padding:.15rem .4rem;border-radius:.3rem}}</style>
<h1>Cineprompt for Stremio</h1>
<p>Your picks as rows inside Stremio. Installs to your Stremio account, so it shows up on the Shield too.</p>
<p><a class="btn" href="stremio://{host}/manifest.json">Install in Stremio</a></p>
<p>On a TV: in Stremio open <b>Addons</b>, paste <code>{BASE_URL}/manifest.json</code> into the search box, install.</p>
<ul>{rows}</ul>
<p>Updated {day:%A %d %B %Y}.</p>
""", encoding="utf-8")

    print(f"Stremio addon written to {out}/ (base {BASE_URL})")
    print("\n".join(report))
    return manifest


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "client/public/data.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "addon-dist"
    with open(src, encoding="utf-8") as fh:
        data = json.load(fh)
    build(data, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
