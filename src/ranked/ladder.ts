/**
 * LADDER — ranking global, idempotência de rating e transições dinâmicas.
 *
 *  - `applyRankedResult` aplica o resultado de UMA partida EXATAMENTE uma vez
 *    por `rankedMatchId` (chamar de novo retorna o resultado original).
 *  - `leaderboard` ordena por rating desc.
 *  - `topTen` → REI DA LIGA: só CAMPEÃO no Top 10 global recebe o título.
 *  - Transições de rank dinâmicas (subir exige vitória; cair exige derrota).
 */

import { applyResult } from './rating';
import { RANK_BY_ID, RANK_ORDER, rankFor, transition, type RankId } from './ranks';

import type { RankedMatch, RankedProfile, RankedRepo, SeasonResultRow, SeasonRow } from './repo';
import { toSeason } from './seasons';

export interface ApplyOutcome {
  alreadyApplied: boolean;
  winner: string;
  winnerRatingAfter: number;
  loserRatingAfter: number;
  winnerRank: RankId;
  loserRank: RankId;
  /** Transição dinâmica do vencedor (up/down/none). */
  winnerTransition: 'up' | 'down' | 'none';
  loserTransition: 'up' | 'down' | 'none';
}

export interface LeaderboardEntry {
  username: string;
  rating: number;
  rank: RankId;
  position: number;
  wins: number;
  losses: number;
  isBot: boolean;
  isReiDaLiga: boolean;
}

/**
 * Aplica o resultado de uma partida ranqueada de forma idempotente.
 * `winnerUsername`/`loserUsername` são ids canônicos (username ou bot id).
 */
export async function applyRankedResult(
  repo: RankedRepo,
  args: {
    rankedMatchId: string;
    seasonId: string;
    winnerUsername: string;
    loserUsername: string;
    /** Resultado opcional do engine (validação server-side já feita pelo caller). */
    now?: number;
  }
): Promise<ApplyOutcome> {
  const now = args.now ?? Date.now();
  const existing = await repo.getMatch(args.rankedMatchId);
  const winnerProfile = await repo.getProfile(args.winnerUsername);
  const loserProfile = await repo.getProfile(args.loserUsername);
  if (!winnerProfile || !loserProfile) throw new Error('perfil não encontrado para aplicar rating');

  if (existing) {
    // Idempotência: não reaplica. Os perfis já refletem o resultado aplicado
    // na primeira chamada — retornamos o estado ATUAL (sem somar delta de novo).
    const winnerIsArgsWinner = existing.winner === args.winnerUsername;
    const winnerNow = winnerIsArgsWinner ? winnerProfile : loserProfile;
    const loserNow = winnerIsArgsWinner ? loserProfile : winnerProfile;
    return {
      alreadyApplied: true,
      winner: existing.winner,
      winnerRatingAfter: winnerNow.rating,
      loserRatingAfter: loserNow.rating,
      winnerRank: winnerNow.rank,
      loserRank: loserNow.rank,
      winnerTransition: 'none',
      loserTransition: 'none'
    };
  }

  const winnerIsA = args.winnerUsername === winnerProfile.username;
  const result = applyResult(winnerProfile, loserProfile, winnerIsA);
  const wAfter = winnerIsA ? result.aRating : result.bRating;
  const lAfter = winnerIsA ? result.bRating : result.aRating;
  const deltaW = winnerIsA ? result.delta : -result.delta;
  const deltaL = winnerIsA ? -result.delta : result.delta;

  // --- posições (para bestPosition) e histórico de pico -------------------
  // Posição = índice na mesma ordenação do `leaderboard` (rating desc,
  // vitórias desc). Recalcular para os dois afetados custa um listProfiles por
  // partida — com o elenco da liga (<1000 linhas) isso é O(n log n) barato e
  // mantém o "melhor posição" correto sem trabalho em background.
  const positions = await positionsOf(repo, [args.winnerUsername, args.loserUsername]);

  const wTransition = transition(wAfter, true, winnerProfile.rank);
  const lTransition = transition(lAfter, false, loserProfile.rank);
  const newWRank: RankId = wTransition.direction === 'up' ? wTransition.to! : winnerProfile.rank;
  const newLRank: RankId = lTransition.direction === 'down' ? lTransition.to! : loserProfile.rank;

  await repo.upsertProfile({
    ...winnerProfile,
    rating: wAfter,
    rank: newWRank,
    wins: winnerProfile.wins + 1,
    streak: Math.max(1, winnerProfile.streak + 1),
    updatedAt: now,
    seasonId: args.seasonId,
    peakRating: Math.max(winnerProfile.peakRating ?? winnerProfile.rating, wAfter),
    highestRank: betterRank(winnerProfile.highestRank ?? winnerProfile.rank, newWRank),
    bestPosition: betterPosition(winnerProfile.bestPosition, positions.get(args.winnerUsername.toLowerCase()))
  });
  await repo.upsertProfile({
    ...loserProfile,
    rating: Math.max(0, lAfter),
    rank: newLRank,
    losses: loserProfile.losses + 1,
    streak: Math.min(-1, loserProfile.streak - 1),
    updatedAt: now,
    seasonId: args.seasonId,
    peakRating: Math.max(loserProfile.peakRating ?? loserProfile.rating, Math.max(0, lAfter)),
    highestRank: betterRank(loserProfile.highestRank ?? loserProfile.rank, newLRank),
    bestPosition: betterPosition(loserProfile.bestPosition, positions.get(args.loserUsername.toLowerCase()))
  });

  const match: RankedMatch = {
    rankedMatchId: args.rankedMatchId,
    seasonId: args.seasonId,
    playerA: winnerProfile.username,
    playerB: loserProfile.username,
    winner: args.winnerUsername,
    aRatingDelta: deltaW,
    bRatingDelta: deltaL,
    createdAt: now
  };
  await repo.recordMatch(match);

  return {
    alreadyApplied: false,
    winner: args.winnerUsername,
    winnerRatingAfter: wAfter,
    loserRatingAfter: Math.max(0, lAfter),
    winnerRank: newWRank,
    loserRank: newLRank,
    winnerTransition: wTransition.direction,
    loserTransition: lTransition.direction
  };
}

/** Ranking global ordenado por rating (desc). Posição 1 = topo. */
export async function leaderboard(repo: RankedRepo, limit = 100): Promise<LeaderboardEntry[]> {
  const profiles = await repo.listProfiles();
  const sorted = profiles
    .map((p) => ({ ...p }))
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
    .slice(0, limit);

  const top10 = new Set(sorted.slice(0, 10).map((p) => p.username));
  return sorted.map((p, i) => ({
    username: p.username,
    rating: p.rating,
    rank: p.rank,
    position: i + 1,
    wins: p.wins,
    losses: p.losses,
    isBot: p.isBot,
    // REI DA LIGA: só CAMPEÃO dentro do Top 10 global.
    isReiDaLiga: p.rank === 'CAMPEAO' && top10.has(p.username)
  }));
}

/** Posição atual (1 = topo) dos usernames pedidos, na ordem do leaderboard. */
async function positionsOf(repo: RankedRepo, usernames: string[]): Promise<Map<string, number>> {
  const want = new Set(usernames.map((u) => u.toLowerCase()));
  const profiles = await repo.listProfiles();
  const sorted = [...profiles].sort((a, b) => b.rating - a.rating || b.wins - a.wins);
  const out = new Map<string, number>();
  sorted.forEach((p, i) => {
    if (want.has(p.username.toLowerCase())) out.set(p.username.toLowerCase(), i + 1);
  });
  return out;
}

/** menor = melhor (posição 1 é o topo) */
function betterPosition(prev: number | null | undefined, next: number | undefined): number | null {
  if (next === undefined) return prev ?? null;
  return prev == null ? next : Math.min(prev, next);
}

/** rank "melhor" = mais adiante na ordem da liga */
function betterRank(a: RankId, b: RankId): RankId {
  return (RANK_BY_ID[b]?.order ?? -1) > (RANK_BY_ID[a]?.order ?? -1) ? b : a;
}

export interface SeasonStandingsInput {
  season: SeasonRow;
  now?: number;
}

/**
 * Liquida a temporada: grava `season_results` (rating final/pico, posição
 * final/melhor, highest_rank, Rei da Liga e a melhor posição que o rei ocupou,
 * vitórias/derrotas) e marca `settledAt`. Idempotente: rodar de novo produz as
 * mesmas linhas e não duplica nada.
 */
export async function settleSeason(repo: RankedRepo, seasonId: string, now = Date.now()): Promise<SeasonResultRow[]> {
  const seasons = await repo.listSeasons();
  const season = seasons.find((s) => s.id === seasonId);
  if (!season) throw new Error(`temporada desconhecida: ${seasonId}`);
  const lb = await leaderboard(repo, 100_000);
  const rows: SeasonResultRow[] = [];
  for (const e of lb) {
    const prof = await repo.getProfile(e.username);
    if (!prof) continue;
    const kingPos = e.isReiDaLiga ? Math.min(e.position, prof.bestPosition ?? e.position) : null;
    rows.push({
      seasonId,
      username: prof.username,
      finalRating: e.rating,
      peakRating: Math.max(prof.peakRating ?? e.rating, e.rating),
      finalPosition: e.position,
      bestPosition: Math.min(prof.bestPosition ?? e.position, e.position),
      highestRank: prof.highestRank ?? prof.rank,
      wasLeagueKing: e.isReiDaLiga,
      leagueKingPeakPosition: kingPos,
      wins: e.wins,
      losses: e.losses,
      settledAt: now
    });
  }
  for (const r of rows) await repo.upsertSeasonResult(r);
  await repo.upsertSeason({ ...season, settledAt: now });
  return rows;
}

/** Standings Liquidados (lê do banco — não recalcula do estado vivo). */
export async function seasonStandings(repo: RankedRepo, seasonId: string): Promise<SeasonResultRow[]> {
  return (await repo.listSeasonResults(seasonId)).map((r, i) => ({ ...r, finalPosition: i + 1 }));
}

export { RANK_BY_ID, rankFor, toSeason };
