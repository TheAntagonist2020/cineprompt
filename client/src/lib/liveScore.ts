// Live queue re-ranking: adjust the precomputed pick scores with signals from
// the user's in-app film state, so the queue responds immediately instead of
// waiting for the next pipeline rebuild. Pure functions — no fetching.
//
// Adjustments (each also yields a human-readable "live reason", keeping the
// app's rule that every pick explains itself):
//   +6  shortlist director affinity — you shortlisted another film by this director
//   +4  session momentum — you just marked a film by this director watched in-app

import type { AppData, QueueFilm } from "@/lib/data";
import type { FilmStateContextValue } from "@/lib/filmState";

export interface LiveFilm extends QueueFilm {
  live_score: number;
  live_reasons: string[];
}

const SHORTLIST_AFFINITY = 6;
const SESSION_MOMENTUM = 4;

// tmdb_id -> directors, over every film the client knows about. Cached per
// AppData instance (the data.json singleton), so it's built once.
let directorsCache: { data: AppData; map: Map<number, string[]> } | null = null;
function directorsById(data: AppData): Map<number, string[]> {
  if (directorsCache?.data === data) return directorsCache.map;
  const m = new Map<number, string[]>();
  const add = (f: { tmdb_id: number; directors?: string[] }) => {
    if (f.directors?.length && !m.has(f.tmdb_id)) m.set(f.tmdb_id, f.directors);
  };
  for (const f of data.queue ?? []) add(f);
  for (const f of data.focus_pool_extra ?? []) add(f);
  for (const f of data.background_pool ?? []) add(f);
  for (const picks of Object.values(data.mood_picks ?? {})) picks.forEach(add);
  directorsCache = { data, map: m };
  return m;
}

// Directors implicated by a set of film ids.
function directorsOf(ids: number[], byId: Map<number, string[]>): Map<string, number> {
  const m = new Map<string, number>(); // director -> one of the film ids
  for (const id of ids) {
    for (const d of byId.get(id) ?? []) {
      if (!m.has(d)) m.set(d, id);
    }
  }
  return m;
}

export function liveScore(
  film: QueueFilm,
  shortlistDirectors: Map<string, number>,
  watchedDirectors: Map<string, number>,
): { score: number; reasons: string[] } {
  let score = film.score;
  const reasons: string[] = [];
  for (const d of film.directors ?? []) {
    const shortlistedFrom = shortlistDirectors.get(d);
    if (shortlistedFrom !== undefined && shortlistedFrom !== film.tmdb_id) {
      score += SHORTLIST_AFFINITY;
      reasons.push(`▲ you shortlisted another ${d} film`);
      break; // one affinity bonus max
    }
  }
  for (const d of film.directors ?? []) {
    if (watchedDirectors.has(d)) {
      score += SESSION_MOMENTUM;
      reasons.push(`▲ riding your ${d} run`);
      break; // one momentum bonus max
    }
  }
  return { score, reasons };
}

// Filter out hidden films (watched / dismissed / snoozed) and re-sort by the
// live-adjusted score. Stable for untouched films: sort is by adjusted score
// desc, falling back to the original pipeline order.
export function liveQueue(
  data: AppData,
  films: QueueFilm[],
  fs: FilmStateContextValue,
): LiveFilm[] {
  const byId = directorsById(data);
  const shortlistDirectors = directorsOf(fs.shortlistIds(), byId);
  const watchedDirectors = directorsOf(fs.watchedIds(), byId);
  return films
    .filter((f) => !fs.isHidden(f.tmdb_id))
    .map((f, i) => {
      const { score, reasons } = liveScore(f, shortlistDirectors, watchedDirectors);
      return { ...f, live_score: score, live_reasons: reasons, _i: i } as LiveFilm & { _i: number };
    })
    .sort((a: any, b: any) => b.live_score - a.live_score || a._i - b._i)
    .map(({ _i, ...f }: any) => f as LiveFilm);
}
