#!/usr/bin/env python3
"""mdblist_sync.py — push Cineprompt's current picks to an MDBList list.

That list, via the MDBList Stremio addon, surfaces as a catalog row inside
Stremio — so "tonight's picks" show up right where you watch. Run on each data
rebuild to keep it fresh.

It creates (once) a private list named "Cineprompt — Tonight" and REPLACES its
contents each run with the current daily focus + top unseen picks (default 25).

Key: MDBLIST_API_KEY from the environment or datagen/.env.

Usage:
    python mdblist_sync.py [data.json] [--name "Cineprompt — Tonight"] [--count 25]
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
LIST_NAME = "Cineprompt — Tonight"
COUNT = 25


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


def _req(method, path, params=None, body=None):
    params = dict(params or {})
    params["apikey"] = KEY
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json", "User-Agent": "Cineprompt/1.0"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else {}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 * (attempt + 1)); continue
            sys.exit(f"MDBList {method} {path} -> HTTP {e.code}: {e.read().decode()[:300]}")
        except Exception as e:
            if attempt == 3:
                sys.exit(f"MDBList {method} {path} failed: {e}")
            time.sleep(1)


def pick_films(d, count):
    """Today's focus first, then the highest-scored unseen queue, deduped."""
    focus = (d.get("slates") or [{}])[0].get("focus", []) or []
    queue = d.get("queue", []) or []
    seen, out = set(), []
    for f in focus + queue:
        t = f.get("tmdb_id")
        if t and t not in seen:
            seen.add(t)
            out.append(f)
        if len(out) >= count:
            break
    return out


def find_list(name):
    lists = _req("GET", "/lists/user") or []
    for l in lists:
        if l.get("name") == name:
            return l.get("id")
    return None


def list_item_tmdb_ids(lid):
    cur = _req("GET", f"/lists/{lid}/items") or {}
    movies = cur.get("movies", []) if isinstance(cur, dict) else cur
    ids = []
    for m in (movies or []):
        tid = (m.get("ids") or {}).get("tmdb") or m.get("id")
        if tid:
            ids.append(int(tid))
    return ids


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    data_path = args[0] if args else DEFAULT_DATA
    name = LIST_NAME
    count = COUNT
    for a in sys.argv[1:]:
        if a.startswith("--name="):
            name = a.split("=", 1)[1]
        elif a.startswith("--count="):
            count = int(a.split("=", 1)[1])

    d = json.load(open(data_path, encoding="utf-8"))
    films = pick_films(d, count)
    if not films:
        sys.exit("No picks found in data.json (queue/slates empty).")

    lid = find_list(name)
    if not lid:
        r = _req("POST", "/lists/user/add", body={"name": name, "private": True})
        lid = r.get("id") if isinstance(r, dict) else None
        if not lid:
            sys.exit(f"Could not create list (response: {json.dumps(r)[:200]})")
        print(f"created private list '{name}' (id {lid})")
    else:
        # clear existing items so the list always reflects the CURRENT picks
        old = list_item_tmdb_ids(lid)
        if old:
            _req("POST", f"/lists/{lid}/items/remove",
                 body={"movies": [{"tmdb": t} for t in old]})
            print(f"cleared {len(old)} old items from list {lid}")

    add = [{"tmdb": f["tmdb_id"], **({"imdb": f["imdb_id"]} if f.get("imdb_id") else {})}
           for f in films]
    res = _req("POST", f"/lists/{lid}/items/add", body={"movies": add})

    print(f"synced {len(add)} films -> '{name}' (id {lid})")
    print("response:", json.dumps(res)[:200])
    print("first few:", " | ".join(f"{f['title']} ({f['year']})" for f in films[:6]))
    print(f"\nStremio: install the MDBList addon and enable the '{name}' list.")


if __name__ == "__main__":
    main()
