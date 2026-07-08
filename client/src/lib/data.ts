import { useEffect, useState } from "react";

// ---------- Types ----------
export interface User {
  name: string;
  letterboxd: string;
  trakt: string;
  site: string;
}

export interface Stats {
  total_watched: number;
  total_minutes: number;
  total_rated: number;
  this_week: number;
  ratings_distribution: Record<string, number>;
}

export interface QueueFilm {
  tmdb_id: number;
  title: string;
  original_title: string;
  year: string;
  overview: string;
  tagline: string;
  runtime: number;
  genres: string[];
  directors: string[];
  writers: string[];
  cast: string[];
  poster: string | null;
  backdrop: string | null;
  vote_average: number;
  vote_count: number;
  imdb_id: string | null;
  original_language: string;
  production_countries?: string[];
  score: number;
  reasons: string[];
  moods?: string[];
  kind?: "rewatch" | "new";
  letterboxd_rating?: number;
  last_watched?: string;
  plays?: number;
  // v4 injected fields
  user_review?: UserReview;
  pair_with?: PairWith;
  // v4.1
  diary_rating?: number;
}

// ---------- v4 types ----------
export interface UserReview {
  snippet: string;
  rating: number;
  uri: string;
}

export interface ReviewQuote {
  title: string;
  year: string;
  rating: number;
  snippet: string;
  date: string;
  uri: string;
}

export interface PairWith {
  with_tmdb_id: number;
  title: string;
  year: string;
  poster: string | null;
  directors: string[];
  reason: string;
  source: "seen" | "candidate";
}

// A single film entry inside a canon list.
export interface CanonFilm {
  title: string;
  year: number;
  tmdb_id: number | null;
  seen: boolean;
}
// canon: { best_picture: CanonFilm[], sight_and_sound_2022: [...], afi_100: [...], criterion: [...] }
export type Canon = Record<string, CanonFilm[]>;

export interface CollectionFilm {
  title: string;
  year: number;
  tmdb_id: number | null;
  imdb_id?: string | null;
  poster?: string | null;
  overview?: string | null;
  seen: boolean;
}
export interface CollectionMeta {
  key: string;
  name: string;
  description: string;
  mdblist_id: number;
  slug: string;
  private: boolean;
  media_type: string;
  total: number;
  seen: number;
  unseen: number;
}
export type Collections = Record<string, CollectionFilm[]>;

export interface CraftFilm {
  tmdb_id: number;
  title: string;
  year: string;
  directors: string[];
  poster: string | null;
}
export interface CraftEntry {
  seen: CraftFilm[];
  unseen: CraftFilm[];
  seen_count: number;
  unseen_count: number;
  total: number;
  pct_seen: number;
  top_directors: [string, number][];
}
export interface CraftDimensions {
  cinematographers: Record<string, CraftEntry>;
  composers: Record<string, CraftEntry>;
}

export interface DirectorTargetFilm {
  tmdb_id: number;
  title: string;
  year: string;
  poster: string | null;
  vote_average: number;
  vote_count: number;
  overview?: string;
  seen?: boolean;
  runtime?: number;
}
export interface DirectorTarget {
  id: number;
  seen_count: number;
  unseen_quality_count: number;
  total_runtime_minutes: number;
  total_runtime_hours: number;
  next_up: DirectorTargetFilm[];
}

export interface ScreenplayEntry {
  title: string;
  year: number;
  tmdb_id: number;
  poster: string | null;
  directors: string[];
  seen: boolean;
  script_url: string;
  source: "wga_101" | "modern_essential";
}
export interface Screenplays {
  entries: ScreenplayEntry[];
  seen: number;
  total: number;
  pct: number;
}

export interface ThemedWeekFilm {
  title: string;
  year: number;
  tmdb_id: number;
  poster: string | null;
  directors: string[];
  seen: boolean;
}
export interface ThemedWeek {
  slug: string;
  title: string;
  intro: string;
  films: ThemedWeekFilm[];
  seen_count: number;
  total: number;
}

// ---------- v4.1 tags + diary types ----------
export type TagCategory = "director" | "genre" | "channel" | "viewing" | "other";

export interface TagFilm {
  title: string;
  year: number;
  rating: number;
  uri: string | null;
  watched_date?: string | null;
  director?: string | null;
}

export interface TagEntry {
  count: number;
  unique_films: number;
  films: TagFilm[];
  related_tags: string[];
  category: TagCategory;
}

export interface DiaryMeta {
  total_entries: number;
  criterion_channel_count: number;
  unique_titles: number;
  by_year: Record<string, number>;
  by_rating: Record<string, number>;
  tag_categories: Partial<Record<TagCategory, number>>;
  total_tags: number;
}

// ---------- Mood engine types ----------
export type MoodGroup = "Era" | "Genre" | "Vibe" | "Quick";

export interface MoodMeta {
  id: string;
  label: string;
  group: MoodGroup;
  blurb: string;
}

// A mood pick reuses the queue/background shape.
export type MoodFilm = QueueFilm;

export interface LovedDirector {
  name: string;
  avg_rating: number;
  seen: number;
}

export interface Blindspots {
  by_decade: Record<string, number>;
  decade_pct: Record<string, number>;
  under_watched_decades: number[];
  languages: Record<string, number>;
  genres: Record<string, number>;
  countries: Record<string, number>;
  loved_directors: LovedDirector[];
  director_seen_counts: Record<string, number>;
  total_watched: number;
  ratings_distribution: Record<string, number>;
}

export interface DirectorFilm {
  tmdb_id: number;
  title: string;
  year: string;
  poster: string | null;
  vote_average: number;
  vote_count: number;
  overview: string;
  seen: boolean;
  backdrop?: string | null;
}

export interface Director {
  id: number;
  total: number;
  seen: number;
  films: DirectorFilm[];
}

export interface RecentWatch {
  title: string;
  year: number;
  tmdb: number;
  last_watched: string;
  plays: number;
}

// Background film: same shape as QueueFilm plus rewatch/ambient metadata.
export interface BackgroundFilm extends QueueFilm {
  kind: "rewatch" | "new";
  letterboxd_rating?: number;
  last_watched?: string;
  plays?: number;
  user_review?: UserReview;
  pair_with?: PairWith;
}

export interface Slate {
  date: string; // "2026-05-30"
  weekday: string; // "Saturday"
  focus: QueueFilm[];
  background: BackgroundFilm[];
}

export interface AppData {
  user: User;
  generated_at: string;
  stats: Stats;
  blindspots: Blindspots;
  queue: QueueFilm[];
  directors: Record<string, Director>;
  watched_tmdb_set: number[];
  recent_watches: RecentWatch[];
  by_month: Record<string, number>;
  todays_pick: QueueFilm;
  slates: Slate[];
  background_pool: BackgroundFilm[];
  moods_meta: MoodMeta[];
  mood_picks: Record<string, MoodFilm[]>;
  // ---------- v4 (all optional) ----------
  version?: string;
  canon?: Canon;
  canon_meta?: { key: string; name: string }[];
  collections?: Collections;
  collections_meta?: CollectionMeta[];
  review_quotes?: Record<string, ReviewQuote>;
  director_quotes?: Record<string, ReviewQuote[]>;
  craft_dimensions?: CraftDimensions;
  pair_with?: Record<string, PairWith>;
  director_targets?: Record<string, DirectorTarget>;
  screenplays?: Screenplays;
  themed_weeks?: ThemedWeek[];
  // ---------- v4.1 (all optional) ----------
  tags?: Record<string, TagEntry>;
  diary_ratings?: Record<string, number>;
  diary_meta?: DiaryMeta;
  focus_pool_extra?: QueueFilm[];
}

// ---------- Loader (singleton) ----------
let cache: AppData | null = null;
let inflight: Promise<AppData> | null = null;

export function loadData(): Promise<AppData> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("./data.json")
    .then((r) => r.json())
    .then((d: AppData) => {
      cache = d;
      return d;
    });
  return inflight;
}

export function useAppData(): { data: AppData | null; loading: boolean } {
  const [data, setData] = useState<AppData | null>(cache);
  const [loading, setLoading] = useState(!cache);
  useEffect(() => {
    let alive = true;
    if (cache) {
      setData(cache);
      setLoading(false);
      return;
    }
    loadData().then((d) => {
      if (alive) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  return { data, loading };
}

// ---------- Poster index (tmdb_id -> poster path) ----------
let posterIndex: Map<number, string | null> | null = null;
export function getPosterIndex(d: AppData): Map<number, string | null> {
  if (posterIndex) return posterIndex;
  const m = new Map<number, string | null>();
  for (const q of d.queue) m.set(q.tmdb_id, q.poster);
  for (const name of Object.keys(d.directors)) {
    for (const f of d.directors[name].films) {
      if (!m.has(f.tmdb_id)) m.set(f.tmdb_id, f.poster);
    }
  }
  posterIndex = m;
  return m;
}

// ---------- Image helpers ----------
export function posterUrl(path: string | null | undefined, size = "w500"): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}
export function backdropUrl(path: string | null | undefined, size = "original"): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

// ---------- External action links ----------
export interface ActionLink {
  label: string;
  href: string;
  external: boolean; // open in new tab
}

export function actionLinks(opts: {
  tmdb_id: number;
  imdb_id?: string | null;
  title: string;
}): ActionLink[] {
  const q = encodeURIComponent(opts.title);
  const links: ActionLink[] = [];
  if (opts.imdb_id) {
    links.push({
      label: "Stremio",
      href: `stremio:///detail/movie/${opts.imdb_id}`,
      external: false,
    });
  }
  links.push({
    label: "Plex",
    href: `https://app.plex.tv/desktop#!/search?query=${q}`,
    external: true,
  });
  links.push({
    label: "Letterboxd",
    href: `https://letterboxd.com/tmdb/${opts.tmdb_id}/`,
    external: true,
  });
  links.push({
    label: "Trakt",
    href: `https://trakt.tv/search/tmdb/${opts.tmdb_id}?id_type=movie`,
    external: true,
  });
  links.push({
    label: "JustWatch",
    href: `https://www.justwatch.com/us/search?q=${q}`,
    external: true,
  });
  return links;
}

// ---------- TMDB / search links ----------
export function tmdbUrl(tmdb_id: number | null | undefined, title?: string): string {
  if (tmdb_id) return `https://www.themoviedb.org/movie/${tmdb_id}`;
  return `https://www.themoviedb.org/search?query=${encodeURIComponent(title || "")}`;
}
export function letterboxdTmdbUrl(tmdb_id: number): string {
  return `https://letterboxd.com/tmdb/${tmdb_id}/`;
}

// Slug a title for a Letterboxd film URL fallback.
export function letterboxdSlugUrl(title: string): string {
  const slug = (title || "")
    .toLowerCase()
    .replace(/[''’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://letterboxd.com/film/${slug}/`;
}

// Strip simple HTML tags (review snippets may contain <i> etc.).
export function stripHtml(s: string): string {
  return (s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// ---------- Formatting ----------
export function formatRuntime(min: number | undefined): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

// ---------- Date formatting ----------
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Parse "2026-05-30" without timezone drift.
function parseISO(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  return { y, m, d };
}

// "May 30"
export function formatMonthDay(date: string): string {
  const { m, d } = parseISO(date);
  return `${MONTHS[m - 1]} ${d}`;
}

// "May 30" (short month)
export function formatMonthDayShort(date: string): string {
  const { m, d } = parseISO(date);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const LANG_NAMES: Record<string, string> = {
  en: "English", ru: "Russian", fr: "French", ja: "Japanese", it: "Italian",
  de: "German", es: "Spanish", ko: "Korean", zh: "Chinese", sv: "Swedish",
  da: "Danish", pl: "Polish", cs: "Czech", fa: "Persian", hi: "Hindi",
  pt: "Portuguese", fi: "Finnish", no: "Norwegian", tr: "Turkish", nl: "Dutch",
  cn: "Chinese", xx: "No dialogue",
};
export function languageName(code: string): string {
  return LANG_NAMES[code] || code.toUpperCase();
}
