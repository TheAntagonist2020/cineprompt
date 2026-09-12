// /api/state — the single user's film state (Cloudflare D1).
//
//   GET  -> { films: [{ tmdb_id, status, snooze_until, notes, rating, updated_at,
//                       title, year, poster, imdb_id, directors, runtime, reasons }] }
//           (rows with live state only; cleared rows stay as tombstones, see below)
//   POST -> body { tmdb_id, status?, snooze_until?, notes?, rating?, film?, updated_at? }
//
// Concurrency model, in one paragraph: `updated_at` is the client's write time
// in milliseconds and is the row's revision. The upsert is conditional on
// `excluded.updated_at >= film_state.updated_at`, so a stale write (a phone
// reconnecting after a night offline, or two taps whose requests land out of
// order) changes nothing and gets 409 with the current row, which the client
// adopts. A write that leaves no state at all (every field null) does not
// delete the row: it keeps it as a tombstone with that revision, so an even
// older write cannot resurrect the cleared choice. GET filters tombstones out.
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

// A row that still says something. Everything else is a tombstone.
const LIVE = "(status IS NOT NULL OR snooze_until IS NOT NULL OR notes IS NOT NULL OR rating IS NOT NULL)";

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

export async function liveRowCount(db: any): Promise<number> {
  const row: any = await db.prepare(`SELECT COUNT(*) AS n FROM film_state WHERE ${LIVE}`).first();
  return Number(row?.n ?? 0);
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

// Revisions are milliseconds. A value that small can only be seconds (rows
// written before this precision existed); lift it so comparisons stay sane.
function asMillis(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e11 ? n * 1000 : n;
}

function rowOut(r: any) {
  return {
    ...r,
    updated_at: asMillis(r.updated_at),
    directors: parseJsonArray(r.directors),
    reasons: parseJsonArray(r.reasons),
  };
}

export const onRequestGet = async (context: any) => {
  const missing = noDb(context.env);
  if (missing) return missing;
  await ensureSchema(context.env.DB);
  const { results } = await context.env.DB.prepare(
    `SELECT tmdb_id, status, snooze_until, notes, rating, updated_at,
            title, year, poster, imdb_id, directors, runtime, reasons
       FROM film_state WHERE ${LIVE}`,
  ).all();
  return Response.json({ films: (results ?? []).map(rowOut) });
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
  if (!Number.isInteger(id) || id <= 0) return badRequest("tmdb_id must be a positive integer");
  const db = context.env.DB;
  await ensureSchema(db);

  const incoming = asMillis(body.updated_at) || Date.now();

  // Merge: a field present in the body overrides; otherwise keep the stored
  // value. `'key' in body` lets the client clear a field by sending null.
  // (The read is advisory; the write below is what decides who wins.)
  const cur: any = await db.prepare("SELECT * FROM film_state WHERE tmdb_id = ?").bind(id).first();
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

  // Conditional upsert: the row only changes if this write is at least as new
  // as what is stored. `changes` tells us whether it did.
  const res = await db
    .prepare(
      `INSERT INTO film_state (tmdb_id, status, snooze_until, notes, rating, updated_at,
                               title, year, poster, imdb_id, directors, runtime, reasons)
       VALUES (?1, ?2, ?3, ?4, ?5, ?13, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(tmdb_id) DO UPDATE SET
         status = excluded.status, snooze_until = excluded.snooze_until,
         notes = excluded.notes, rating = excluded.rating, updated_at = excluded.updated_at,
         title = excluded.title, year = excluded.year, poster = excluded.poster,
         imdb_id = excluded.imdb_id, directors = excluded.directors,
         runtime = excluded.runtime, reasons = excluded.reasons
       WHERE excluded.updated_at >= film_state.updated_at`,
    )
    .bind(id, status, snooze_until, notes, rating,
          title, year == null ? null : String(year), poster, imdb_id, directors,
          runtime == null ? null : Number(runtime), reasons, incoming)
    .run();

  if (!res?.meta || Number(res.meta.changes) === 0) {
    // Lost to a newer revision: hand it back so the client can adopt it.
    const now: any = await db.prepare("SELECT * FROM film_state WHERE tmdb_id = ?").bind(id).first();
    return new Response(JSON.stringify({ stale: true, film: now ? rowOut(now) : null }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }
  const cleared = status == null && snooze_until == null && notes == null && rating == null;
  return Response.json({ ok: true, deleted: cleared, updated_at: incoming });
};

function badRequest(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
