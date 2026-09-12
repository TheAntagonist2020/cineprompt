// /api/state — the single user's film state (Cloudflare D1).
//
//   GET  -> { films: [{ tmdb_id, status, snooze_until, notes, rating, updated_at,
//                       title, year, poster, imdb_id, directors, runtime, reasons }] }
//   POST -> body { tmdb_id, status?, snooze_until?, notes?, rating?, film? }
//           (partial upsert; `film` is a snapshot {title, year, poster, imdb_id,
//           directors[], runtime, reasons[]} so a shortlisted film survives the
//           twice-daily rebuild that may drop it from every pool)
//
// The schema is applied here, on first use, rather than by a deploy step: the
// original schema.sql was never run against the production database, which is
// why the app had nothing to persist to. CREATE IF NOT EXISTS + ADD COLUMN for
// anything missing, once per isolate, so this can never regress.

const COLUMNS: Array<[string, string]> = [
  ["title", "TEXT"],
  ["year", "TEXT"],
  ["poster", "TEXT"],
  ["imdb_id", "TEXT"],
  ["directors", "TEXT"], // JSON array
  ["runtime", "INTEGER"],
  ["reasons", "TEXT"], // JSON array
];

let schemaReady: Promise<void> | null = null;

export async function ensureSchema(db: any): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS film_state (
             tmdb_id      INTEGER PRIMARY KEY,
             status       TEXT,
             snooze_until TEXT,
             notes        TEXT,
             rating       INTEGER,
             updated_at   INTEGER NOT NULL
           )`,
        )
        .run();
      const { results } = await db.prepare("PRAGMA table_info(film_state)").all();
      const have = new Set((results ?? []).map((r: any) => String(r.name)));
      for (const [name, type] of COLUMNS) {
        if (!have.has(name)) {
          await db.prepare(`ALTER TABLE film_state ADD COLUMN ${name} ${type}`).run();
        }
      }
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_film_state_status ON film_state(status)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_film_state_updated ON film_state(updated_at)").run();
    })().catch((err) => {
      schemaReady = null; // retry on the next request rather than caching a failure
      throw err;
    });
  }
  return schemaReady;
}

function noDb(env: any): Response | null {
  if (env?.DB) return null;
  return new Response(
    JSON.stringify({ error: "D1 binding `DB` is missing on the Pages project (see DEPLOY.md)" }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}

function parseJsonArray(v: unknown): string[] | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(String) : null;
  } catch {
    return null;
  }
}

export const onRequestGet = async (context: any) => {
  const missing = noDb(context.env);
  if (missing) return missing;
  await ensureSchema(context.env.DB);
  const { results } = await context.env.DB.prepare(
    `SELECT tmdb_id, status, snooze_until, notes, rating, updated_at,
            title, year, poster, imdb_id, directors, runtime, reasons
       FROM film_state`,
  ).all();
  const films = (results ?? []).map((r: any) => ({
    ...r,
    directors: parseJsonArray(r.directors),
    reasons: parseJsonArray(r.reasons),
  }));
  return Response.json({ films });
};

export const onRequestPost = async (context: any) => {
  const missing = noDb(context.env);
  if (missing) return missing;
  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const id = Number(body?.tmdb_id);
  if (!Number.isFinite(id) || id <= 0) return badRequest("tmdb_id required");
  await ensureSchema(context.env.DB);

  // Merge: a field present in the body overrides; otherwise keep the stored
  // value. `'key' in body` lets the client clear a field by sending null.
  const cur: any = await context.env.DB
    .prepare("SELECT * FROM film_state WHERE tmdb_id = ?")
    .bind(id)
    .first();
  const pick = (k: string) => (k in body ? body[k] : cur ? cur[k] : null);
  const status = pick("status") ?? null;
  const snooze_until = pick("snooze_until") ?? null;
  const notes = pick("notes") ?? null;
  const rating = pick("rating") ?? null;

  // The snapshot only ever fills in — a later write without `film` keeps it.
  const film = body.film && typeof body.film === "object" ? body.film : null;
  const snap = (k: string, fallback: any) => (film && film[k] != null ? film[k] : fallback);
  const title = snap("title", cur?.title ?? null);
  const year = snap("year", cur?.year ?? null);
  const poster = snap("poster", cur?.poster ?? null);
  const imdb_id = snap("imdb_id", cur?.imdb_id ?? null);
  const runtime = snap("runtime", cur?.runtime ?? null);
  const directors = film && Array.isArray(film.directors) ? JSON.stringify(film.directors) : cur?.directors ?? null;
  const reasons = film && Array.isArray(film.reasons) ? JSON.stringify(film.reasons.slice(0, 4)) : cur?.reasons ?? null;

  await context.env.DB.prepare(
    `INSERT INTO film_state (tmdb_id, status, snooze_until, notes, rating, updated_at,
                             title, year, poster, imdb_id, directors, runtime, reasons)
     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch(), ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       status = ?2, snooze_until = ?3, notes = ?4, rating = ?5, updated_at = unixepoch(),
       title = ?6, year = ?7, poster = ?8, imdb_id = ?9, directors = ?10, runtime = ?11, reasons = ?12`,
  )
    .bind(id, status, snooze_until, notes, rating,
          title, year == null ? null : String(year), poster, imdb_id, directors,
          runtime == null ? null : Number(runtime), reasons)
    .run();

  return Response.json({ ok: true, updated_at: Math.floor(Date.now() / 1000) });
};

function badRequest(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
