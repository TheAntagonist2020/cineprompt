#!/usr/bin/env python3
"""refresh_slates.py — make Cineprompt show *today* again.

The app shows whatever day matches slates[].date, else slates[0]. The shipped
data.json only had slates for a one-week window in the past, so the app was
stuck on the oldest day. This regenerates the `slates` array for a window that
starts today (drawing focus/background films from the recommendation pools that
are already in data.json) and refreshes generated_at / todays_pick.

It does NOT touch the curated sections (queue, directors, blindspots, canon,
screenplays, craft, themed_weeks, moods, tags, etc.) — those are preserved.

Usage:
    python refresh_slates.py <base_data.json> <output_data.json> [days]
"""
import json
import os
import sys
from datetime import datetime, timezone, timedelta

FOCUS_PER_DAY = 3
BG_PER_DAY = 2

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(HERE, "..", "client", "public", "data.json")


def seeded_shuffle(items, seed):
    """Deterministic Fisher-Yates using a simple LCG seeded by `seed`."""
    a = list(items)
    state = (seed * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
    for i in range(len(a) - 1, 0, -1):
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        j = state % (i + 1)
        a[i], a[j] = a[j], a[i]
    return a


def main():
    BASE = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DATA
    OUT = sys.argv[2] if len(sys.argv) > 2 else BASE
    DAYS = int(sys.argv[3]) if len(sys.argv) > 3 else 14
    d = json.load(open(BASE, encoding="utf-8"))
    watched = set(d.get("watched_tmdb_set", []))

    # Focus pool: queue + focus_pool_extra, deduped by tmdb_id, excluding watched.
    focus_pool, seen = [], set()
    for f in (d.get("queue", []) + d.get("focus_pool_extra", [])):
        tid = f.get("tmdb_id")
        if tid in seen or tid in watched:
            continue
        seen.add(tid)
        focus_pool.append(f)

    bg_pool = list(d.get("background_pool", []))
    if not focus_pool or not bg_pool:
        sys.exit("Base data.json is missing focus/background pools; cannot build slates.")

    today = datetime.now().date()  # local date, matching the app's todayISO()
    seed = today.toordinal()
    focus_rot = seeded_shuffle(focus_pool, seed)
    bg_rot = seeded_shuffle(bg_pool, seed + 7)

    slates = []
    fi = bi = 0
    for n in range(DAYS):
        day = today + timedelta(days=n)
        # wrap the pools if the window is longer than the pool
        focus = [focus_rot[(fi + k) % len(focus_rot)] for k in range(FOCUS_PER_DAY)]
        background = [bg_rot[(bi + k) % len(bg_rot)] for k in range(BG_PER_DAY)]
        fi += FOCUS_PER_DAY
        bi += BG_PER_DAY
        slates.append({
            "date": day.isoformat(),
            "weekday": day.strftime("%A"),
            "focus": focus,
            "background": background,
        })

    d["slates"] = slates
    d["todays_pick"] = slates[0]["focus"][0]
    now_iso = datetime.now(timezone.utc).astimezone().isoformat()
    d["generated_at"] = now_iso
    d["last_sync"] = now_iso

    json.dump(d, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"Wrote {OUT}")
    print(f"  slates: {len(slates)} days {slates[0]['date']} -> {slates[-1]['date']}")
    print(f"  todays_pick: {d['todays_pick']['title']} ({d['todays_pick']['year']})")
    print(f"  focus pool: {len(focus_pool)} | background pool: {len(bg_pool)}")


if __name__ == "__main__":
    main()
