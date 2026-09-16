// @vitest-environment node
/**
 * JUSTIÇA DE RNG (2.1) — duas coisas que a 2.0 não garantia:
 *
 * 1. **O setup de um jogador não consome o stream compartilhado.** Antes, os dois
 *    embaralhamentos do setup saíam do mesmo `rngState` na ordem, então a ordem do
 *    deck do jogador 1 dependia de quantos redrews de mulligan o jogador 0
 *    precisou. Em espelhos isso não é sorte, é assimetria: media 56,3% de vitória
 *    para quem embaralha primeiro (n=512, σ≈2,2pp). Depois da isenção por
 *    assento, a medição cai para 46,7–50,4% e o `rngState` pós-setup passa a ser
 *    função SÓ da semente — é o que o teste verifica, de forma exata.
 *
 * 2. **A primeira saída do PRNG não herda padrão da semente literal.** O sorteio
 *    de "quem abre" é o primeiro consumo do stream; com `seed = base + par·104729
 *    + réplica·7919` (padrão do meta-sim) dava 47,4% de "P0 começa" em n=2304.
 *    `mixSeed` (avalanche) + `warmRng` (8 passos) removem isso — testado sobre o
 *    próprio padrão de sementes do simulador.
 */
import { describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { PROFILE_LEVELS } from '../src/engine/ai/profile';
import { mixSeed, warmRng, Rng } from '../src/engine/rng';
import { DEFAULT_CONFIG } from '../src/engine/types';
import type { CardDef } from '../src/engine/types';

registerJetDataPack();

function card(id: string): CardDef {
  return registry.card(id);
}
function fill(id: string, n: number): CardDef[] {
  return Array.from({ length: n }, () => card(id));
}

/** Baralho "com starter sobrando" (0–1 redraws) e "no limite" (redraws a mais). */
const plentiful = [...fill('agent-kaio-base', 8), ...fill('jres-energia', 52)];
const scarce = [...fill('jres-energia', 59), card('agent-kaio-base')];
const p1Deck = [...fill('agent-ruby-base', 4), ...fill('jres-energia', 56)];

function driveSetup(engine: MatchEngine): void {
  for (const p of [0, 1] as const) {
    let g = 0;
    while (engine.state.phase === 'setup' && !engine.state.players[p].setupDone && g++ < 40) {
      const r = engine.dispatch(aiNextCommand(engine, p, PROFILE_LEVELS.hard));
      if (!r.ok) break;
      for (;;) {
        const pend = engine.getPending();
        if (!pend) break;
        engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(engine.state, pend.player, pend) });
      }
    }
  }
}

function setupOf(deckA: CardDef[], deckB: CardDef[], seed: number) {
  const engine = new MatchEngine({
    seed,
    players: [
      { name: 'A', deckId: 'a', isAI: true, aiLevel: 'hard', deck: deckA },
      { name: 'B', deckId: 'b', isAI: true, aiLevel: 'hard', deck: deckB }
    ]
  });
  driveSetup(engine);
  return {
    rngState: engine.state.rngState,
    p1Order: engine.state.players[1].deck.concat(engine.state.players[1].hand).map((c) => c.defId),
    attempts: (engine as unknown as { mulliganRedraws: [number, number] }).mulliganRedraws
  };
}

describe('setup não contamina o stream compartilhado', () => {
  it('o mulligan do jogador 0 não muda o embaralhamento do jogador 1', () => {
    const a = setupOf(plentiful, p1Deck, 20260912);
    const b = setupOf(scarce, p1Deck, 20260912);
    // o fixture precisa realmente produzir nºs de redraw diferentes, senão o
    // teste não está testando nada
    expect(a.attempts[0]).not.toBe(b.attempts[0]);
    expect(b.p1Order).toEqual(a.p1Order);
    expect(b.rngState).toBe(a.rngState);
  });

  it('a semente continua definindo a partida (não virou constante)', () => {
    const a = setupOf(plentiful, p1Deck, 20260912);
    const c = setupOf(plentiful, p1Deck, 777);
    expect(c.p1Order).not.toEqual(a.p1Order);
    expect(c.rngState).not.toBe(a.rngState);
  });

  it('rngState pós-setup é determinístico por semente', () => {
    for (const seed of [1, 42, 777, 20260912, 424242]) {
      expect(setupOf(scarce, p1Deck, seed).rngState).toBe(setupOf(plentiful, p1Deck, seed).rngState);
    }
  });
});

describe('avalanche da semente', () => {
  it('a primeira saída não depende de padrão de semente (sequencial)', () => {
    const N = 4000;
    let below = 0;
    for (let seed = 0; seed < N; seed++) if (new Rng(seed).next() < 0.5) below++;
    expect(Math.abs(below / N - 0.5)).toBeLessThan(0.02);
  });

  it('a primeira saída não depende de padrão de semente (padrão do meta-sim)', () => {
    // exatamente a fórmula do simulador: era aqui que aparecia o 47,4%
    const N = 36 * 64;
    let below = 0;
    for (let pairNo = 0; pairNo < 36; pairNo++) {
      for (let rep = 0; rep < 64; rep++) {
        const seed = (20260912 + pairNo * 104729 + rep * 7919) >>> 0;
        if (new Rng(seed).next() < 0.5) below++;
      }
    }
    expect(Math.abs(below / N - 0.5)).toBeLessThan(0.02);
  });

  it('mixSeed é injetivo o bastante e warmRng avança o estado', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 5000; s++) seen.add(mixSeed(s));
    expect(seen.size).toBeGreaterThan(4900);
    expect(warmRng(7)).toBe((mixSeed(7) + 8 * 0x6d2b79f5) >>> 0);
    expect(new Rng(0).next()).toBe(new Rng(0).next()); // determinístico por seed
  });
});

describe('quem abre é sorteado sem padrão', () => {
  it('distribuição do startingPlayer sobre sementes do simulador', () => {
    const deck = plentiful;
    let p0 = 0, n = 0;
    for (let pairNo = 0; pairNo < 12; pairNo++) {
      for (let rep = 0; rep < 32; rep++) {
        const seed = (20260912 + pairNo * 104729 + rep * 7919) >>> 0;
        const engine = new MatchEngine({
          seed,
          players: [
            { name: 'A', deckId: 'a', isAI: true, aiLevel: 'hard', deck },
            { name: 'B', deckId: 'b', isAI: true, aiLevel: 'hard', deck }
          ]
        });
        driveSetup(engine);
        if (engine.state.phase === 'setup') continue;
        n++;
        if (engine.state.startingPlayer === 0) p0++;
      }
    }
    expect(n).toBeGreaterThan(200);
    // σ de uma proporção com n≈384 é ~2,6pp; 40pp de tolerância seria frouxo
    // demais para pegar o problema (era 47,4%). 4pp ≈ 1,5σ.
    expect(Math.abs(p0 / n - 0.5)).toBeLessThan(0.04);
  });
});

describe('config de baralho da liga', () => {
  it('deckRules expõe os tetos que a Liga cobra', () => {
    expect(DEFAULT_CONFIG.deckRules.maxCopies).toBe(4);
    expect(DEFAULT_CONFIG.deckRules.maxCopiesPerIdentity).toBe(4);
    expect(DEFAULT_CONFIG.deckRules.uniqueMax).toBe(1);
    expect(DEFAULT_CONFIG.turn.attackCostFloor).toBe(1);
    expect(DEFAULT_CONFIG.turn.maxAttackCostReduce).toBe(1);
    expect(DEFAULT_CONFIG.turn.actionOncePerTurn).toBe(true);
  });
});
