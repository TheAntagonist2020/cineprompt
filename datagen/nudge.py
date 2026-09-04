"""Push a "watch something tonight" nudge to your phone via ntfy.

The app is a pull system: it waits for you to visit. This is the push half.
It reads the freshly rebuilt data.json, works out how long it's been since you
logged anything, and sends the actual picks to your lock screen, each one a
button that opens the film in Stremio. The message alone is enough to decide
on and one tap starts it, so the site never has to be opened.

What it does that a plain "top of the queue" would not:

  * Rotates. The queue is sorted, so its top three would be the same three
    every night until you watched one. A nag that never changes gets swiped
    away in a week. Picks come from a daily shuffle of the top of the queue,
    stable within the day so a follow-up matches the evening message.
  * Respects the night. Sunday to Thursday always includes one film under
    SHORT_MAX minutes and steers away from anything LONG_MIN or over. Friday
    and Saturday make room for one long one.
  * Knows when you already watched something today, and eases off instead of
    piling on. Counts a streak and says so.
  * Escalates the longer you have been quiet.

Modes (NUDGE_MODE):
  evening   the main nudge: three picks, poster, buttons
  followup  later the same night, one easy pick, and only if nothing was
            logged today; silent otherwise

Silent no-op when NTFY_TOPIC is unset, so the deploy never depends on it.

Usage:  python datagen/nudge.py client/public/data.json
Env:    NTFY_TOPIC    required to actually send
        NTFY_SERVER   default https://ntfy.sh
        SITE_URL      default https://cineprompt.pages.dev
        NUDGE_MODE    evening (default) | followup
        STREMIO_APP   set to 1 to use the bare stremio:// scheme instead of
                      web.stremio.com links (default: web, which opens anywhere
                      and hands off to the app where it is installed)
        NUDGE_TODAY   YYYY-MM-DD, overrides today (testing)
"""

import json
import os
import random
import re
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

SITE_URL = os.environ.get("SITE_URL") or "https://cineprompt.pages.dev"
MAX_PICKS = 3
POOL_SIZE = 20      # how deep into the queue the daily rotation reaches
SHORT_MAX = 100     # minutes: fits an evening, not a whole night
LONG_MIN = 150      # minutes: weekend material
TMDB_IMG = "https://image.tmdb.org/t/p"
IMDB_RE = re.compile(r"tt\d{5,9}")
LIST_NAME = "Cineprompt — Tonight"   # the MDBList list that shows up as a Stremio row


# ---------------------------------------------------------------- dates ----

def today():
    override = os.environ.get("NUDGE_TODAY", "").strip()
    if override:
        return date.fromisoformat(override)
    return date.today()


def parse_day(value):
    """Accept 'YYYY-MM-DD' or a full ISO timestamp; return a date or None."""
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def is_weekend(day):
    return day.weekday() in (4, 5)   # Friday, Saturday nights


def watch_stats(data, day):
    """(quiet_days, last_date, titles_logged_today, streak).

    quiet_days is None if nothing is logged at all. streak counts consecutive
    days with a logged watch ending today, or yesterday if today is empty.
    """
    by_day = {}
    for watch in data.get("recent_watches") or []:
        when = parse_day(watch.get("last_watched"))
        if when:
            by_day.setdefault(when, []).append(watch.get("title") or "a film")
    if not by_day:
        return None, None, [], 0

    latest = max(by_day)
    quiet = (day - latest).days
    today_titles = by_day.get(day, [])

    streak, cursor = 0, (day if day in by_day else day - timedelta(days=1))
    while cursor in by_day:
        streak += 1
        cursor -= timedelta(days=1)
    return quiet, latest, today_titles, streak


# ---------------------------------------------------------------- films ----

def minutes(film):
    value = film.get("runtime")
    return value if isinstance(value, int) and value > 0 else None


def runtime_label(value):
    if not value:
        return None
    hours, mins = divmod(value, 60)
    return f"{hours}h{mins:02d}m" if hours else f"{mins}m"


def tidy(reason):
    """Smooth over list names that already start with 'your' ("on the your X")."""
    return reason.replace("on the your ", "on your ")


def film_key(film):
    return film.get("tmdb_id") or film.get("tmdb") or film.get("imdb_id") or film.get("title")


def candidate_pool(data):
    """Today's curated pick plus the top of the queue, deduplicated, in order."""
    pool, seen = [], set()
    for film in [data.get("todays_pick")] + list((data.get("queue") or [])[:POOL_SIZE]):
        if not isinstance(film, dict) or not film.get("title"):
            continue
        key = film_key(film)
        if key in seen:
            continue
        seen.add(key)
        pool.append(film)
    return pool


def daily_shuffle(pool, day):
    """Same order all day, a different order tomorrow."""
    order = list(pool)
    random.Random(day.toordinal()).shuffle(order)
    return order


def pick_films(pool, day, mode):
    shuffled = daily_shuffle(pool, day)
    short = [f for f in shuffled if minutes(f) and minutes(f) <= SHORT_MAX]
    long_ = [f for f in shuffled if minutes(f) and minutes(f) >= LONG_MIN]

    if mode == "followup":
        return (short or shuffled)[:1]

    picks = []

    def take(candidates, limit):
        for film in candidates:
            if len(picks) >= limit:
                break
            if film not in picks:
                picks.append(film)

    if is_weekend(day):
        take(long_, 1)                                   # room for the epic
        take(shuffled, MAX_PICKS)
    else:
        take(short, 1)                                   # always one you can finish
        take([f for f in shuffled if f not in long_], MAX_PICKS)
        take(shuffled, MAX_PICKS)                        # only if the pool is thin
    return picks


def describe(film, day):
    """Two lines: the headline, then why it's being suggested."""
    title = film.get("title") or "Untitled"
    year = str(film.get("year") or "").strip()
    head = f"{title} ({year})" if year else title

    bits = []
    label = runtime_label(minutes(film))
    if label:
        bits.append(label)
    directors = [d for d in (film.get("directors") or []) if d]
    if directors:
        bits.append(directors[0])
    if bits:
        head += " — " + ", ".join(bits)

    reasons = [tidy(r) for r in (film.get("reasons") or []) if r][:2]
    if is_weekend(day) and minutes(film) and minutes(film) >= LONG_MIN:
        reasons = reasons[:1] + ["weekend epic"]
    return f"{head}\n   {' · '.join(reasons)}" if reasons else head


# --------------------------------------------------------------- links -----

def stremio_url(film, web=False):
    imdb = str(film.get("imdb_id") or "")
    if not IMDB_RE.fullmatch(imdb):
        return None
    if web:
        return f"https://web.stremio.com/#/detail/movie/{imdb}/{imdb}"
    return f"stremio:///detail/movie/{imdb}/{imdb}"


def poster_url(film, size="w500"):
    path = film.get("poster")
    if isinstance(path, str) and path.startswith("/"):
        return f"{TMDB_IMG}/{size}{path}"
    return None


def button_label(film):
    title = film.get("title") or "Play"
    return "▶ " + (title if len(title) <= 22 else title[:21].rstrip() + "…")


def actions_for(picks, web):
    out = []
    for film in picks[:3]:                    # ntfy allows at most three actions
        url = stremio_url(film, web)
        if url:
            out.append({"action": "view", "label": button_label(film), "url": url, "clear": True})
    return out


# ------------------------------------------------------------- compose -----

def compose(data, day, mode, web):
    quiet, last, today_titles, streak = watch_stats(data, day)
    pool = candidate_pool(data)
    if not pool:
        return None, "no picks available in data.json"
    picks = pick_films(pool, day, mode)
    if not picks:
        return None, "nothing survived the runtime rules"

    if mode == "followup":
        if quiet == 0:
            return None, f"already logged {today_titles[0]} today, no follow-up"
        title, opener, priority, tags = (
            "Still nothing on?",
            "Easiest one for right now:",
            3,
            ["clapper"],
        )
    elif quiet == 0:
        title, opener, priority, tags = (
            f"{today_titles[0]} logged. Nice.",
            "Already watched something today. If you're going again:",
            2,
            ["white_check_mark"],
        )
    elif quiet is None:
        title, opener, priority, tags = (
            "Something for tonight",
            "Nothing logged yet. Start here:",
            3,
            ["clapper"],
        )
    elif quiet <= 2:
        title, opener, priority, tags = (
            "Tonight's pick",
            "For tonight:",
            3,
            ["clapper"],
        )
    elif quiet <= 6:
        title, opener, priority, tags = (
            f"{quiet} days since your last film",
            f"You last logged something on {last:%b %d}. Put one of these on:",
            4,
            ["clapper", "eyes"],
        )
    elif quiet <= 13:
        title, opener, priority, tags = (
            f"A week without a film ({quiet} days)",
            f"Last logged {last:%b %d}. Pick one, press play:",
            4,
            ["clapper", "warning"],
        )
    else:
        title, opener, priority, tags = (
            f"{quiet} days. Put a movie on.",
            f"Nothing logged since {last:%b %d}. Tonight, one of these:",
            5,
            ["clapper", "rotating_light"],
        )

    lines = [opener, ""]
    for i, film in enumerate(picks, 1):
        lines.append(f"{i}. {describe(film, day)}")
    if streak >= 2:
        lines += ["", f"🔥 {streak}-day streak" + (". Don't break it tonight." if quiet == 1 else ".")]
    if is_weekend(day) and mode != "followup":
        lines += ["", "Weekend. There's room for the long one."]
    lines += ["", f"Also in Stremio: the “{LIST_NAME}” row."]

    payload = {
        "title": title,
        "message": "\n".join(lines),
        "priority": priority,
        "tags": tags,
        "click": stremio_url(picks[0], web) or SITE_URL,
        "actions": actions_for(picks, web),
    }
    poster = poster_url(picks[0])
    if poster:
        payload["attach"] = poster
        payload["icon"] = poster_url(picks[0], "w185")
    return payload, None


# ---------------------------------------------------------------- main -----

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "client/public/data.json"
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    mode = (os.environ.get("NUDGE_MODE") or "evening").strip().lower()
    truthy = lambda name: (os.environ.get(name) or "").strip().lower() in ("1", "true", "yes")
    # Web links by default. The bare stremio:// scheme fails outright on a phone
    # without the app; the web link opens anywhere and hands off where it can.
    web = truthy("STREMIO_WEB") or not truthy("STREMIO_APP")
    day = today()

    payload, skipped = compose(data, day, mode, web)
    if payload is None:
        print(f"nudge [{mode}] {day:%a %Y-%m-%d}: skipped — {skipped}")
        return 0

    print(f"nudge [{mode}] {day:%a %Y-%m-%d}\n--- {payload['title']} ---\n{payload['message']}\n")
    for action in payload["actions"]:
        print(f"  [{action['label']}] {action['url']}")
    print(f"  click: {payload['click']}")
    if payload.get("attach"):
        print(f"  poster: {payload['attach']}")
    print()

    topic = (os.environ.get("NTFY_TOPIC") or "").strip()
    if not topic:
        print("nudge: NTFY_TOPIC unset — composed the nudge but sent nothing.")
        return 0

    server = (os.environ.get("NTFY_SERVER") or "https://ntfy.sh").rstrip("/")
    body = json.dumps({"topic": topic, **payload}).encode("utf-8")
    request = urllib.request.Request(
        server + "/", data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            print(f"nudge: sent to {server} (HTTP {response.status})")
    except urllib.error.HTTPError as err:
        print(f"nudge: FAILED — HTTP {err.code} from {server}: {err.read()[:200]!r}")
        return 1
    except Exception as err:  # network hiccup must not fail the deploy
        print(f"nudge: FAILED — {type(err).__name__}: {err}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
