/**
 * SEASONS — temporadas da Liga Ranqueada JET.
 *
 * A temporada é LIDA DO BANCO (`RankedRepo.listSeasons`), não de constante: a
 * UI e o worker precisam da mesma resposta depois de um deploy que liquide a
 * Season 1 e abra a Season 2. As constantes abaixo só existem como semente da
 * migração/bootstrap (`ensureSeasons`) e como fallback de dev — ver
 * `activeSeason(repo)`, que é o que as rotas usam.
 *
 * Janelas:
 *  - `startAt..endAt`       → competição ativa (rating muda)
 *  - `endAt..endAt+graça`   → liquidação: resultados enviados ainda contam
 *                             para a temporada, mas nada novo é aceito depois
 *                             do fim "cheio" se a próxima já abriu
 *  - depois da graça        → congelada; histórico em `season_results`
 */

import type { RankedRepo, SeasonRow } from './repo';

export interface Season {
  id: string;
  number: number;
  name: string;
  startAt: number;
  endAt: number;
  /** Janela de graça após o fim (ms) — resultados ainda contam. */
  graceAfterEnd: number;
  /** Momento da liquidação (null = ainda em aberto). */
  settledAt?: number | null;
}

const DAY = 24 * 60 * 60 * 1000;

export const SEASON_1: Season = {
  id: 'season-1',
  number: 1,
  name: 'Season 1',
  // Temporada 1: janela de 90 dias a partir do lançamento (2026-09-12).
  startAt: Date.UTC(2026, 8, 12, 0, 0, 0),
  endAt: Date.UTC(2026, 11, 11, 23, 59, 59),
  graceAfterEnd: 7 * DAY
};

/** Temporada seguinte (`startAt` = fim da anterior + 1 dia de transição). */
export function nextSeasonOf(prev: Season): Season {
  const start = prev.endAt + DAY;
  return {
    id: `season-${prev.number + 1}`,
    number: prev.number + 1,
    name: `Season ${prev.number + 1}`,
    startAt: start,
    endAt: start + 90 * DAY,
    graceAfterEnd: 7 * DAY,
    settledAt: null
  };
}

export type SeasonStatus = 'pending' | 'active' | 'grace' | 'closed';

export function seasonStatus(season: Season, now = Date.now()): SeasonStatus {
  if (now < season.startAt) return 'pending';
  if (now <= season.endAt) return 'active';
  if (now <= season.endAt + season.graceAfterEnd) return 'grace';
  return 'closed';
}

/** Uma partida ranqueada só é aceita na janela ativa ou de graça. */
export function seasonAcceptsMatch(season: Season, now = Date.now()): boolean {
  const st = seasonStatus(season, now);
  return st === 'active' || st === 'grace';
}

/** Compat com a 2.0 (fallback quando não há banco). */
export function currentSeason(now = Date.now()): Season | null {
  return seasonAcceptsMatch(SEASON_1, now) ? SEASON_1 : null;
}

// ---------------------------------------------------------------------------
// Acesso via repositório
// ---------------------------------------------------------------------------

export function toSeason(row: SeasonRow): Season {
  return {
    id: row.id, number: row.number, name: row.name,
    startAt: row.startAt, endAt: row.endAt, graceAfterEnd: row.graceAfterEnd,
    settledAt: row.settledAt ?? null
  };
}

/**
 * Garante que a Season 1 existe no banco (bootstrap idempotente). Chamado pelo
 * worker em `seedBots`/`scheduled` — nunca sobrescreve uma temporada existente.
 */
export async function ensureSeasons(repo: RankedRepo, now = Date.now()): Promise<SeasonRow[]> {
  const existing = await repo.listSeasons();
  if (!existing.some((s) => s.id === SEASON_1.id)) { // nunca sobrescreve a que o banco já tem
    await repo.upsertSeason({ ...SEASON_1, settledAt: null });
  }
  // Se o relógio já passou do fim da última temporada persistida, abre a
  // próxima (bootstrap "S2"): é isto que mantém a liga viva entre deploy.
  const seasons = await repo.listSeasons();
  const last = seasons[seasons.length - 1];
  if (last && now > last.endAt + last.graceAfterEnd) {
    const nxt = nextSeasonOf(toSeason(last));
    if (!seasons.some((s) => s.id === nxt.id)) await repo.upsertSeason({ ...nxt, settledAt: null });
  }
  return repo.listSeasons();
}

/** Temporada vigente segundo o banco (null = nenhuma janela aberta). */
export async function activeSeason(repo: RankedRepo, now = Date.now()): Promise<Season | null> {
  const seasons = await ensureSeasons(repo, now);
  const rows = seasons.map(toSeason);
  const open = rows.filter((s) => seasonAcceptsMatch(s, now));
  if (open.length) return open[open.length - 1];
  // sem janela aberta: retorna a mais recente (status 'closed' pelo chamador)
  return rows.length ? rows[rows.length - 1] : null;
}

/** id da temporada vigente (fallback 'season-1' para dados legados). */
export async function activeSeasonId(repo: RankedRepo, now = Date.now()): Promise<string> {
  const s = await activeSeason(repo, now);
  return s?.id ?? SEASON_1.id;
}
