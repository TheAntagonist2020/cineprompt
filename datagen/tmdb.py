#!/usr/bin/env python3
"""TMDB resolver + cache for the Cineprompt generator.

Resolves a (title, year) to a TMDB id and fetches the metadata Cineprompt needs.
Everything is cached to .tmdb_cache.json so re-runs are fast and resumable.
TMDB's API is not Cloudflare-blocked, so this works directly over HTTP.
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(HERE, ".tmdb_cache.json")
IMG = "https://image.tmdb.org/t/p"


def _load_env():
    env = {}
    p = os.path.join(HERE, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    for k in ("TMDB_API_KEY",):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


KEY = _load_env().get("TMDB_API_KEY")


class TMDB:
    def __init__(self, key=KEY):
        if not key:
            raise SystemExit("Set TMDB_API_KEY in datagen/.env")
        self.key = key
        self.cache = {}
        if os.path.exists(CACHE_PATH):
            try:
                self.cache = json.load(open(CACHE_PATH, encoding="utf-8"))
            except Exception:
                self.cache = {}
        self._dirty = 0

    # ---- low level ----
    def _get(self, path, params=None):
        params = dict(params or {})
        params["api_key"] = self.key
        url = f"https://api.themoviedb.org/3{path}?{urllib.parse.urlencode(params)}"
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(2 * (attempt + 1))
                    continue
                if e.code == 404:
                    return None
                time.sleep(1)
            except Exception:
                time.sleep(1)
        return None

    def save(self):
        json.dump(self.cache, open(CACHE_PATH, "w", encoding="utf-8"))
        self._dirty = 0

    def _touch(self):
        self._dirty += 1
        if self._dirty >= 50:
            self.save()

    # ---- resolution ----
    @staticmethod
    def _norm(s):
        return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

    def resolve_id(self, title, year=None):
        """Return a tmdb_id for (title, year), or None. Cached by 'title|year'."""
        ck = f"search::{self._norm(title)}|{year or ''}"
        if ck in self.cache:
            return self.cache[ck]
        params = {"query": title, "include_adult": "true"}
        if year:
            params["year"] = str(year)
        data = self._get("/search/movie", params) or {}
        results = data.get("results") or []
        if not results and year:
            data = self._get("/search/movie", {"query": title}) or {}
            results = data.get("results") or []
        best = None
        ntitle = self._norm(title)
        for r in results:
            rt = self._norm(r.get("title"))
            ot = self._norm(r.get("original_title"))
            ry = (r.get("release_date") or "")[:4]
            if (rt == ntitle or ot == ntitle) and (not year or ry == str(year)):
                best = r
                break
        if best is None:
            for r in results:
                if not year or (r.get("release_date") or "")[:4] == str(year):
                    best = r
                    break
        if best is None and results:
            best = results[0]
        tid = best.get("id") if best else None
        self.cache[ck] = tid
        self._touch()
        return tid

    # ---- discovery (for the recommender) ----
    def discover(self, params, pages=1):
        """Yield raw TMDB discover results across `pages`.

        `params` is a dict of /discover/movie filters (sort_by, with_genres,
        with_original_language, primary_release_date.gte/lte, vote_count.gte,
        vote_average.gte, with_people, etc.). Discover responses are NOT cached
        (they're cheap and we want them fresh), but any movie() detail we fetch
        afterwards is cached.
        """
        out = []
        for page in range(1, pages + 1):
            p = dict(params)
            p["page"] = page
            data = self._get("/discover/movie", p) or {}
            results = data.get("results") or []
            if not results:
                break
            out.extend(results)
            if page >= int(data.get("total_pages", page) or page):
                break
        return out

    def person_search(self, name):
        """Resolve a person name to a TMDB person id (cached)."""
        ck = f"person::{self._norm(name)}"
        if ck in self.cache:
            return self.cache[ck]
        data = self._get("/search/person", {"query": name}) or {}
        results = data.get("results") or []
        pid = results[0]["id"] if results else None
        self.cache[ck] = pid
        self._touch()
        return pid

    def keyword_id(self, name):
        """Resolve a keyword name ('heist', 'slasher') to a TMDB keyword id.

        Resolved at runtime rather than hardcoded: a wrong hardcoded id fails
        silently (discover just returns the wrong films), while a name that
        stops resolving shows up as None and the caller can skip the channel.
        Prefers an exact name match over TMDB's fuzzy ordering.
        """
        ck = f"keyword::{self._norm(name)}"
        if ck in self.cache:
            return self.cache[ck]
        data = self._get("/search/keyword", {"query": name}) or {}
        results = data.get("results") or []
        exact = next((r for r in results if (r.get("name") or "").lower() == name.lower()), None)
        kid = (exact or (results[0] if results else {})).get("id")
        self.cache[ck] = kid
        self._touch()
        return kid

    def person_directed(self, person_id):
        """Return [{tmdb_id, title, year, vote_average, vote_count, poster}] of
        movies this person DIRECTED, newest first (cached by person id)."""
        if person_id is None:
            return []
        ck = f"directed::{person_id}"
        if ck in self.cache:
            return self.cache[ck]
        data = self._get(f"/person/{person_id}/movie_credits") or {}
        crew = data.get("crew") or []
        films = []
        seen = set()
        for c in crew:
            if c.get("job") != "Director":
                continue
            tid = c.get("id")
            if not tid or tid in seen:
                continue
            seen.add(tid)
            films.append({
                "tmdb_id": tid,
                "title": c.get("title"),
                "year": (c.get("release_date") or "")[:4],
                "vote_average": c.get("vote_average") or 0,
                "vote_count": c.get("vote_count") or 0,
                "poster": c.get("poster_path"),
            })
        films.sort(key=lambda f: f.get("year") or "", reverse=True)
        self.cache[ck] = films
        self._touch()
        return films

    def movie(self, tmdb_id):
        """Full Cineprompt-shaped metadata for a tmdb_id (cached)."""
        if tmdb_id is None:
            return None
        ck = f"movie::{tmdb_id}"
        if ck in self.cache:
            return self.cache[ck]
        m = self._get(f"/movie/{tmdb_id}", {"append_to_response": "credits"})
        if not m:
            self.cache[ck] = None
            self._touch()
            return None
        crew = (m.get("credits") or {}).get("crew") or []
        cast = (m.get("credits") or {}).get("cast") or []
        directors = [c["name"] for c in crew if c.get("job") == "Director"]
        writers = [c["name"] for c in crew if c.get("department") == "Writing"]
        out = {
            "tmdb_id": m.get("id"),
            "title": m.get("title"),
            "original_title": m.get("original_title"),
            "year": (m.get("release_date") or "")[:4],
            "overview": m.get("overview") or "",
            "tagline": m.get("tagline") or "",
            "runtime": m.get("runtime") or 0,
            "genres": [g["name"] for g in (m.get("genres") or [])],
            "directors": directors,
            "writers": list(dict.fromkeys(writers))[:5],
            "cast": [c["name"] for c in cast[:8]],
            "poster": m.get("poster_path"),
            "backdrop": m.get("backdrop_path"),
            "vote_average": m.get("vote_average") or 0,
            "vote_count": m.get("vote_count") or 0,
            "imdb_id": m.get("imdb_id"),
            "original_language": m.get("original_language"),
            "production_countries": [c["iso_3166_1"] for c in (m.get("production_countries") or [])],
        }
        self.cache[ck] = out
        self._touch()
        return out


if __name__ == "__main__":
    t = TMDB()
    tid = t.resolve_id("Triangle", 2009)
    print("Triangle 2009 ->", tid)
    m = t.movie(tid)
    print(m["title"], m["year"], "| dir:", m["directors"], "| runtime:", m["runtime"])
    t.save()
