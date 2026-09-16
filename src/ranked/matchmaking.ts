/**
 * MATCHMAKING + SEED — escolha de oponente e inicialização da liga.
 *
 * O bot escolhe o ARQUÉTIPO antes de ver qualquer informação privada do humano
 * (cada bot tem UM arquétipo fixo no seu perfil — nunca há contra-pick).
 *
 * 2.1: a escolha usa o rating ATUAL do bot no banco (não o `initialRating` de
 * tabela). Com o rating inicial, um humano em 2250 enfrentaria SEMPRE o bot
 * "cuja ficha diz 2240" mesmo que a escada já tivesse movido todo mundo — e,
 * sobretudo, a Stella cair para 2250 não a tornava acessível: o topo ficava
 * congelado. Agora vale a posição viva da escada; o `initialRating` só é o
 * fallback de seed (primeira escrita no banco).
 */

import { BOT_ROSTER, botById, type BotDef } from './bots';
import { INITIAL_RATING } from './rating';
import { rankFor } from './ranks';
import { ensureSeasons } from './seasons';
import type { RankedRepo } from './repo';

export interface BotRating {
  id: string;
  rating: number;
}

/** Garante que todos os bots existem no ladder (idempotente) e semeia a Season 1. */
export async function seedBots(repo: RankedRepo, now = Date.now()): Promise<void> {
  await ensureSeasons(repo, now);
  const seasonId = (await repo.listSeasons()).slice(-1)[0]?.id ?? 'season-1';
  const sorted = [...BOT_ROSTER].sort((a, b) => b.initialRating - a.initialRating);
  for (let i = 0; i < sorted.length; i++) {
    const bot = sorted[i];
    const existing = await repo.getProfile(bot.id);
    if (existing) continue;
    await repo.upsertProfile({
      username: bot.id,
      rating: bot.initialRating,
      rank: rankFor(bot.initialRating).id,
      wins: 0,
      losses: 0,
      streak: 0,
      updatedAt: now,
      isBot: true,
      seasonId,
      // pico/melhor posição nascem do seed: a liga já começa com a hierarquia
      // documentada, e o histórico passa a refletir "chegou ao #1" de verdade.
      peakRating: bot.initialRating,
      bestPosition: i + 1,
      highestRank: rankFor(bot.initialRating).id
    });
  }
}

/** Ratings vivos (banco) com fallback para o `initialRating` do roster. */
export async function liveBotRatings(repo: RankedRepo): Promise<BotRating[]> {
  const profiles = await repo.listProfiles();
  const byName = new Map(profiles.map((p) => [p.username.toLowerCase(), p]));
  return BOT_ROSTER.map((b) => ({ id: b.id, rating: byName.get(b.id.toLowerCase())?.rating ?? b.initialRating }));
}

export interface OpponentChoice {
  bot: BotDef;
  reason: 'nearest' | 'underdog' | 'challenge';
  /** Rating do bot no momento da escolha (banco; `initialRating` como fallback). */
  botRating: number;
  /** Pool considerada (ids, do mais próximo ao mais distante) — diagnóstico/teste. */
  pool: string[];
  /** id da temporada usada para o matchId/ticket. */
  seasonId: string;
}

export interface OpponentOptions {
  /** Fonte de aleatoriedade (injetável para teste determinístico). */
  rng?: () => number;
  /** Chance de "DESAFIO DE ELITE": pegar o bot mais bem ranqueado vivo. */
  eliteChance?: number;
  /** Quantos candidatos ponderar (3–5). */
  poolSize?: number;
  /** Fora da janela ±`window` de rating, o motivo vira challenge/underdog. */
  window?: number;
}

/**
 * Escolha pura: pondera os `poolSize` bots mais próximos do rating informado e
 * sorteia entre eles com peso 1/(1+distância). Com `eliteChance`, uma fração
 * pequena dos casamentos vira "DESAFIO DE ELITE" contra o topo da escada.
 */
export function pickOpponent(
  humanRating: number,
  ratings: BotRating[],
  opts: OpponentOptions = {}
): Omit<OpponentChoice, 'seasonId'> {
  const rng = opts.rng ?? Math.random;
  const eliteChance = opts.eliteChance ?? 0.07;
  const poolSize = Math.max(3, Math.min(5, opts.poolSize ?? 5));
  const window = opts.window ?? 250;
  const byId = new Map(ratings.map((r) => [r.id, r.rating]));
  const ranked = [...BOT_ROSTER]
    .map((b) => ({ bot: b, rating: byId.get(b.id) ?? b.initialRating }))
    .sort((a, b) => Math.abs(a.rating - humanRating) - Math.abs(b.rating - humanRating) || b.rating - a.rating);

  // DESAFIO DE ELITE: o topo VIVO da escada (não o `initialRating`), para que
  // "derrubar a Stella" seja possível de verdade.
  const top = [...ranked].sort((a, b) => b.rating - a.rating)[0];
  if (top && rng() < eliteChance && Math.abs(top.rating - humanRating) > window) {
    return { bot: top.bot, reason: 'challenge', botRating: top.rating, pool: ranked.slice(0, poolSize).map((r) => r.bot.id) };
  }

  const pool = ranked.slice(0, poolSize);
  const weights = pool.map((r) => 1 / (1 + Math.abs(r.rating - humanRating)));
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng() * total;
  let chosen = pool[0];
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { chosen = pool[i]; break; }
  }
  const spread = chosen.rating - humanRating;
  const reason: OpponentChoice['reason'] = spread > 100 ? 'challenge' : spread < -100 ? 'underdog' : 'nearest';
  return { bot: chosen.bot, reason, botRating: chosen.rating, pool: pool.map((r) => r.bot.id) };
}

/** Matchmaking via banco: usa o rating persistido de cada bot. */
export async function findOpponent(
  repo: RankedRepo,
  humanRating: number,
  opts: OpponentOptions = {},
  now = Date.now()
): Promise<OpponentChoice> {
  const ratings = await liveBotRatings(repo);
  const seasonId = (await ensureSeasons(repo, now)).slice(-1)[0]?.id ?? 'season-1';
  return { ...pickOpponent(humanRating, ratings, opts), seasonId };
}

/**
 * Compat com a chamada síncrona da 2.0 (`findOpponent(rating, name)`) — hoje só
 * usada em testes/dev sem banco: usa o `initialRating` do roster.
 */
export function findOpponentFromRoster(humanRating: number, opts: OpponentOptions = {}): Omit<OpponentChoice, 'seasonId'> {
  return pickOpponent(humanRating, BOT_ROSTER.map((b) => ({ id: b.id, rating: b.initialRating })), opts);
}

export { botById, BOT_ROSTER, INITIAL_RATING, type BotDef };
