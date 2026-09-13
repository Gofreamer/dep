/**
 * SEASONS — temporadas da Liga Ranqueada JET.
 *
 * Season 1 é a temporada atual. Cada temporada tem janela de competição
 * (`startAt`..`endAt`) e uma janela de reconexão/graça (`graceAfterEnd`):
 * resultados enviados dentro da graça ainda contam para a temporada; depois
 * disso o rating congela até a próxima temporada.
 */

export interface Season {
  id: string;
  number: number;
  name: string;
  startAt: number;
  endAt: number;
  /** Janela de graça após o fim (ms) — resultados ainda contam. */
  graceAfterEnd: number;
}

export const SEASON_1: Season = {
  id: 'season-1',
  number: 1,
  name: 'Season 1',
  // Temporada 1: janela de 90 dias a partir do lançamento (2026-09-12).
  startAt: Date.UTC(2026, 8, 12, 0, 0, 0),
  endAt: Date.UTC(2026, 11, 11, 23, 59, 59),
  graceAfterEnd: 7 * 24 * 60 * 60 * 1000
};

export function currentSeason(now = Date.now()): Season | null {
  if (now >= SEASON_1.startAt && now <= SEASON_1.endAt + SEASON_1.graceAfterEnd) return SEASON_1;
  return null;
}

/** Uma partida ranqueada só é aceita dentro da janela da temporada (incl. graça). */
export function seasonAcceptsMatch(season: Season, now = Date.now()): boolean {
  return now >= season.startAt && now <= season.endAt + season.graceAfterEnd;
}
