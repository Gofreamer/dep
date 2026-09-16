-- JET TCG 2.1 — Temporadas, histórico de pico e "currículo" de fim de temporada.
--
-- NUNCA edite 0001_ranked.sql (já publicada/aplicada): esta migration é
-- aditiva e idempotente ao extremo possível para D1/SQLite.
--   npx wrangler d1 migrations apply jet-league --local|--remote
--
-- O que entra:
--  * ranked_profiles: peak_rating / best_position / highest_rank / season_id
--    (campos que a UI de perfil promete exibir);
--  * seasons: a temporada passa a ser LIDA DO BANCO (S1 semeada aqui; S2 é
--    aberta por `ensureSeasons` quando o relógio passa da janela);
--  * season_results: linha por jogador na liquidação, com rating final/pico,
--    posição final/melhor, highest_rank, se foi REI DA LIGA e a melhor posição
--    que esse rei ocupou, além de vitórias/derrotas.

ALTER TABLE ranked_profiles ADD COLUMN peak_rating  INTEGER;
ALTER TABLE ranked_profiles ADD COLUMN best_position INTEGER;
ALTER TABLE ranked_profiles ADD COLUMN highest_rank  TEXT;
ALTER TABLE ranked_profiles ADD COLUMN season_id     TEXT;

-- Backfill: perfis existentes pertencem à Season 1; o pico de quem já tinha
-- rating é o próprio rating atual, e o melhor rank conhecido é o atual.
UPDATE ranked_profiles
   SET peak_rating = rating,
       highest_rank = rank,
       season_id = 'season-1'
 WHERE peak_rating IS NULL OR highest_rank IS NULL OR season_id IS NULL;

CREATE TABLE IF NOT EXISTS seasons (
  id              TEXT PRIMARY KEY,
  number          INTEGER NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  start_at        INTEGER NOT NULL,
  end_at          INTEGER NOT NULL,
  grace_after_end INTEGER NOT NULL DEFAULT 0,
  settled_at      INTEGER
);

CREATE TABLE IF NOT EXISTS season_results (
  season_id                TEXT NOT NULL,
  username                 TEXT NOT NULL,
  final_rating             INTEGER NOT NULL,
  peak_rating              INTEGER NOT NULL,
  final_position           INTEGER NOT NULL,
  best_position            INTEGER NOT NULL,
  highest_rank             TEXT NOT NULL,
  was_league_king          INTEGER NOT NULL DEFAULT 0,
  league_king_peak_position INTEGER,
  wins                     INTEGER NOT NULL DEFAULT 0,
  losses                   INTEGER NOT NULL DEFAULT 0,
  settled_at               INTEGER NOT NULL,
  PRIMARY KEY (season_id, username)
);
CREATE INDEX IF NOT EXISTS idx_season_results_pos ON season_results (season_id, final_position);

-- Semente da Season 1 (mesmos valores de `SEASON_1` em `src/ranked/seasons.ts`;
-- o teste de migração compara os dois para não deixar divergir).
-- Epoch ms literais: evita depender do parser de data do SQLite no D1.
-- OR IGNORE: se a temporada já foi liquidada/ajustada no banco, não apagamos.
INSERT OR IGNORE INTO seasons (id, number, name, start_at, end_at, grace_after_end, settled_at)
VALUES (
  'season-1',
  1,
  'Season 1',
  1789171200000,
  1797033599000,
  604800000,
  NULL
);
