/**
 * RATING — Elo para a Liga Ranqueada JET.
 *
 * Servidor-autoritativo: o cliente NUNCA envia "eu venci". O servidor determina
 * o resultado da partida (via replay/verificação) e chama `applyMatch` EXATAMENTE
 * uma vez por `rankedMatchId` (idempotência — aplicar de novo retorna o mesmo
 * resultado e não muda rating).
 */

export const INITIAL_RATING = 1000;

export interface RatingResult {
  winner: number;
  loser: number;
  delta: number;
}

/** Probabilidade esperada do jogador A vencer B (Elo clássico). */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** Fator K por rating — ratings altos mudam mais devagar (estabilidade no topo). */
export function kFactor(rating: number): number {
  if (rating >= 2100) return 24;
  if (rating >= 1700) return 32;
  if (rating >= 1300) return 40;
  return 48;
}

/** Aplica o resultado de uma partida entre dois ratings (sem empate). */
export function applyMatch(winnerRating: number, loserRating: number, opts: { draw?: boolean } = {}): RatingResult {
  if (opts.draw) {
    const eW = expectedScore(winnerRating, loserRating);
    const delta = Math.max(1, Math.round((kFactor(winnerRating) + kFactor(loserRating)) / 2 * (0.5 - eW)));
    return { winner: winnerRating + delta, loser: Math.max(0, loserRating - delta), delta };
  }
  const eW = expectedScore(winnerRating, loserRating);
  // Delta mínimo de 1: vencer SEMPRE move (mesmo favorito esmagador), mantendo
  // o ladder vivo — nunca fica impossível ultrapassar o topo.
  const delta = Math.max(1, Math.round(kFactor(winnerRating) * (1 - eW)));
  return { winner: winnerRating + delta, loser: Math.max(0, loserRating - delta), delta };
}

/** Aplica o rating de uma partida nos DOIS jogadores (winnerId/loserId). */
export function applyResult(a: { rating: number }, b: { rating: number }, winnerIsA: boolean): { aRating: number; bRating: number; delta: number } {
  if (winnerIsA) {
    const r = applyMatch(a.rating, b.rating);
    return { aRating: r.winner, bRating: r.loser, delta: r.delta };
  }
  const r = applyMatch(b.rating, a.rating);
  return { aRating: r.loser, bRating: r.winner, delta: r.delta };
}
