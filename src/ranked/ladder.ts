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
import { RANK_BY_ID, rankFor, transition, type RankId } from './ranks';
import type { RankedMatch, RankedProfile, RankedRepo } from './repo';

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
    updatedAt: now
  });
  await repo.upsertProfile({
    ...loserProfile,
    rating: Math.max(0, lAfter),
    rank: newLRank,
    losses: loserProfile.losses + 1,
    streak: Math.min(-1, loserProfile.streak - 1),
    updatedAt: now
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

export { RANK_BY_ID, rankFor };
