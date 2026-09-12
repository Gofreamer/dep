-- JET TCG 2.0 — Liga Ranqueada: contas, sessões, perfis e partidas.
-- D1 (Cloudflare). Aplicada no primeiro deploy com `npx wrangler d1 execute`.

CREATE TABLE IF NOT EXISTS accounts (
  username    TEXT PRIMARY KEY,
  salt        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions (username);

CREATE TABLE IF NOT EXISTS ranked_profiles (
  username    TEXT PRIMARY KEY,
  rating      INTEGER NOT NULL DEFAULT 1000,
  rank        TEXT NOT NULL DEFAULT 'FERRO',
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  is_bot      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ranked_matches (
  ranked_match_id  TEXT PRIMARY KEY,
  season_id        TEXT NOT NULL,
  player_a         TEXT NOT NULL,
  player_b         TEXT NOT NULL,
  winner           TEXT NOT NULL,
  a_delta          INTEGER NOT NULL,
  b_delta          INTEGER NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_season ON ranked_matches (season_id);
