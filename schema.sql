-- Cineprompt stateful store (Cloudflare D1 / SQLite). Single-user, gated by
-- Cloudflare Access. Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS film_state (
  tmdb_id      INTEGER PRIMARY KEY,
  status       TEXT,            -- 'shortlist' | 'watched' | 'dismissed' | NULL
  snooze_until TEXT,            -- 'YYYY-MM-DD'; "not tonight" hides it until then
  notes        TEXT,
  rating       INTEGER,         -- optional personal rating 1-10
  updated_at   INTEGER NOT NULL -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_film_state_status  ON film_state(status);
CREATE INDEX IF NOT EXISTS idx_film_state_updated ON film_state(updated_at);
