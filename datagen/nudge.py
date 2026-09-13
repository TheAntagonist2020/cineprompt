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
  * Knows the difference between a watch and a diary entry. A Trakt scrobble
    or an in-app "Watched" that never reached Letterboxd is "unlogged": the
    message says so and the first button opens the film on Letterboxd to log
    it. The follow-up, otherwise silent after a watch, sends that reminder.

Modes (NUDGE_MODE):
  evening   the main nudge: three picks, poster, buttons
  followup  later the same night, one easy pick, and only if nothing was
            logged today; silent otherwise
  log       right after a watch (IFTTT fires it off a Trakt scrobble): just
            "X — watched, not logged" with the Log button, and nothing at
            all when the diary already has it

Never twice. A small log (datagen/.nudge_log.json, kept across CI runs)
records what went out: the evening and follow-up nudges at most once per
calendar day, the log prompt at most once per watch. The GitHub cron and
the IFTTT applet can both fire the same nudge and the first one wins.
NUDGE_FORCE=1 bypasses that for a test send.

Silent no-op when NTFY_TOPIC is unset, so the deploy never depends on it.

Usage:  python datagen/nudge.py client/public/data.json
Env:    NTFY_TOPIC    required to actually send
        NTFY_SERVER   default https://ntfy.sh
        SITE_URL      default https://cineprompt.pages.dev
        NUDGE_MODE    evening (default) | followup | log
        NUDGE_FORCE   set to 1 to send even if the nudge log says it went out
        NUDGE_LOG     path of the sent-nudge log (default datagen/.nudge_log.json)
        STREMIO_WEB   set to 1 to link web.stremio.com instead of the app scheme
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
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".nudge_log.json")
LOG_KEEP_DAYS = 30  # entries older than this are dropped from the sent log


# ------------------------------------------------------------ sent log ----

def log_path():
    return os.environ.get("NUDGE_LOG") or LOG_PATH


def load_log():
    """{"evening": "YYYY-MM-DD", "followup": "YYYY-MM-DD", "log": {"<tmdb>": "<watched_at>"}}"""
    try:
        with open(log_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_log(log, day):
    """Write the sent log, dropping per-watch entries older than LOG_KEEP_DAYS."""
    keep = (day - timedelta(days=LOG_KEEP_DAYS)).isoformat()
    log["log"] = {k: v for k, v in (log.get("log") or {}).items() if str(v) >= keep}
    try:
        with open(log_path(), "w", encoding="utf-8") as fh:
            json.dump(log, fh, indent=2, sort_keys=True)
    except OSError as err:  # a log we cannot write must not cost the nudge
        print(f"nudge: could not write {log_path()}: {err}")


def already_sent(log, mode, day, key=None):
    """True when this nudge already went out: today, for evening/followup;
    for this watch, in log mode (key = "<tmdb>:<watched_at>")."""
    if mode == "log":
        return bool(key) and key in (log.get("log") or {})
    return log.get(mode) == day.isoformat()


def record(log, mode, day, key=None):
    if mode == "log":
        if key:
            log.setdefault("log", {})[key] = key.split(":", 1)[-1]
    else:
        log[mode] = day.isoformat()


# ---------------------------------------------------------------- dates ----

def today():
    """The user's calendar day. The evening runs fire after UTC midnight, so
    the runner's date is a day ahead: weeknight rules would fire on Saturday
    and a watch logged "today" could never match. NUDGE_TZ overrides the zone."""
    override = os.environ.get("NUDGE_TODAY", "").strip()
    if override:
        return date.fromisoformat(override)
    tz = os.environ.get("NUDGE_TZ") or os.environ.get("USER_TZ") or "America/Chicago"
    try:
        from zoneinfo import ZoneInfo
        from datetime import datetime
        return datetime.now(ZoneInfo(tz)).date()
    except Exception:
        print(f"nudge: timezone {tz!r} unavailable, using the UTC date")
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


UNLOGGED_REMIND_DAYS = 7   # keep nagging about a missing diary entry this long


def unlogged_watches(data, day):
    """Recent watches with no Letterboxd diary entry, newest first (from the
    pipeline's `unlogged`, see build_recommendations.find_unlogged)."""
    out = []
    for u in data.get("unlogged") or []:
        when = parse_day(u.get("watched_at"))
        if when and when > day:
            when = day                       # a UTC-dated evening watch: it was today
        if when and 0 <= (day - when).days <= UNLOGGED_REMIND_DAYS and u.get("letterboxd_url"):
            out.append({**u, "_day": when})
    out.sort(key=lambda u: u["_day"], reverse=True)
    return out


def log_action(u):
    title = u.get("title") or "it"
    return {"action": "view", "url": u["letterboxd_url"], "clear": True,
            "label": "✎ Log " + (title if len(title) <= 18 else title[:17].rstrip() + "…")}


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
    """Your shortlist first (films you already chose, in the app), then
    today's curated pick, then the top of the queue — deduplicated, in order."""
    pool, seen = [], set()
    shortlist = list(data.get("shortlist") or [])
    for film in shortlist + [data.get("todays_pick")] + list((data.get("queue") or [])[:POOL_SIZE]):
        if not isinstance(film, dict) or not film.get("title"):
            continue
        key = film_key(film)
        if key in seen:
            continue
        seen.add(key)
        pool.append({**film, "_shortlisted": film in shortlist})
    return pool


def daily_shuffle(pool, day):
    """Same order all day, a different order tomorrow."""
    order = list(pool)
    random.Random(day.toordinal()).shuffle(order)
    return order


def pick_films(pool, day, mode):
    # The shortlist is a decision already made: it is never shuffled away.
    # Everything after it rotates daily as before.
    lead = [f for f in pool if f.get("_shortlisted")]
    shuffled = lead + daily_shuffle([f for f in pool if not f.get("_shortlisted")], day)
    short = [f for f in shuffled if minutes(f) and minutes(f) <= SHORT_MAX]
    long_ = [f for f in shuffled if minutes(f) and minutes(f) >= LONG_MIN]

    if mode == "followup":
        easy_lead = [f for f in lead if minutes(f) and minutes(f) <= SHORT_MAX]
        return (easy_lead or short or shuffled)[:1]

    picks = []

    def take(candidates, limit):
        for film in candidates:
            if len(picks) >= limit:
                break
            if film not in picks:
                picks.append(film)

    take(lead, MAX_PICKS)                                # your shortlist leads, whatever the night
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


def actions_for(picks, web, unlogged=None):
    out = []
    if unlogged:                              # the diary entry comes first
        out.append(log_action(unlogged[0]))
    for film in picks[:3]:                    # ntfy allows at most three actions
        if len(out) >= 3:
            break
        url = stremio_url(film, web)
        if url:
            out.append({"action": "view", "label": button_label(film), "url": url, "clear": True})
    return out


# ------------------------------------------------------------- compose -----

def unlogged_poster(u, size="w500"):
    poster = u.get("poster")
    if isinstance(poster, str) and poster.startswith("http"):
        return poster
    return poster_url(u, size)


def log_key(u):
    return f"{u.get('tmdb')}:{u['_day'].isoformat()}"


def compose_log(unlogged, day, sent_log=None):
    """The after-the-credits prompt: one film, one button, or nothing.
    Yesterday counts too — a late show scrobbles after midnight. Films already
    prompted are passed over, so a double feature gets both its prompts, one
    per run, instead of the newest one blocking the other."""
    fresh = [u for u in unlogged if 0 <= (day - u["_day"]).days <= 1]
    if not fresh:
        return None, "nothing watched since yesterday that isn't in the diary"
    todo = [u for u in fresh if not already_sent(sent_log or {}, "log", day, log_key(u))]
    if not todo:
        return None, f"already prompted for {', '.join(u['title'] for u in fresh)} (NUDGE_FORCE=1 overrides)"
    u = todo[0]
    source = "It's on Trakt" if u.get("source") == "trakt" else "You marked it watched"
    payload = {
        "title": f"{u['title']} — watched, not logged",
        "message": f"{source} but not in your Letterboxd diary. Log it while it's fresh.",
        "priority": 4, "tags": ["pencil"], "click": u["letterboxd_url"],
        "actions": [log_action(u)],
        "_key": log_key(u),
    }
    poster = unlogged_poster(u)
    if poster:
        payload["attach"] = poster
        payload["icon"] = unlogged_poster(u, "w185")
    return payload, None


def compose(data, day, mode, web, sent_log=None):
    quiet, last, today_titles, streak = watch_stats(data, day)
    unlogged = unlogged_watches(data, day)
    if mode == "log":
        return compose_log(unlogged, day, sent_log)
    unlogged_today = [u for u in unlogged if u["_day"] == day]
    pool = candidate_pool(data)
    if not pool:
        return None, "no picks available in data.json"
    picks = pick_films(pool, day, mode)
    if not picks:
        return None, "nothing survived the runtime rules"

    if mode == "followup":
        if quiet == 0 and unlogged_today:
            # you watched something and it is still not in the diary: the one
            # reminder that is worth sending after a watch
            u = unlogged_today[0]
            payload = {
                "title": f"{u['title']} isn't in your diary yet",
                "message": "Watched today, not logged on Letterboxd. Tap to log it.",
                "priority": 3, "tags": ["pencil"], "click": u["letterboxd_url"],
                "actions": [log_action(u)],
            }
            return payload, None
        if quiet == 0:
            return None, f"already logged {today_titles[0]} today, no follow-up"
        title, opener, priority, tags = (
            "Still nothing on?",
            "Easiest one for right now:",
            3,
            ["clapper"],
        )
    elif quiet == 0 and unlogged_today:
        title, opener, priority, tags = (
            f"{unlogged_today[0]['title']} — watched, not logged",
            "It's on Trakt but not in your Letterboxd diary. Log it, then if you're going again:",
            3,
            ["pencil"],
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
    older = [u for u in unlogged if u["_day"] != day]
    if older:
        lines += ["", "✎ Not in your diary yet: " + ", ".join(
            f"{u['title']} ({u['_day']:%a})" for u in older[:3])]
    lines += ["", f"Also in Stremio: the “{LIST_NAME}” row."]

    payload = {
        "title": title,
        "message": "\n".join(lines),
        "priority": priority,
        "tags": tags,
        "click": (unlogged_today[0]["letterboxd_url"] if unlogged_today
                  else stremio_url(picks[0], web) or SITE_URL),
        "actions": actions_for(picks, web, unlogged),
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
    web = (os.environ.get("STREMIO_WEB") or "").strip().lower() in ("1", "true", "yes")
    day = today()

    sent_log = load_log()
    force = (os.environ.get("NUDGE_FORCE") or "").strip().lower() in ("1", "true", "yes")
    payload, skipped = compose(data, day, mode, web, {} if force else sent_log)
    if payload is None:
        print(f"nudge [{mode}] {day:%a %Y-%m-%d}: skipped — {skipped}")
        return 0
    key = payload.pop("_key", None)

    if already_sent(sent_log, mode, day, key) and not force:
        what = f"the log prompt for {key}" if mode == "log" else f"the {mode} nudge"
        print(f"nudge [{mode}] {day:%a %Y-%m-%d}: skipped — {what} already went out (NUDGE_FORCE=1 overrides)")
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
        record(sent_log, mode, day, key)
        save_log(sent_log, day)
    except urllib.error.HTTPError as err:
        print(f"nudge: FAILED — HTTP {err.code} from {server}: {err.read()[:200]!r}")
        return 1
    except Exception as err:  # network hiccup must not fail the deploy
        print(f"nudge: FAILED — {type(err).__name__}: {err}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
