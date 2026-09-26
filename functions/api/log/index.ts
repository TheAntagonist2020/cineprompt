// /api/log — entries made in the Log app, waiting for (or done with) Letterboxd.
//
//   GET    /api/log        -> { entries: [...newest first], checks: [tmdb_id...] }
//   POST   /api/log        body: an entry (id optional) -> { entry }
//   DELETE /api/log?id=X   -> { ok: true }
//
// Letterboxd has no public write API, so the entry ends with Dalton pasting the
// review and tapping Log there. This table is what the app knows meanwhile:
//   draft        started, not finished
//   words_later  stars are in, the review is still to write
//   copied       review copied and Letterboxd opened
//   logged       confirmed logged on Letterboxd
//   check        not a watch: the title was only opened to check the Plex
//                library. Remembered so the app never asks about it again.

import { jsonError } from "../chat";

const STATUSES = new Set(["draft", "words_later", "copied", "logged", "check"]);
const MAX_TEXT = 20_000;

let schemaReady: Promise<void> | null = null;

export function ensureLogSchema(db: any): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch([
        db.prepare(
          `CREATE TABLE IF NOT EXISTS log_entries (
             id         TEXT PRIMARY KEY,
             tmdb_id    INTEGER,
             title      TEXT NOT NULL,
             year       TEXT,
             poster     TEXT,
             watched_on TEXT,
             stars      REAL,
             rewatch    INTEGER NOT NULL DEFAULT 0,
             liked      INTEGER NOT NULL DEFAULT 0,
             tags       TEXT,
             notes      TEXT,
             review     TEXT,
             status     TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             updated_at INTEGER NOT NULL
           )`,
        ),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_log_status ON log_entries(status, updated_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_log_tmdb ON log_entries(tmdb_id)"),
      ]);
    })();
    schemaReady.catch(() => {
      schemaReady = null;
    });
  }
  return schemaReady;
}

function rowOut(r: any) {
  let tags: string[] = [];
  try {
    tags = r.tags ? JSON.parse(r.tags) : [];
  } catch {}
  return { ...r, rewatch: !!r.rewatch, liked: !!r.liked, tags };
}

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export const onRequestGet = async (context: any) => {
  const db = context.env.DB;
  await ensureLogSchema(db);
  const { results } = await db
    .prepare("SELECT * FROM log_entries WHERE status != 'check' ORDER BY updated_at DESC LIMIT 200")
    .all();
  const { results: checks } = await db
    .prepare("SELECT DISTINCT tmdb_id FROM log_entries WHERE status = 'check' AND tmdb_id IS NOT NULL")
    .all();
  return Response.json({
    entries: (results ?? []).map(rowOut),
    checks: (checks ?? []).map((r: any) => r.tmdb_id),
  });
};

export const onRequestPost = async (context: any) => {
  const db = context.env.DB;
  await ensureLogSchema(db);
  const b = await context.request.json().catch(() => null);
  if (!b || typeof b !== "object") return jsonError(400, "entry is required");

  const title = str(b.title);
  if (!title) return jsonError(400, "title is required");
  const status = typeof b.status === "string" && STATUSES.has(b.status) ? b.status : "draft";
  const tmdb = Number.isInteger(b.tmdb_id) && b.tmdb_id > 0 ? b.tmdb_id : null;
  const stars =
    typeof b.stars === "number" && b.stars >= 0.5 && b.stars <= 5 && Number.isInteger(b.stars * 2) ? b.stars : null;
  const watchedOn = typeof b.watched_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.watched_on) ? b.watched_on : null;
  const tags = Array.isArray(b.tags)
    ? b.tags.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim().slice(0, 80)).slice(0, 20)
    : [];
  const notes = typeof b.notes === "string" ? b.notes.slice(0, MAX_TEXT) : null;
  const review = typeof b.review === "string" ? b.review.slice(0, MAX_TEXT) : null;
  const id = typeof b.id === "string" && /^[\w-]{8,64}$/.test(b.id) ? b.id : crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO log_entries (id, tmdb_id, title, year, poster, watched_on, stars, rewatch, liked, tags,
                                notes, review, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
       ON CONFLICT(id) DO UPDATE SET
         tmdb_id = excluded.tmdb_id, title = excluded.title, year = excluded.year, poster = excluded.poster,
         watched_on = excluded.watched_on, stars = excluded.stars, rewatch = excluded.rewatch,
         liked = excluded.liked, tags = excluded.tags, notes = excluded.notes, review = excluded.review,
         status = excluded.status, updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      tmdb,
      title,
      str(b.year, 8),
      str(b.poster),
      watchedOn,
      stars,
      b.rewatch ? 1 : 0,
      b.liked ? 1 : 0,
      JSON.stringify(tags),
      notes,
      review,
      status,
      now,
    )
    .run();
  const row = await db.prepare("SELECT * FROM log_entries WHERE id = ?").bind(id).first();
  return Response.json({ entry: rowOut(row) });
};

export const onRequestDelete = async (context: any) => {
  const db = context.env.DB;
  await ensureLogSchema(db);
  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return jsonError(400, "id is required");
  await db.prepare("DELETE FROM log_entries WHERE id = ?").bind(id).run();
  return Response.json({ ok: true });
};
