/**
 * LADDER TICK — a escada viva entre partidas humanas (`scheduled` do Worker).
 *
 * Sem isto a liga morre: os bots só andavam quando um humano jogasse, e o topo
 * (StellaPrime em 2460) ficava matematicamente inalcançável — cada vitória
 * humana vale ~24 de Elo, e nenhuma partida acontece entre duas pessoas.
 *
 * O que o tick faz, por hora:
 *  1. garante bots + temporada no banco (`seedBots`);
 *  2. sorteia 2–8 PARES de bots próximos pelo rating VIVO (número derivado do
 *     timestamp da hora → o mesmo tick re-executado produz os mesmos pares);
 *  3. aplica cada resultado por `applyRankedResult` com `rankedMatchId`
 *     determinístico (`ladder-<temporada>-<hora>-<slot>`), que é o que torna a
 *     re-execução idempotente: retry do Cloudflare não pontua duas vezes;
 *  4. liquida sessões expiradas (manutenção que a 2.0 documentava mas não
 *     chamava em lugar nenhum).
 *
 * O QUE O TICK **NÃO** É: ele não reproduz partidas no MatchEngine. Simular 8
 * jogos IA×IA por invocação custaria CPU demais dentro do Worker (e seria
 * irreproduzível para o humano, que não estava lá). O desfecho é amostrado da
 * expectativa Elo dos dois perfis. As partidas REAIS de bot×bot — com a mesma
 * engine, medindo se o nível de IA muda resultado — são as do simulador offline
 * (`npm run ranked:sim`, ≥1000 partidas), e é delas que saem os números citados
 * em `docs/RANKED.md`.
 */

import { BOT_ROSTER } from './bots';
import { applyRankedResult } from './ladder';
import { seedBots, liveBotRatings } from './matchmaking';
import { activeSeason, seasonAcceptsMatch } from './seasons';
import { expectedScore } from './rating';
import type { RankedRepo } from './repo';

/** PRNG determinístico (mulberry32) — mesma hora, mesmo resultado. */
function rngFor(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const HOUR_MS = 60 * 60 * 1000;

/** Quantas partidas neste tick (2–8 por hora, estáveis por hora-âncora). */
export function matchesForHour(now: number, min = 2, max = 8): number {
  const hour = Math.floor(now / HOUR_MS);
  const r = rngFor(hour * 2654435761)();
  return min + Math.floor(r * (max - min + 1));
}

/** `matchId` determinístico e não colidível por (temporada, hora, slot). */
export function scheduledMatchId(seasonId: string, now: number, slot: number): string {
  return `ladder-${seasonId}-${Math.floor(now / HOUR_MS)}-${slot}`;
}

export interface TickPairing {
  slot: number;
  winner: string;
  loser: string;
  matchId: string;
  /** expectativa do vencedor no Elo (diagnóstico/UI). */
  expected: number;
}

export interface TickResult {
  seasonId: string | null;
  played: number;
  skipped: string | null;
  pairings: TickPairing[];
}

/**
 * Pares do tick: ordena os bots pelo rating vivo e casa vizinhos (janela de
 * ±1 posição), embaralhando a ordem dos candidatos com o PRNG da hora. Assim,
 * um bot parado no topo não enfrenta sempre o mesmo de baixo, e quem perdeu
 * pontos desce de adversário sozinho — é isso que faz a escada "respirar".
 */
export function pairingsForTick(
  ratings: { id: string; rating: number }[],
  now: number,
  count = matchesForHour(now)
): { a: string; b: string }[] {
  const rng = rngFor(Math.floor(now / HOUR_MS) * 7919 + 13);
  const sorted = [...ratings].sort((x, y) => y.rating - x.rating || x.id.localeCompare(y.id));
  const pairs: { a: string; b: string }[] = [];
  const used = new Set<string>();
  for (let i = 0; i < sorted.length && pairs.length < count; i++) {
    if (used.has(sorted[i].id)) continue;
    // candidatos: posições vizinhas (1..2 abaixo, 1 acima) — nunca o topo
    // inteiro contra o fundo da tabela.
    const window = [sorted[i + 1], sorted[i + 2]].filter(Boolean) as typeof sorted;
    const up = sorted[i - 1];
    const pool = (up && !used.has(up.id) && pairs.length === 0 ? [up, ...window] : window);
    const free = pool.filter((c) => !used.has(c.id));
    if (!free.length) continue;
    const chosen = free[Math.floor(rng() * free.length)];
    used.add(sorted[i].id);
    used.add(chosen.id);
    pairs.push({ a: sorted[i].id, b: chosen.id });
  }
  return pairs;
}

/** Executa um tick. Idempotente por (temporada, hora): chamar 2× não repete. */
export async function runLadderTick(repo: RankedRepo, opts: { now?: number; maxMatches?: number } = {}): Promise<TickResult> {
  const now = opts.now ?? Date.now();
  await seedBots(repo, now);
  const season = await activeSeason(repo, now);
  if (!season || !seasonAcceptsMatch(season, now)) {
    return { seasonId: season?.id ?? null, played: 0, skipped: 'fora da janela da temporada', pairings: [] };
  }

  const ratings = await liveBotRatings(repo);
  const byId = new Map(ratings.map((r) => [r.id, r.rating]));
  const want = Math.min(opts.maxMatches ?? matchesForHour(now), BOT_ROSTER.length >> 1);
  const pairs = pairingsForTick(ratings, now, Math.max(1, want));

  const applied: TickPairing[] = [];
  for (let slot = 0; slot < pairs.length; slot++) {
    const { a, b } = pairs[slot];
    const ra = byId.get(a) ?? 1000;
    const rb = byId.get(b) ?? 1000;
    const expA = expectedScore(ra, rb);
    const rng = rngFor(Math.floor(now / HOUR_MS) * 1_000_003 + slot * 7919);
    const aWins = rng() < expA;
    const winner = aWins ? a : b;
    const loser = aWins ? b : a;
    const res = await applyRankedResult(repo, {
      rankedMatchId: scheduledMatchId(season.id, now, slot),
      seasonId: season.id,
      winnerUsername: winner,
      loserUsername: loser,
      now
    });
    if (res.alreadyApplied) continue;
    applied.push({
      slot,
      winner,
      loser,
      matchId: scheduledMatchId(season.id, now, slot),
      expected: aWins ? expA : 1 - expA
    });
  }

  // manutenção: sessões vencidas não ficam indefinidamente no banco
  await repo.purgeExpiredSessions(now);

  return { seasonId: season.id, played: applied.length, skipped: null, pairings: applied };
}
