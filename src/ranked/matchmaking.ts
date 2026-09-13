/**
 * MATCHMAKING + SEED — escolha de oponente e inicialização da liga.
 *
 * O bot escolhe o ARQUÉTIPO antes de ver qualquer informação privada do humano
 * (cada bot tem UM arquétipo fixo no seu perfil — nunca há contra-pick).
 */

import { BOT_ROSTER, botById } from './bots';
import { INITIAL_RATING } from './rating';
import { rankFor } from './ranks';
import type { RankedRepo } from './repo';

/** Garante que todos os bots existem no ladder (idempotente). */
export async function seedBots(repo: RankedRepo): Promise<void> {
  for (const bot of BOT_ROSTER) {
    const existing = await repo.getProfile(bot.id);
    if (existing) continue;
    await repo.upsertProfile({
      username: bot.id,
      rating: bot.initialRating,
      rank: rankFor(bot.initialRating).id,
      wins: 0,
      losses: 0,
      streak: 0,
      updatedAt: Date.now(),
      isBot: true
    });
  }
}

export interface OpponentChoice {
  bot: (typeof BOT_ROSTER)[number];
  reason: 'nearest' | 'underdog' | 'challenge';
}

/**
 * Escolhe um oponente próximo do rating do humano. O humano pode enfrentar
 * tanto alguém acima (desafio) quanto abaixo; a janela é ±250 de rating.
 */
export function findOpponent(humanRating: number, humanName: string): OpponentChoice {
  const bots = [...BOT_ROSTER].sort((a, b) => Math.abs(a.initialRating - humanRating) - Math.abs(b.initialRating - humanRating));
  const nearest = bots[0];
  const spread = nearest.initialRating - humanRating;
  if (spread > 100) return { bot: nearest, reason: 'challenge' };
  if (spread < -100) return { bot: nearest, reason: 'underdog' };
  return { bot: nearest, reason: 'nearest' };
}

export { BOT_ROSTER, botById, INITIAL_RATING };
