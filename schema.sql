-- Cineprompt stateful store (Cloudflare D1 / SQLite). Single-user, gated by
-- Cloudflare Access. Idempotent: safe to run repeatedly.
--
-- The Pages Function applies this itself on first use (functions/api/state.ts
-- `ensureSchema`), so running it by hand is optional:
--   npx wrangler@4 d1 execute cineprompt-db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS film_state (
  tmdb_id      INTEGER PRIMARY KEY,
  status       TEXT,            -- 'shortlist' | 'watched' | 'dismissed' | NULL
  snooze_until TEXT,            -- 'YYYY-MM-DD'; "not tonight" hides it until then
  notes        TEXT,
  rating       INTEGER,         -- optional personal rating 1-10
  updated_at   INTEGER NOT NULL, -- unix seconds
  -- snapshot of the film so a shortlisted title survives pool rebuilds
  title        TEXT,
  year         TEXT,
  poster       TEXT,
  imdb_id      TEXT,
  directors    TEXT,            -- JSON array
  runtime      INTEGER,
  reasons      TEXT             -- JSON array
);

CREATE INDEX IF NOT EXISTS idx_film_state_status  ON film_state(status);
CREATE INDEX IF NOT EXISTS idx_film_state_updated ON film_state(updated_at);
