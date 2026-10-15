import type { AppData, QueueFilm } from "@/lib/data";
import { plexSearchUrl, stremioNativeUrl, stremioWebUrl } from "@shared/watchLinks";

/**
 * Nocturne — one locked film, a modulated marathon, and a private craft note.
 * The pool is the app's data.json (via the core payload) plus a fixed October
 * slate so the page still has something to put on when a filter wipes the library.
 */

export type Energy = "low" | "medium" | "high";
export type OctoberWindow = "day" | "night";

export interface NocturneFilm {
  tmdbId: number;
  title: string;
  year: string;
  runtime: number;
  directors: string[];
  imdbId: string | null;
  language: string;
  genres: string[];
  poster: string | null;
  overview: string;
  rating: number | null;
  atmospheric: boolean;
  fiveStar: boolean;
  /** True for the built-in October slate, even when the library also has the title. */
  essential: boolean;
}

export interface MarathonSlot {
  film: NocturneFilm;
  modulation: string;
  mystery: boolean;
  freshEyes: string;
}

export interface CraftStudy {
  camera: string;
  sound: string;
  pacing: string;
  letterboxd: string;
  source: "claude" | "fallback";
}

export interface MarathonPlan {
  slots: MarathonSlot[];
  source: "claude" | "fallback";
}

/** October horror / thriller essentials. Metadata matches titles already in data.json. */
export const OCTOBER_ESSENTIALS: NocturneFilm[] = [
  {
    tmdbId: 30497,
    title: "The Texas Chain Saw Massacre",
    year: "1974",
    runtime: 83,
    directors: ["Tobe Hooper"],
    imdbId: "tt0072271",
    language: "en",
    genres: ["Horror"],
    poster: null,
    overview: "",
    rating: null,
    atmospheric: false,
    fiveStar: false,
    essential: true,
  },
  {
    tmdbId: 11906,
    title: "Suspiria",
    year: "1977",
    runtime: 99,
    directors: ["Dario Argento"],
    imdbId: "tt0076786",
    language: "it",
    genres: ["Horror"],
    poster: null,
    overview: "",
    rating: null,
    atmospheric: true,
    fiveStar: false,
    essential: true,
  },
  {
    tmdbId: 16307,
    title: "The Wicker Man",
    year: "1973",
    runtime: 88,
    directors: ["Robin Hardy"],
    imdbId: "tt0070917",
    language: "en",
    genres: ["Horror", "Mystery"],
    poster: null,
    overview: "",
    rating: null,
    atmospheric: false,
    fiveStar: false,
    essential: true,
  },
  {
    tmdbId: 460885,
    title: "Mandy",
    year: "2018",
    runtime: 121,
    directors: ["Panos Cosmatos"],
    imdbId: "tt6998518",
    language: "en",
    genres: ["Horror", "Thriller"],
    poster: null,
    overview: "",
    rating: null,
    atmospheric: true,
    fiveStar: false,
    essential: true,
  },
  {
    tmdbId: 837,
    title: "Videodrome",
    year: "1983",
    runtime: 89,
    directors: ["David Cronenberg"],
    imdbId: "tt0086541",
    language: "en",
    genres: ["Horror", "Science Fiction"],
    poster: null,
    overview: "",
    rating: null,
    atmospheric: false,
    fiveStar: false,
    essential: true,
  },
  {
    tmdbId: 36095,
    title: "Cure",
    year: "1997",
    runtime: 111,
    directors: ["Kiyoshi Kurosawa"],
    imdbId: "tt0123948",
    language: "ja",
    genres: ["Horror", "Mystery", "Thriller"],
    poster: null,
    overview: "",
    rating: null,
    atmospheric: false,
    fiveStar: false,
    essential: true,
  },
];

const ATMOSPHERIC_IMDB = new Set(
  OCTOBER_ESSENTIALS.filter((f) => f.atmospheric).map((f) => f.imdbId),
);

export function filmKey(film: { imdbId?: string | null; title: string; year?: string | number | null }): string {
  if (film.imdbId) return film.imdbId;
  return `${film.title.toLowerCase()}|${film.year ?? ""}`;
}

export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function ratingOf(film: Partial<QueueFilm> & { letterboxd_rating?: number; diary_rating?: number }): number | null {
  const candidates = [film.letterboxd_rating, film.diary_rating, film.user_review?.rating];
  for (const value of candidates) {
    if (typeof value === "number" && value > 0) return value;
  }
  return null;
}

function fromQueue(film: Partial<QueueFilm>, fiveStar = false): NocturneFilm | null {
  if (!film.title || !film.tmdb_id) return null;
  const language = (film.original_language || "").toLowerCase();
  const imdbId = film.imdb_id ?? null;
  const rating = ratingOf(film);
  return {
    tmdbId: film.tmdb_id,
    title: film.title,
    year: String(film.year ?? ""),
    runtime: film.runtime || 0,
    directors: film.directors ?? [],
    imdbId,
    language,
    genres: film.genres ?? [],
    poster: film.poster ?? null,
    overview: film.overview ?? "",
    rating,
    atmospheric: Boolean(imdbId && ATMOSPHERIC_IMDB.has(imdbId)),
    fiveStar: fiveStar || (rating != null && rating >= 4.75),
    essential: Boolean(imdbId && OCTOBER_ESSENTIALS.some((e) => e.imdbId === imdbId)),
  };
}

/** English, or a picture whose score and image hold without the dialogue. */
export function subtitlesOffOk(film: NocturneFilm): boolean {
  return film.language === "en" || film.atmospheric;
}

export function isOctoberLean(film: NocturneFilm): boolean {
  const genres = film.genres.map((g) => g.toLowerCase());
  return (
    film.essential ||
    film.atmospheric ||
    genres.some((g) => g === "horror" || g === "thriller" || g === "mystery")
  );
}

export function collectPool(data: AppData | null): NocturneFilm[] {
  const map = new Map<string, NocturneFilm>();
  const add = (film: NocturneFilm | null) => {
    if (!film) return;
    const key = filmKey(film);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, film);
      return;
    }
    map.set(key, {
      ...film,
      poster: film.poster || prev.poster,
      overview: film.overview || prev.overview,
      runtime: film.runtime || prev.runtime,
      directors: film.directors.length ? film.directors : prev.directors,
      genres: film.genres.length ? film.genres : prev.genres,
      language: film.language || prev.language,
      rating: film.rating ?? prev.rating,
      fiveStar: film.fiveStar || prev.fiveStar,
      atmospheric: film.atmospheric || prev.atmospheric,
      essential: film.essential || prev.essential,
      imdbId: film.imdbId || prev.imdbId,
    });
  };

  for (const essential of OCTOBER_ESSENTIALS) add(essential);
  if (!data) return [...map.values()];

  const lists: Array<Partial<QueueFilm> | null | undefined> = [
    ...(data.queue ?? []),
    ...(data.focus_pool_extra ?? []),
    ...(data.background_pool ?? []),
    ...(data.deep_cuts ?? []),
    data.todays_pick,
    ...Object.values(data.mood_picks ?? {}).flat(),
    ...(data.slates ?? []).flatMap((slate) => [...(slate.focus ?? []), ...(slate.background ?? [])]),
  ];
  for (const film of lists) add(fromQueue(film ?? {}));
  return [...map.values()];
}

export function octoberPool(films: NocturneFilm[], subtitlesOff: boolean): NocturneFilm[] {
  const immersion = films.filter((film) => !subtitlesOff || subtitlesOffOk(film));
  const october = immersion.filter(isOctoberLean);
  return october.length ? october : immersion;
}

function paceOf(runtime: number): Energy {
  if (!runtime || runtime <= 95) return "high";
  if (runtime <= 120) return "medium";
  return "low";
}

export function scoreFilm(
  film: NocturneFilm,
  dread: number,
  energy: Energy,
  window: OctoberWindow,
): number {
  const genres = new Set(film.genres.map((g) => g.toLowerCase()));
  const horror = genres.has("horror") ? 1 : 0;
  const thriller = genres.has("thriller") ? 1 : 0;
  const mystery = genres.has("mystery") ? 1 : 0;
  let score = horror * 4 + thriller * 2 + mystery * 2;
  score += (dread / 10) * (horror * 6 + thriller * 2);
  score += ((10 - dread) / 10) * (mystery * 4 + (genres.has("drama") ? 1 : 0));
  if (paceOf(film.runtime || 100) === energy) score += 4;
  if (window === "day") {
    score += (film.runtime || 100) <= 100 ? 3 : -1;
    score += horror;
  } else {
    score += (film.runtime || 0) >= 100 ? 3 : 0;
    score += film.atmospheric ? 3 : 0;
    score += mystery * 2;
  }
  if (film.essential) score += 1;
  score += (hashString(film.imdbId || film.title) % 100) / 100;
  return score;
}

export function lockFilm(
  pool: NocturneFilm[],
  dread: number,
  energy: Energy,
  window: OctoberWindow,
  salt = 0,
): NocturneFilm | null {
  if (!pool.length) return null;
  const ranked = [...pool].sort(
    (a, b) => scoreFilm(b, dread, energy, window) - scoreFilm(a, dread, energy, window),
  );
  return ranked[Math.abs(salt) % ranked.length];
}

export function formalistLens(film: NocturneFilm, window: OctoberWindow, dread: number): string {
  const decade = film.year ? `${film.year.slice(0, 3)}0s` : "this stretch of years";
  const director = film.directors[0] || "The camera";
  const light =
    window === "day"
      ? "Daylight depravity: let the sun do the violence. Watch for rooms that are too bright to be safe."
      : "Dead of night: the frame should fall into black. One practical, one face, and the rest is the screen's own dark.";
  const dreadLine =
    dread >= 7
      ? "Dread is high, so the cut should arrive late. Hold the shot until the body in it becomes the threat."
      : dread <= 3
        ? "Keep the dread low and formal. Composition first, shock never."
        : "Mid dread: the threat is in the blocking, not the sting.";
  const sound = film.atmospheric
    ? "Subtitles can stay off. The score and the room are the sentence."
    : film.language === "en"
      ? "English carries the plot, but the mix still has a design. Find the sound that is not dialogue."
      : "Dialogue is doing story work here. If the subtitles stay on, still listen for what the score refuses to underline.";
  return `${director}, ${decade}. ${light} ${dreadLine} ${sound}`;
}

function modulation(prev: NocturneFilm | null, next: NocturneFilm): string {
  if (!prev) {
    const minutes = next.runtime ? `${next.runtime} minutes` : "an untimed picture";
    return `Baseline. ${next.year || "Undated"} ${next.genres[0] || "picture"}, ${minutes}. Everything after this pivots off this tempo.`;
  }
  const delta = (next.runtime || 0) - (prev.runtime || 0);
  const tempo = delta > 15 ? "the cut-rate slows" : delta < -15 ? "the cut-rate jumps" : "the tempo holds";
  const era =
    prev.year && next.year && prev.year.slice(0, 3) !== next.year.slice(0, 3)
      ? `the era shifts from ${prev.year} to ${next.year}`
      : "both films sit in the same stretch of years";
  const acoustic =
    next.atmospheric && !prev.atmospheric
      ? "the sound design takes over from dialogue"
      : !next.atmospheric && prev.atmospheric
        ? "speech comes back in after a passage of score"
        : "the acoustic mood stays in the same register";
  return `From ${prev.title}: ${tempo}, ${era}, and ${acoustic}.`;
}

export function freshEyesPrompt(film: NocturneFilm): string {
  const director = film.directors[0] || "the director";
  return `Fresh eyes: watch ${film.title} as if the five stars belonged to someone else. Name one cut ${director} still gets past you, and one sound you had filed as memory instead of design.`;
}

function takeDistinct(pool: NocturneFilm[], count: number, offset: number, used: Set<string>): NocturneFilm[] {
  const out: NocturneFilm[] = [];
  if (!pool.length) return out;
  for (let i = 0; i < pool.length && out.length < count; i++) {
    const film = pool[(offset + i) % pool.length];
    const key = filmKey(film);
    if (used.has(key)) continue;
    used.add(key);
    out.push(film);
  }
  return out;
}

export function buildMarathon(
  pool: NocturneFilm[],
  prompt: string,
  subtitlesOff: boolean,
): MarathonSlot[] {
  const immersion = pool.filter((film) => !subtitlesOff || subtitlesOffOk(film));
  const october = immersion.filter(isOctoberLean);
  const source = october.length ? october : immersion.length ? immersion : pool;
  const offset = hashString(prompt.trim().toLowerCase() || "october");
  const used = new Set<string>();
  const fives = (immersion.length ? immersion : pool).filter((film) => film.fiveStar);
  const rest = source.filter((film) => !film.fiveStar);
  const mysteryCount = fives.length >= 2 ? 2 : fives.length >= 1 ? 1 : 0;
  const mysteries = takeDistinct(fives, mysteryCount, offset, used);
  const visible = takeDistinct(rest.length ? rest : source, 4 - mysteries.length, offset >>> 3, used);
  const filler = takeDistinct(source, 4 - mysteries.length - visible.length, offset + 7, used);
  const openers = [...visible, ...filler];
  const ordered: { film: NocturneFilm; mystery: boolean }[] = [];
  let visibleIndex = 0;
  let mysteryIndex = 0;
  for (let i = 0; i < 4; i++) {
    const wantMystery = mysteryIndex < mysteries.length && (i === 1 || (i === 3 && mysteries.length > 1));
    if (wantMystery) {
      ordered.push({ film: mysteries[mysteryIndex++], mystery: true });
    } else if (visibleIndex < openers.length) {
      ordered.push({ film: openers[visibleIndex++], mystery: false });
    } else if (mysteryIndex < mysteries.length) {
      ordered.push({ film: mysteries[mysteryIndex++], mystery: true });
    }
  }
  let prev: NocturneFilm | null = null;
  return ordered.map((slot, index) => {
    let note = modulation(prev, slot.film);
    if (index === 0 && prompt.trim()) note = `Request: ${prompt.trim()}. ${note}`;
    prev = slot.film;
    return {
      film: slot.film,
      modulation: note,
      mystery: slot.mystery,
      freshEyes: slot.mystery ? freshEyesPrompt(slot.film) : "",
    };
  });
}

export function craftStudy(film: NocturneFilm, notes: string): CraftStudy {
  const raw = notes.trim();
  const director = film.directors[0] || "the camera";
  const minutes = film.runtime ? `${film.runtime} minutes` : "the running time on the case";
  const spoken = raw || "No notes yet. The study stays inside the frame and does not invent a reaction.";
  return {
    camera: `Camera & blocking. ${director} on ${film.title}${film.year ? ` (${film.year})` : ""}. ${spoken}`,
    sound: `Sound & score. Separate what ${film.title} says from what it plays. ${film.atmospheric ? "This one can live with the subtitles off, so the mix is the sentence." : "Mark the sound that is not dialogue."} ${raw ? `From the seat: ${raw}` : ""}`.trim(),
    pacing: `Pacing. ${minutes}. Note where ${film.title} holds and where it cuts, using only what you wrote. ${raw ? `Your read: ${raw}` : "Nothing written yet, so the pace note stays blank of plot."}`,
    letterboxd: raw || `${film.title}. Formalist note still to write.`,
    source: "fallback",
  };
}

export function stremioNative(imdbId: string): string {
  return stremioNativeUrl(imdbId, "movie");
}

export function stremioWeb(imdbId: string): string {
  return stremioWebUrl(imdbId, "movie");
}

export function plexSearch(title: string): string {
  return plexSearchUrl(title);
}

export const IMMERSION_STORAGE_KEY = "nocturne-subtitles-off";

export function readImmersion(): boolean {
  try {
    return sessionStorage.getItem(IMMERSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeImmersion(on: boolean) {
  try {
    sessionStorage.setItem(IMMERSION_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent("nocturne-immersion", { detail: { on } }));
}
