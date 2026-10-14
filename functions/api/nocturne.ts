// /api/nocturne — modulated October marathons and private formalist notes.
//
//   POST { mode: "marathon" | "critic", prompt?, film?, notes?, subtitlesOffOnly?, pool? }
//     -> JSON. Never 500s: a missing key or a model failure returns the same
//        shape with source: "fallback".
//
// Uses ANTHROPIC_API_KEY, the same secret Talk and the Log draft use.

import { claudeClient, REQUEST } from "./chat";

const ESSENTIALS = [
  { tmdbId: 30497, title: "The Texas Chain Saw Massacre", year: "1974", runtime: 83, directors: ["Tobe Hooper"], imdbId: "tt0072271", language: "en", genres: ["Horror"], atmospheric: false, fiveStar: false },
  { tmdbId: 11906, title: "Suspiria", year: "1977", runtime: 99, directors: ["Dario Argento"], imdbId: "tt0076786", language: "it", genres: ["Horror"], atmospheric: true, fiveStar: false },
  { tmdbId: 16307, title: "The Wicker Man", year: "1973", runtime: 88, directors: ["Robin Hardy"], imdbId: "tt0070917", language: "en", genres: ["Horror", "Mystery"], atmospheric: false, fiveStar: false },
  { tmdbId: 460885, title: "Mandy", year: "2018", runtime: 121, directors: ["Panos Cosmatos"], imdbId: "tt6998518", language: "en", genres: ["Horror", "Thriller"], atmospheric: true, fiveStar: false },
  { tmdbId: 837, title: "Videodrome", year: "1983", runtime: 89, directors: ["David Cronenberg"], imdbId: "tt0086541", language: "en", genres: ["Horror"], atmospheric: false, fiveStar: false },
  { tmdbId: 36095, title: "Cure", year: "1997", runtime: 111, directors: ["Kiyoshi Kurosawa"], imdbId: "tt0123948", language: "ja", genres: ["Horror", "Mystery"], atmospheric: false, fiveStar: false },
];

type Slim = {
  tmdbId?: number;
  title?: string;
  year?: string;
  runtime?: number;
  directors?: string[];
  imdbId?: string | null;
  language?: string;
  genres?: string[];
  atmospheric?: boolean;
  fiveStar?: boolean;
  rating?: number | null;
};

function ok(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function asFilm(raw: Slim, index: number): Required<Pick<Slim, "title" | "year" | "runtime" | "directors" | "language" | "genres">> & Slim {
  return {
    tmdbId: typeof raw.tmdbId === "number" ? raw.tmdbId : index,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Untitled",
    year: typeof raw.year === "string" ? raw.year : "",
    runtime: typeof raw.runtime === "number" ? raw.runtime : 0,
    directors: Array.isArray(raw.directors) ? raw.directors.filter((d) => typeof d === "string").slice(0, 4) : [],
    imdbId: typeof raw.imdbId === "string" ? raw.imdbId : null,
    language: typeof raw.language === "string" ? raw.language.toLowerCase() : "",
    genres: Array.isArray(raw.genres) ? raw.genres.filter((g) => typeof g === "string").slice(0, 6) : [],
    atmospheric: Boolean(raw.atmospheric),
    fiveStar: Boolean(raw.fiveStar) || (typeof raw.rating === "number" && raw.rating >= 4.75),
    rating: typeof raw.rating === "number" ? raw.rating : null,
  };
}

function poolFrom(body: any): ReturnType<typeof asFilm>[] {
  const incoming = Array.isArray(body?.pool) ? body.pool.slice(0, 60).map(asFilm) : [];
  const seen = new Set(incoming.map((film) => film.imdbId || film.title));
  const extras = ESSENTIALS.filter((film) => !seen.has(film.imdbId)).map((film, index) => asFilm(film, index));
  return [...incoming, ...extras];
}

function usable(films: ReturnType<typeof asFilm>[], subtitlesOff: boolean) {
  const filtered = films.filter((film) => !subtitlesOff || film.language === "en" || film.atmospheric);
  const october = filtered.filter((film) => {
    const genres = (film.genres || []).map((g) => g.toLowerCase());
    return genres.some((g) => g === "horror" || g === "thriller" || g === "mystery") || film.atmospheric;
  });
  return (october.length ? october : filtered.length ? filtered : films).slice(0, 40);
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function modulation(prev: { title: string; year?: string; runtime?: number; atmospheric?: boolean } | null, next: ReturnType<typeof asFilm>) {
  if (!prev) {
    return `Baseline. ${next.year || "Undated"} ${(next.genres || [])[0] || "picture"}, ${next.runtime || "untimed"} minutes. Everything after this pivots off this tempo.`;
  }
  const delta = (next.runtime || 0) - (prev.runtime || 0);
  const tempo = delta > 15 ? "the cut-rate slows" : delta < -15 ? "the cut-rate jumps" : "the tempo holds";
  const era = prev.year && next.year && prev.year.slice(0, 3) !== next.year.slice(0, 3)
    ? `the era shifts from ${prev.year} to ${next.year}`
    : "both films sit in the same stretch of years";
  const acoustic = next.atmospheric && !prev.atmospheric
    ? "the sound design takes over from dialogue"
    : !next.atmospheric && prev.atmospheric
      ? "speech comes back in after a passage of score"
      : "the acoustic mood stays in the same register";
  return `From ${prev.title}: ${tempo}, ${era}, and ${acoustic}.`;
}

export function fallbackMarathon(body: any) {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const subtitlesOff = Boolean(body?.subtitlesOffOnly);
  const all = poolFrom(body).filter((film) => !subtitlesOff || film.language === "en" || film.atmospheric);
  const films = usable(all, false);
  const offset = hash(prompt.toLowerCase() || "october");
  const fives = all.filter((film) => film.fiveStar);
  const rest = films.filter((film) => !film.fiveStar);
  const used = new Set<string>();
  const take = (list: typeof films, count: number, start: number) => {
    const out = [];
    for (let i = 0; i < list.length && out.length < count; i++) {
      const film = list[(start + i) % list.length];
      const key = film.imdbId || film.title;
      if (used.has(key)) continue;
      used.add(key);
      out.push(film);
    }
    return out;
  };
  const mysteryCount = fives.length >= 2 ? 2 : fives.length ? 1 : 0;
  const mysteries = take(fives, mysteryCount, offset);
  const openers = take(rest.length ? rest : films, 4 - mysteries.length, offset >>> 3);
  const ordered: Array<{ film: (typeof films)[number]; mystery: boolean }> = [];
  let vi = 0;
  let mi = 0;
  for (let i = 0; i < 4; i++) {
    const wantMystery = mi < mysteries.length && (i === 1 || (i === 3 && mysteries.length > 1));
    if (wantMystery) ordered.push({ film: mysteries[mi++], mystery: true });
    else if (vi < openers.length) ordered.push({ film: openers[vi++], mystery: false });
  }
  let prev: (typeof films)[number] | null = null;
  const slots = ordered.map((slot, index) => {
    let note = modulation(prev, slot.film);
    if (index === 0 && prompt) note = `Request: ${prompt}. ${note}`;
    prev = slot.film;
    const director = slot.film.directors?.[0] || "the director";
    return {
      film: slot.film,
      modulation: note,
      mystery: slot.mystery,
      freshEyes: slot.mystery
        ? `Fresh eyes: watch ${slot.film.title} as if the five stars belonged to someone else. Name one cut ${director} still gets past you, and one sound you had filed as memory instead of design.`
        : "",
    };
  });
  return { source: "fallback" as const, mode: "marathon" as const, slots };
}

export function fallbackCritic(body: any) {
  const film = asFilm(body?.film ?? ESSENTIALS[0], 0);
  const notes = typeof body?.notes === "string" ? body.notes.trim() : typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const director = film.directors[0] || "the camera";
  const spoken = notes || "No notes yet. The study stays inside the frame and does not invent a reaction.";
  const minutes = film.runtime ? `${film.runtime} minutes` : "the running time on the case";
  return {
    source: "fallback" as const,
    mode: "critic" as const,
    camera: `Camera & blocking. ${director} on ${film.title}${film.year ? ` (${film.year})` : ""}. ${spoken}`,
    sound: `Sound & score. Separate what ${film.title} says from what it plays. ${film.atmospheric ? "This one can live with the subtitles off, so the mix is the sentence." : "Mark the sound that is not dialogue."} ${notes ? `From the seat: ${notes}` : ""}`.trim(),
    pacing: `Pacing. ${minutes}. Note where ${film.title} holds and where it cuts, using only what was written. ${notes ? `Your read: ${notes}` : "Nothing written yet, so the pace note stays blank of plot."}`,
    letterboxd: notes || `${film.title}. Formalist note still to write.`,
  };
}

function parseJson(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function complete(env: any, system: string, ask: string): Promise<string> {
  const client = claudeClient(env);
  let text = "";
  const stream = client.beta.messages.stream({
    ...REQUEST,
    betas: [...REQUEST.betas],
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: ask }],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") text += event.delta.text;
  }
  await stream.finalMessage();
  return text;
}

const SYSTEM = `You are inside Cineprompt, Dalton's private film app. Write only for that app. No publication name, no column, no outlet. Formalist notes stay with blocking, light, cutting, and sound. Do not invent a plot point or a personal reaction that was not in the request. Reply with one JSON object and no markdown.`;

export const onRequestPost = async (context: any) => {
  let body: any = null;
  try {
    body = await context.request.json();
  } catch {
    body = null;
  }
  const mode = body?.mode === "critic" ? "critic" : body?.mode === "marathon" ? "marathon" : "";
  if (!mode) return ok({ source: "fallback", error: "mode must be marathon or critic", slots: fallbackMarathon({}).slots });

  const fallback = mode === "critic" ? fallbackCritic(body) : fallbackMarathon(body);
  if (!context.env?.ANTHROPIC_API_KEY) return ok(fallback);

  try {
    const ask =
      mode === "marathon"
        ? `Build a 4-film October arc from this pool only. Weave 1 or 2 films whose fiveStar is true into mystery rewatch slots. Each slot needs modulation (how tempo, lighting, era, or acoustic mood pivots from the previous film) and, for mystery slots, freshEyes. Honor subtitlesOffOnly. Request: ${String(body?.prompt || "").slice(0, 2000)}\nPool: ${JSON.stringify(usable(poolFrom(body), Boolean(body?.subtitlesOffOnly))).slice(0, 12000)}\nShape: {"slots":[{"film":{"title":"","year":"","imdbId":"","tmdbId":0,"directors":[],"runtime":0},"modulation":"","mystery":false,"freshEyes":""}]}`
        : `Turn these raw notes into a private 3-part craft study and a plain-text Letterboxd log. Use only the notes. Film: ${JSON.stringify(body?.film || {}).slice(0, 2000)}\nNotes: ${String(body?.notes || body?.prompt || "").slice(0, 8000)}\nShape: {"camera":"","sound":"","pacing":"","letterboxd":""}`;
    const parsed = parseJson(await complete(context.env, SYSTEM, ask));
    if (mode === "marathon" && Array.isArray(parsed?.slots) && parsed.slots.length) {
      return ok({ ...fallbackMarathon({ ...body, pool: [] }), ...parsed, source: "claude", mode: "marathon", slots: parsed.slots.slice(0, 4) });
    }
    if (mode === "critic" && parsed?.camera && parsed?.sound && parsed?.pacing && parsed?.letterboxd) {
      return ok({ source: "claude", mode: "critic", camera: String(parsed.camera), sound: String(parsed.sound), pacing: String(parsed.pacing), letterboxd: String(parsed.letterboxd) });
    }
    return ok(fallback);
  } catch {
    return ok(fallback);
  }
};
