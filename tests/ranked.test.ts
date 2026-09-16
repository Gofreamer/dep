import { describe, expect, it } from 'vitest';
import { applyMatch, expectedScore, kFactor, INITIAL_RATING } from '../src/ranked/rating';
import { rankFor, transition, RANK_BY_ID } from '../src/ranked/ranks';
import { applyRankedResult, leaderboard } from '../src/ranked/ladder';
import { MemoryRankedRepo } from '../src/ranked/repo';
import { BOT_ROSTER, botById, profileForDifficulty } from '../src/ranked/bots';
import { findOpponentFromRoster, pickOpponent, seedBots } from '../src/ranked/matchmaking';
import { currentSeason, seasonAcceptsMatch, SEASON_1 } from '../src/ranked/seasons';

describe('rating (Elo)', () => {
  it('expectedScore é simétrica e coerente', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
    expect(expectedScore(800, 1000)).toBeLessThan(0.5);
  });

  it('vitória do mais forte move menos rating', () => {
    const a = applyMatch(2000, 1000);
    const b = applyMatch(1000, 2000);
    expect(a.delta).toBeLessThan(b.delta);
    expect(a.winner).toBeGreaterThan(2000);
  });

  it('kFactor é maior em ratings baixos', () => {
    expect(kFactor(1000)).toBeGreaterThan(kFactor(2100));
  });

  it('perdedor nunca fica negativo', () => {
    const r = applyMatch(1500, 5);
    expect(r.loser).toBeGreaterThanOrEqual(0);
  });
});

describe('ranks', () => {
  it('hierarquia e pisos', () => {
    expect(rankFor(0).id).toBe('FERRO');
    expect(rankFor(1100).id).toBe('BRONZE');
    expect(rankFor(2000).id).toBe('CAMPEAO');
    expect(RANK_BY_ID.CAMPEAO.floor).toBe(2000);
  });

  it('transição dinâmica: só sobe com vitória, só cai com derrota', () => {
    // rating 1100 = piso de BRONZE, mas sem vitória não sobe.
    expect(transition(1100, false, 'FERRO').direction).toBe('none');
    expect(transition(1100, true, 'FERRO').direction).toBe('up');
    // rating abaixo do piso, mas com vitória não cai.
    expect(transition(1099, true, 'BRONZE').direction).toBe('none');
    expect(transition(1099, false, 'BRONZE').direction).toBe('down');
  });
});

describe('bots', () => {
  it('StellaPrime e Luna underdog existem com nomes exatos', () => {
    expect(botById('bot-stella-prime')?.name).toBe('StellaPrime');
    expect(botById('bot-luna-underdog')?.name).toBe('Luna underdog');
  });

  it('StellaPrime é o #1 inicial e Luna a #2', () => {
    const sorted = [...BOT_ROSTER].sort((a, b) => b.initialRating - a.initialRating);
    expect(sorted[0].name).toBe('StellaPrime');
    expect(sorted[1].name).toBe('Luna underdog');
  });

  it('perfis escaláveis por dificuldade (Stella 90% = elite, Luna 86% = hard)', () => {
    expect(profileForDifficulty(90).searchDepth).toBe(2);
    expect(profileForDifficulty(86).searchDepth).toBeGreaterThanOrEqual(1);
  });

  it('matchmaking escolhe bot próximo (nunca contra-pick: arquétipo fixo)', () => {
    const c = findOpponentFromRoster(2400, { rng: () => 0 });
    expect(c.bot.archetypeId).toBeTruthy();
    // bot mais próximo de 2400 = Luna underdog (2390, distância 10).
    expect(c.bot.name).toBe('Luna underdog');
    expect(Math.abs(c.bot.initialRating - 2400)).toBeLessThanOrEqual(60);
  });
});

describe('ladder (idempotente, Top 10, Rei da Liga)', () => {
  async function freshRepo() {
    const repo = new MemoryRankedRepo();
    await seedBots(repo);
    return repo;
  }

  it('aplica rating exatamente uma vez por rankedMatchId', async () => {
    const repo = await freshRepo();
    const stella = (await repo.getProfile('bot-stella-prime'))!;
    const before = stella.rating;
    await repo.upsertProfile({ username: 'human-x', rating: 2400, rank: 'CAMPEAO', wins: 0, losses: 0, streak: 0, updatedAt: 0, isBot: false });
    const out2 = await applyRankedResult(repo, {
      rankedMatchId: 'rm-2', seasonId: 'season-1', winnerUsername: 'human-x', loserUsername: 'bot-stella-prime'
    });
    expect(out2.alreadyApplied).toBe(false);
    const after = (await repo.getProfile('bot-stella-prime'))!.rating;
    expect(after).toBeLessThan(before);
    // reaplicar o MESMO id não muda nada.
    const again = await applyRankedResult(repo, {
      rankedMatchId: 'rm-2', seasonId: 'season-1', winnerUsername: 'human-x', loserUsername: 'bot-stella-prime'
    });
    expect(again.alreadyApplied).toBe(true);
    expect((await repo.getProfile('bot-stella-prime'))!.rating).toBe(after);
  });

  it('humano pode ultrapassar StellaPrime (não há trava de posição)', async () => {
    const repo = await freshRepo();
    await repo.upsertProfile({ username: 'human-x', rating: 2400, rank: 'CAMPEAO', wins: 0, losses: 0, streak: 0, updatedAt: 0, isBot: false });
    // Vitórias repetidas contra o topo.
    for (let i = 0; i < 8; i++) {
      await applyRankedResult(repo, {
        rankedMatchId: `rm-${i}`, seasonId: 'season-1', winnerUsername: 'human-x', loserUsername: 'bot-stella-prime'
      });
    }
    const lb = await leaderboard(repo, 10);
    expect(lb[0].username).toBe('human-x');
    expect(lb[0].isReiDaLiga).toBe(true);
  });

  it('Top 10 = Rei da Liga apenas para CAMPEÃO', async () => {
    const repo = await freshRepo();
    const lb = await leaderboard(repo, 100);
    const top10 = lb.slice(0, 10);
    for (const e of top10) {
      if (e.rank === 'CAMPEAO') expect(e.isReiDaLiga).toBe(true);
      else expect(e.isReiDaLiga).toBe(false);
    }
    // Todo Rei da Liga é CAMPEÃO; ninguém abaixo de CAMPEÃO tem o título.
    for (const e of lb) {
      if (e.isReiDaLiga) expect(e.rank).toBe('CAMPEAO');
    }
  });
});

describe('seasons', () => {
  it('Season 1 está ativa e tem janela de graça', () => {
    const s = currentSeason(Date.UTC(2026, 8, 20));
    expect(s?.number).toBe(1);
    const graceEnd = SEASON_1.endAt + SEASON_1.graceAfterEnd;
    expect(seasonAcceptsMatch(SEASON_1, SEASON_1.endAt + 1000)).toBe(true);
    expect(seasonAcceptsMatch(SEASON_1, graceEnd + 1000)).toBe(false);
  });
});
