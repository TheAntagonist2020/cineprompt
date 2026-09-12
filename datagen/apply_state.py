#!/usr/bin/env python3
"""apply_state.py — make the pipeline honour what you decided in the app.

The app keeps your choices (shortlist / not tonight / watched / dismissed) in
Cloudflare D1, and until now nothing downstream ever read them: the phone
nudge, the Stremio row and the slates were all built from data.json alone,
so a film you dismissed on Tuesday came back on Wednesday's push. Steady and
consistent means one set of decisions everywhere.

Input is the JSON that `wrangler d1 execute --remote --json` prints for a
SELECT over film_state (see the workflow), or a plain list of rows.

What it does to data.json:
  * watched  -> added to watched_tmdb_set, pruned from every unseen pool
  * dismissed -> pruned from every unseen pool
  * snoozed  -> pruned from the slate window while the snooze holds
  * shortlist -> `shortlist`: full film objects (from the pools, or rebuilt
                 from the stored snapshot), newest first. The nudge and the
                 Stremio row lead with these.

Usage:
    python apply_state.py <data.json> <state.json>
"""
import json
import sys
from datetime import date

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def load_rows(path):
    text = open(path, encoding="utf-8").read()
    # wrangler may print a banner before the JSON; start at the first bracket
    start = min((i for i in (text.find("["), text.find("{")) if i >= 0), default=0)
    raw = json.loads(text[start:] or "[]")
    # wrangler --json: [{"results": [...], "success": true, ...}]
    if isinstance(raw, list) and raw and isinstance(raw[0], dict) and "results" in raw[0]:
        rows = []
        for block in raw:
            rows.extend(block.get("results") or [])
        return rows
    if isinstance(raw, dict) and "films" in raw:      # /api/state shape
        return raw["films"]
    return raw if isinstance(raw, list) else []


def _list(v):
    if isinstance(v, list):
        return [str(x) for x in v]
    if isinstance(v, str) and v.startswith("["):
        try:
            return [str(x) for x in json.loads(v)]
        except ValueError:
            pass
    return []


def film_from_row(r):
    """A minimal film object from the snapshot columns, for films that have
    since rotated out of every pool."""
    if not r.get("title"):
        return None
    return {
        "tmdb_id": int(r["tmdb_id"]), "title": r["title"], "original_title": r["title"],
        "year": str(r.get("year") or ""), "overview": "", "tagline": "",
        "runtime": int(r.get("runtime") or 0), "genres": [], "directors": _list(r.get("directors")),
        "writers": [], "cast": [], "poster": r.get("poster"), "backdrop": None,
        "vote_average": 0, "vote_count": 0, "imdb_id": r.get("imdb_id"),
        "original_language": "", "score": 0,
        "reasons": _list(r.get("reasons")) or ["on your shortlist"],
    }


def apply(d, rows, today=None):
    today = (today or date.today()).isoformat()
    watched, dismissed, snoozed, shortlist = set(), set(), set(), []
    for r in rows:
        try:
            tid = int(r.get("tmdb_id"))
        except (TypeError, ValueError):
            continue
        status = r.get("status")
        if status == "watched":
            watched.add(tid)
        elif status == "dismissed":
            dismissed.add(tid)
        elif status == "shortlist":
            shortlist.append((int(r.get("updated_at") or 0), tid, r))
        snooze = r.get("snooze_until")
        if snooze and str(snooze) > today and status not in ("watched", "dismissed"):
            snoozed.add(tid)

    hide = watched | dismissed
    pruned = 0

    def keep(films, also=frozenset()):
        nonlocal pruned
        out = [f for f in films if f.get("tmdb_id") not in hide and f.get("tmdb_id") not in also]
        pruned += len(films) - len(out)
        return out

    for key in ("queue", "focus_pool_extra", "deep_cuts"):
        if isinstance(d.get(key), list):
            d[key] = keep(d[key])
    if d.get("wildcard") and d["wildcard"].get("tmdb_id") in hide:
        d["wildcard"] = (d.get("deep_cuts") or [None])[0]
        pruned += 1
    if d.get("mood_picks"):
        d["mood_picks"] = {
            mood: [f for f in picks if f.get("kind") == "rewatch" or f.get("tmdb_id") not in hide]
            for mood, picks in d["mood_picks"].items()
        }
    if d.get("slates"):
        # a snooze is "not tonight", so it only affects the slate window
        d["slates"] = [{**s, "focus": keep(s.get("focus", []), snoozed)} for s in d["slates"]]
    if d.get("todays_pick") and d["todays_pick"].get("tmdb_id") in (hide | snoozed):
        pool = (d.get("slates") or [{}])[0].get("focus") or d.get("queue") or []
        if pool:
            d["todays_pick"] = pool[0]

    if watched:
        d["watched_tmdb_set"] = sorted(set(d.get("watched_tmdb_set") or []) | watched)

    # shortlist: full objects where a pool still carries the film
    index = {}
    for key in ("queue", "focus_pool_extra", "background_pool", "deep_cuts"):
        for f in d.get(key) or []:
            index.setdefault(f.get("tmdb_id"), f)
    for picks in (d.get("mood_picks") or {}).values():
        for f in picks:
            index.setdefault(f.get("tmdb_id"), f)
    for s in d.get("slates") or []:
        for f in (s.get("focus") or []) + (s.get("background") or []):
            index.setdefault(f.get("tmdb_id"), f)
    out = []
    for _, tid, r in sorted(shortlist, reverse=True):
        if tid in hide or tid in snoozed:
            continue
        f = index.get(tid) or film_from_row(r)
        if f:
            out.append(f)
    d["shortlist"] = out
    d["state_applied_at"] = today
    return {"watched": len(watched), "dismissed": len(dismissed), "snoozed": len(snoozed),
            "shortlist": len(out), "pruned": pruned}


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    data_path, state_path = sys.argv[1], sys.argv[2]
    d = json.load(open(data_path, encoding="utf-8"))
    rows = load_rows(state_path)
    summary = apply(d, rows)
    json.dump(d, open(data_path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"applied {len(rows)} state rows: {summary}")
    print(f"wrote {data_path}")


if __name__ == "__main__":
    main()
