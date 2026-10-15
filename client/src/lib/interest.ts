import type { AppData, QueueFilm } from "@/lib/data";
import { buildFilmIndex } from "@/lib/data";
import { moodPicks } from "@/lib/mood";

export interface InterestHit {
  film: QueueFilm;
  line: string;
}

const STOP = new Set([
  "a", "an", "the", "of", "and", "or", "movie", "movies", "film", "films",
  "kind", "kinds", "something", "like", "watch", "me", "some", "with", "for",
  "to", "in", "on", "about", "please", "want", "looking", "show", "shows",
  "series", "tv", "that", "this", "just", "any", "cinema",
]);

const LANG: Record<string, string> = {
  japanese: "ja", japan: "ja",
  french: "fr", france: "fr",
  korean: "ko", korea: "ko",
  italian: "it", italy: "it",
  german: "de", germany: "de",
  spanish: "es", spain: "es",
  swedish: "sv", sweden: "sv",
  chinese: "zh", china: "zh",
  russian: "ru",
  danish: "da",
  english: "en",
  polish: "pl",
  portuguese: "pt",
  hindi: "hi",
  finnish: "fi",
  norwegian: "no",
  turkish: "tr",
  dutch: "nl",
};

const GENRE: Record<string, string[]> = {
  horror: ["horror"],
  scary: ["horror"],
  comedy: ["comedy"],
  funny: ["comedy"],
  scifi: ["science fiction"],
  "sci-fi": ["science fiction"],
  thriller: ["thriller"],
  crime: ["crime"],
  western: ["western"],
  westerns: ["western"],
  war: ["war"],
  romance: ["romance"],
  romantic: ["romance"],
  documentary: ["documentary"],
  doc: ["documentary"],
  animation: ["animation"],
  animated: ["animation"],
  anime: ["animation"],
  action: ["action"],
  drama: ["drama"],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("s") && !/^\d+s$/.test(token)) return token.slice(0, -1);
  return token;
}

function tokensOf(clause: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of normalize(clause).split(" ")) {
    const token = stem(raw);
    if (!token || STOP.has(token) || STOP.has(raw) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function decadeRange(token: string): [number, number] | null {
  const short = /^(\d{2})s$/.exec(token);
  if (short) {
    const n = parseInt(short[1], 10);
    const start = n >= 20 ? 1900 + n : 2000 + n;
    return [start, start + 9];
  }
  const long = /^(1[89]\d{2}|20\d{2})s?$/.exec(token);
  if (!long) return null;
  const year = parseInt(long[1], 10);
  const start = Math.floor(year / 10) * 10;
  return [start, start + 9];
}

function blob(film: QueueFilm): string {
  return normalize(
    [
      film.title,
      film.original_title,
      film.tagline,
      film.overview,
      ...(film.genres ?? []),
      ...(film.directors ?? []),
      ...(film.reasons ?? []),
      ...(film.moods ?? []),
      film.year,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function hasWord(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(text);
}

function tokenHits(film: QueueFilm, token: string): boolean {
  const text = blob(film);
  const genres = (film.genres ?? []).map((g) => g.toLowerCase());
  const year = parseInt(film.year, 10);
  const decade = decadeRange(token);
  if (decade && Number.isFinite(year) && year >= decade[0] && year <= decade[1]) return true;
  const lang = LANG[token];
  if (lang && film.original_language === lang) return true;
  if (token === "short" && film.runtime > 0 && film.runtime <= 100) return true;
  if (token === "long" && film.runtime >= 150) return true;
  const genreWords = GENRE[token];
  if (genreWords?.some((g) => genres.some((name) => name.includes(g)))) return true;
  if ((film.directors ?? []).some((name) => hasWord(name.toLowerCase(), token))) return true;
  if (hasWord(text, token)) return true;
  return false;
}

function moodsIn(data: AppData, clause: string): string[] {
  const text = normalize(clause);
  const hits: string[] = [];
  for (const mood of data.moods_meta ?? []) {
    const label = normalize(mood.label);
    const id = normalize(mood.id);
    if ((label && text.includes(label)) || (id && text.includes(id))) hits.push(mood.id);
  }
  return hits;
}

function consumeMoodTokens(tokens: string[], data: AppData, moodIds: string[]): string[] {
  const covered = new Set<string>();
  for (const id of moodIds) {
    const mood = data.moods_meta?.find((m) => m.id === id);
    for (const part of `${mood?.label ?? ""} ${id}`.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part) covered.add(stem(part));
    }
  }
  return tokens.filter((token) => !covered.has(token));
}

function lineFor(film: QueueFilm, clause: string): string {
  const reason = film.reasons?.find((r) => r.trim());
  if (reason) return reason;
  return `Fits “${clause}”.`;
}

function everyToken(film: QueueFilm, tokens: string[]): boolean {
  return tokens.every((token) => tokenHits(film, token));
}

function rank(
  films: QueueFilm[],
  clause: string,
  base: number,
): { film: QueueFilm; score: number; line: string }[] {
  return films.map((film) => ({
    film,
    score: base + (film.score || 0) / 100,
    line: lineFor(film, clause),
  }));
}

function watchPool(data: AppData): QueueFilm[] {
  return [...buildFilmIndex(data).values()];
}

/**
 * "X kind of movie or Y kind of movie".
 * Clauses split on " or " are alternatives. Words inside a clause all have to
 * show up (genre, decade, language, director, title, or the written reason),
 * and a named mood (70s, horror, slow cinema) starts from that mood's picks.
 */
export function matchInterest(data: AppData, raw: string, limit = 12): InterestHit[] {
  const query = raw.trim();
  if (!query) return [];
  const clauses = query.split(/\s+or\s+/i).map((s) => s.trim()).filter(Boolean);
  const pool = watchPool(data);
  const best = new Map<number, { film: QueueFilm; score: number; line: string }>();

  for (const clause of clauses) {
    const moodIds = moodsIn(data, clause).filter((id) => (data.mood_picks?.[id]?.length ?? 0) > 0);
    const tokens = tokensOf(clause);
    const residual = consumeMoodTokens(tokens, data, moodIds);
    let films: QueueFilm[] = [];
    if (moodIds.length) {
      const seeded = moodPicks(data, moodIds);
      films = residual.length ? seeded.filter((film) => everyToken(film, residual)) : seeded;
    }
    // Mood picks missed the extra words, or the mood has nothing in it yet.
    // Require every remaining word against the whole watch pool.
    if (!films.length && tokens.length) {
      films = pool.filter((film) => everyToken(film, tokens));
    }
    for (const row of rank(films, clause, moodIds.length && !residual.length ? 120 : 80)) {
      const prev = best.get(row.film.tmdb_id);
      if (!prev || row.score > prev.score) best.set(row.film.tmdb_id, row);
    }
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || (b.film.score || 0) - (a.film.score || 0))
    .slice(0, limit)
    .map(({ film, line }) => ({ film, line }));
}
