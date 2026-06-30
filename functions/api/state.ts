// /api/state — read and write the single user's film state (D1).
//   GET  -> { films: [{ tmdb_id, status, snooze_until, notes, rating, updated_at }] }
//   POST -> body { tmdb_id, status?, snooze_until?, notes?, rating? } (partial; upsert)

export const onRequestGet = async (context: any) => {
  const { results } = await context.env.DB.prepare(
    "SELECT tmdb_id, status, snooze_until, notes, rating, updated_at FROM film_state"
  ).all();
  return Response.json({ films: results ?? [] });
};

export const onRequestPost = async (context: any) => {
  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const id = Number(body?.tmdb_id);
  if (!Number.isFinite(id) || id <= 0) return badRequest("tmdb_id required");

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

  await context.env.DB.prepare(
    `INSERT INTO film_state (tmdb_id, status, snooze_until, notes, rating, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
     ON CONFLICT(tmdb_id) DO UPDATE SET
       status = ?2, snooze_until = ?3, notes = ?4, rating = ?5, updated_at = unixepoch()`
  ).bind(id, status, snooze_until, notes, rating).run();

  return Response.json({ ok: true });
};

function badRequest(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
