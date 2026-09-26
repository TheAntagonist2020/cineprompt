/**
 * film-memory — everything Dalton has watched, as one plain-text document the
 * /api/chat function hands Claude as its (cached) system context.
 *
 * Built from data.json on every build, downstream of the pipeline like the
 * shards. It folds together every place a watch is recorded: the Letterboxd
 * profile mirror (films + dated diary), the export-era diary ratings and
 * review snippets and the personal tags with their watch dates. Letterboxd
 * only: Trakt plays are not watches here (see below). One line per film,
 * newest watch first.
 */

type Film = {
  title: string;
  year: string;
  tmdb?: number;
  rating?: number;
  dates: Set<string>;
  rewatchDates: Set<string>;
  plays: number;
  tags: Set<string>;
  director?: string;
  review?: { text: string; date?: string };
};

function yearStr(y: unknown): string {
  if (y === null || y === undefined) return "";
  let s = String(y).trim();
  if (s.endsWith(".0")) s = s.slice(0, -2);
  return /^\d+$/.test(s) && Number(s) > 0 ? s : "";
}

function splitKey(key: string): [string, string] {
  const i = key.lastIndexOf("|");
  return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

const DATE = /^\d{4}-\d{2}-\d{2}/;
const day = (d: unknown) => (typeof d === "string" && DATE.test(d) ? d.slice(0, 10) : undefined);

// Letterboxd ratings are 0.5-5 stars; 0 means "no rating".
const stars = (r: unknown) => (typeof r === "number" && r > 0 && r <= 5 ? r : undefined);

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function buildFilmMemory(data: any): string {
  const films = new Map<string, Film>();
  const byTmdb = new Map<number, Film>();

  const get = (title: unknown, year: unknown, tmdb?: unknown): Film | null => {
    const t = typeof title === "string" ? title.trim() : "";
    const id = typeof tmdb === "number" && tmdb > 0 ? tmdb : undefined;
    if (id && byTmdb.has(id)) return byTmdb.get(id)!;
    if (!t) return null;
    const y = yearStr(year);
    const key = `${t.toLowerCase()}|${y}`;
    let f = films.get(key);
    if (!f) {
      f = { title: t, year: y, dates: new Set(), rewatchDates: new Set(), plays: 0, tags: new Set() };
      films.set(key, f);
    }
    if (id && !f.tmdb) {
      f.tmdb = id;
      byTmdb.set(id, f);
    }
    return f;
  };

  const profile = data.letterboxd_profile ?? {};
  for (const row of profile.films ?? []) {
    const [title, year, tmdb, rating, last, plays] = row;
    const f = get(title, year, tmdb);
    if (!f) continue;
    f.rating = stars(rating) ?? f.rating;
    const d = day(last);
    if (d) f.dates.add(d);
    if (typeof plays === "number") f.plays = Math.max(f.plays, plays);
  }
  for (const row of profile.diary ?? []) {
    const [date, title, year, tmdb, rating, rewatch] = row;
    const f = get(title, year, tmdb);
    if (!f) continue;
    const d = day(date);
    if (d) {
      f.dates.add(d);
      if (rewatch) f.rewatchDates.add(d);
    }
    f.rating ??= stars(rating);
  }

  for (const [key, rating] of Object.entries<any>(data.diary_ratings ?? {})) {
    const [title, year] = splitKey(key);
    const f = get(title, year);
    if (f) f.rating ??= stars(rating);
  }

  for (const [key, q] of Object.entries<any>(data.review_quotes ?? {})) {
    const [title, year] = splitKey(key);
    const f = get(q?.title ?? title, q?.year ?? year);
    if (!f) continue;
    f.rating ??= stars(q?.rating);
    const d = day(q?.date);
    if (d) f.dates.add(d);
    const text = typeof q?.snippet === "string" ? q.snippet.replace(/\s+/g, " ").trim() : "";
    if (text && (!f.review || (d && (!f.review.date || d > f.review.date)))) {
      f.review = { text, date: d };
    }
  }

  for (const [tag, entry] of Object.entries<any>(data.tags ?? {})) {
    for (const tf of entry?.films ?? []) {
      const f = get(tf?.title, tf?.year);
      if (!f) continue;
      f.tags.add(tag);
      f.rating ??= stars(tf?.rating);
      const d = day(tf?.watched_date);
      if (d) f.dates.add(d);
      if (!f.director && typeof tf?.director === "string" && tf.director) {
        f.director = titleCase(tf.director);
      }
    }
  }

  // Trakt is deliberately left out (recent_watches, watched_tmdb_set): Stremio
  // scrobbles a title whenever it is opened to check the Plex library, so a
  // Trakt play is not evidence of a watch. Directors only label films the
  // diary already has.
  for (const [name, d] of Object.entries<any>(data.directors ?? {})) {
    for (const df of d?.films ?? []) {
      if (typeof df?.tmdb_id !== "number" || !df.title) continue;
      const f = byTmdb.get(df.tmdb_id) ?? films.get(`${String(df.title).toLowerCase()}|${yearStr(df.year)}`);
      if (f) f.director ??= name;
    }
  }

  const all = [...films.values()];
  const newest = (f: Film) => [...f.dates].sort().at(-1) ?? "";
  all.sort((a, b) => newest(b).localeCompare(newest(a)) || a.title.localeCompare(b.title));

  const lines = all.map((f) => {
    const parts = [`${f.title}${f.year ? ` (${f.year})` : ""}`];
    if (f.director) parts.push(`dir. ${f.director}`);
    if (f.rating) parts.push(`${f.rating}★`);
    // The export's watch date and log date often differ by a day, so one
    // viewing shows up twice; a flagged rewatch is always kept.
    const dates: string[] = [];
    for (const d of [...f.dates].sort()) {
      const prev = dates.at(-1);
      const adjacent = prev && Date.parse(d) - Date.parse(prev) <= 86_400_000;
      if (adjacent && !f.rewatchDates.has(d)) continue;
      dates.push(d);
    }
    if (dates.length) {
      parts.push(
        "watched " + dates.map((d) => (f.rewatchDates.has(d) ? `${d} (rewatch)` : d)).join(", "),
      );
    }
    if (f.plays > Math.max(1, dates.length)) parts.push(`${f.plays} plays`);
    if (f.tags.size) parts.push(`tags: ${[...f.tags].join(", ")}`);
    if (f.review) parts.push(`review: "${f.review.text}"`);
    return parts.join(" | ");
  });

  const dated = all.filter((f) => f.dates.size);
  const rated = all.filter((f) => f.rating);
  const header = [
    `# ${data.user?.name ?? "The viewer"}'s film memory`,
    `Letterboxd: ${data.user?.letterboxd ?? "?"}. Built ${String(data.generated_at ?? "").slice(0, 10) || "unknown"}.`,
    `${all.length} films known by title (${dated.length} with watch dates, ${rated.length} rated).`,
    `${data.diary_meta?.total_entries ?? "?"} Letterboxd diary entries in all.`,
    `Diary entries per year (Letterboxd): ${Object.entries<any>(data.diary_meta?.by_year ?? {})
      .map(([y, n]) => `${y}: ${n}`)
      .join(", ")}.`,
    "",
    "Only the Letterboxd diary counts as a watch. Trakt is left out on purpose: Stremio scrobbles a title to Trakt whenever it is opened to check the Plex library, so Trakt plays are mostly not real viewings.",
    "One film per line, most recently watched first; films with no known date are at the end.",
    "Fields: Title (Year) | dir. Director | Letterboxd stars (0.5-5) | watch dates | tags (the viewer's own Letterboxd tags: where, with whom, which marathon) | review (the viewer's own words, first ~280 characters).",
    "",
  ];
  return header.concat(lines).join("\n") + "\n";
}
