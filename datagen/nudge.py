"""Push a "watch something tonight" nudge to your phone via ntfy.

The app is a pull system: it waits for you to visit. This is the push half —
it reads the freshly rebuilt data.json, works out how long it's been since you
logged anything, and sends the actual picks (title, runtime, why) to your
lock screen. The point is that the message alone is enough to decide on, so
you never have to open the site to get the value out of it.

Silent no-op when NTFY_TOPIC is unset, so the deploy never depends on it.

Usage:  python datagen/nudge.py client/public/data.json
Env:    NTFY_TOPIC   (required to actually send)
        NTFY_SERVER  (default https://ntfy.sh)
        SITE_URL     (default https://cineprompt.pages.dev)
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime

SITE_URL = os.environ.get("SITE_URL", "https://cineprompt.pages.dev")
MAX_PICKS = 3


def parse_day(value):
    """Accept 'YYYY-MM-DD' or a full ISO timestamp; return a date or None."""
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def days_since_last_watch(data):
    """Days since the most recent logged watch, or None if nothing is logged."""
    latest = None
    for watch in data.get("recent_watches") or []:
        day = parse_day(watch.get("last_watched"))
        if day and (latest is None or day > latest):
            latest = day
    if latest is None:
        return None, None
    return (date.today() - latest).days, latest


def runtime_label(minutes):
    if not isinstance(minutes, int) or minutes <= 0:
        return None
    hours, mins = divmod(minutes, 60)
    return f"{hours}h{mins:02d}m" if hours else f"{mins}m"


def tidy(reason):
    """Smooth over list names that already start with 'your' ("on the your X")."""
    return reason.replace("on the your ", "on your ")


def describe(film):
    """One film as two lines: the headline, then why it's being suggested."""
    title = film.get("title") or "Untitled"
    year = str(film.get("year") or "").strip()
    head = f"{title} ({year})" if year else title

    bits = []
    runtime = runtime_label(film.get("runtime"))
    if runtime:
        bits.append(runtime)
    directors = [d for d in (film.get("directors") or []) if d]
    if directors:
        bits.append(directors[0])
    if bits:
        head += " — " + ", ".join(bits)

    reasons = [tidy(r) for r in (film.get("reasons") or []) if r][:2]
    if reasons:
        return f"{head}\n   {' · '.join(reasons)}"
    return head


def choose_picks(data):
    """Today's curated pick first, then the strongest queue entries after it."""
    picks, seen = [], set()

    def add(film):
        if not isinstance(film, dict):
            return
        key = film.get("tmdb_id") or film.get("tmdb") or film.get("title")
        if key is None or key in seen or len(picks) >= MAX_PICKS:
            return
        seen.add(key)
        picks.append(film)

    add(data.get("todays_pick"))
    for film in data.get("queue") or []:
        add(film)
    return picks


def compose(data):
    """Return (title, message, priority, tags) with tone scaled to the silence."""
    quiet, last = days_since_last_watch(data)
    picks = choose_picks(data)
    if not picks:
        return None

    if quiet is None:
        title, opener, priority, tags = (
            "Something for tonight",
            "Nothing logged yet — start here:",
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
        lines.append(f"{i}. {describe(film)}")
    return title, "\n".join(lines), priority, tags


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "client/public/data.json"
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    composed = compose(data)
    if composed is None:
        print("nudge: no picks available in data.json — nothing to send.")
        return 0
    title, message, priority, tags = composed

    print(f"--- {title} ---\n{message}\n")

    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        print("nudge: NTFY_TOPIC unset — composed the nudge but sent nothing.")
        return 0

    server = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    payload = json.dumps(
        {
            "topic": topic,
            "title": title,
            "message": message,
            "priority": priority,
            "tags": tags,
            "click": SITE_URL,
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        server + "/",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
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
