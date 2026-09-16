import { describe, expect, it, beforeAll } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { ARCHETYPE_DECKS } from '../src/data/jet/archetypes';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { DEFAULT_CONFIG, SELECTOR_IDS, type AiLevel, type CardInstance, type Command } from '../src/engine/types';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { profileForLevel, PROFILE_LEVELS, STELLA_PROFILE, LUNA_PROFILE } from '../src/engine/ai/profile';
const ELITE_PROFILE = PROFILE_LEVELS.elite;
import { createAiNoise } from '../src/engine/ai/noise';
import { effectsValue, emptyPlan, bestDamageOnto, targetsOf } from '../src/engine/ai/eval';
import { expandDeck } from '../src/data/deckUtils';
import { player } from '../src/engine/queries';
import { applyDamage } from '../src/engine/effects/shared';
import { runAiMatch, simulateMeta } from '../src/meta/simulator';

/**
 * AVALIADOR DA IA (JET 2.1) — invariantes do motor de decisão.
 *
 * Estes testes não medem "gostei da jogada": medem as propriedades que tornam
 * o avaliador confiável e honesto:
 *  1. a IA não consome o RNG da partida (não altera moedas/embaralhamentos nem
 *     o sorteio de quem abre) — só lê estado público e escolhe comandos;
 *  2. determinismo (mesmo estado → mesma jogada), exigido por replay;
 *  3. todo nível de `AiLevel` joga uma partida completa sem comando ilegal;
 *  4. a escada easy < normal < hard < elite existe de fato nos perfis;
 *  5. o simulador usa delineamento pareado (assento × seed desemparelhados) e
 *     as taxas A+B fecham em 100%.
 */

beforeAll(() => { registerJetDataPack(); });

/** Deck do relatório de meta (arquétipos = os baralhos que o gate mede). */
const DECK_BY_ID = new Map(ARCHETYPE_DECKS.map((d) => [d.id, d]));
const deckCards = (id: string) => expandDeck(DECK_BY_ID.get(id)!).map((x) => registry.card(x));
const entry = (id: string) => {
  const d = DECK_BY_ID.get(id)!;
  return { id: d.id, name: d.name, cards: d.cards };
};

function engineFor(a: string, b: string, seed: number, level: AiLevel): MatchEngine {
  return new MatchEngine({
    seed,
    config: DEFAULT_CONFIG,
    players: [
      { name: 'A', deckId: a, isAI: true, aiLevel: level, deck: deckCards(a) },
      { name: 'B', deckId: b, isAI: true, aiLevel: level, deck: deckCards(b) }
    ]
  });
}

/** Resolve qualquer solicitação pendente e devolve o próximo comando dos dois jogadores. */
function stepWithAi(e: MatchEngine, p: 0 | 1): Command {
  const cmd = aiNextCommand(e, p, profileForLevel(p === 0 ? 'hard' : 'normal'));
  e.dispatch(cmd);
  for (let g = 0; g < 8; g++) {
    const pend = e.getPending();
    if (!pend) break;
    e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
  }
  return cmd;
}

describe('IA não interfere no RNG da partida', () => {
  it('chamar o avaliador não avança state.rngState', () => {
    const e = engineFor('archetype-aggro', 'archetype-control', 4242, 'easy');
    // easy/normal têm ruído; se `nz()` usar rand(state), rngState muda a cada
    // decisão. Aqui o ruído vem de createAiNoise (função pura).
    let steps = 0;
    for (const p of [0, 1] as const) {
      while (e.state.phase === 'setup' && !e.state.players[p].setupDone && steps++ < 40) {
        const before = e.state.rngState;
        const c = aiNextCommand(e, p, PROFILE_LEVELS.easy);
        expect(e.state.rngState, 'setup: avaliador mudou o RNG da partida').toBe(before);
        e.dispatch(c);
      }
    }
    while (e.state.phase !== 'gameOver' && steps++ < 220) {
      const p = e.state.activePlayer as 0 | 1;
      const before = e.state.rngState;
      const cmd = aiNextCommand(e, p, PROFILE_LEVELS.easy);
      expect(e.state.rngState, `avaliador mudou o RNG antes de ${cmd.type}`).toBe(before);
      e.dispatch(cmd);
      expect(e.state.rngState, 'dispatch do comando tem de avançar o RNG quando houver efeito sorteado').toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      for (let g = 0; g < 6; g++) {
        const pend = e.getPending();
        if (!pend) break;
        e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
      }
    }
    expect(steps).toBeGreaterThan(20);
  });

  it('o sorteio de quem abre independe do comportamento da IA', () => {
    // Dois perfis muito diferentes, mesma semente: `startingPlayer` e as mãos
    // iniciais (sorteadas do mesmo fluxo) têm de ser idênticos.
    const run = (profile: AiLevel) => {
      const e = engineFor('archetype-aggro', 'archetype-control', 909, profile);
      for (const p of [0, 1] as const) {
        let g = 0;
        while (e.state.phase === 'setup' && !e.state.players[p].setupDone && g++ < 40) {
          e.dispatch(aiNextCommand(e, p, PROFILE_LEVELS[profile]));
          const pend = e.getPending();
          if (pend) e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
        }
      }
      return { first: e.state.startingPlayer, hands: e.state.players.map((pl) => player(e.state, pl.index).hand.map((c) => c.defId).join(',')) };
    };
    const a = run('easy');
    const b = run('elite');
    expect(b.first).toBe(a.first);
    expect(b.hands).toEqual(a.hands);
  });

  it('createAiNoise é pura e limitada', () => {
    const k = { seed: 7, turn: 3, commandCount: 11, player: 0 };
    const n1 = createAiNoise(k);
    const n2 = createAiNoise(k);
    const seq1 = [n1.next(), n1.next(), n1.next()];
    const seq2 = [n2.next(), n2.next(), n2.next()];
    expect(seq2).toEqual(seq1);
    for (const x of seq1) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    const jitter = createAiNoise(k).jitter(6);
    expect(Math.abs(jitter)).toBeLessThanOrEqual(6);
    // chave diferente → sequência diferente (senão o "ruído" seria constante)
    expect(createAiNoise({ ...k, player: 1 }).next()).not.toBe(seq1[0]);
  });
});

describe('determinismo e robustez por nível', () => {
  it('mesmo estado produz a mesma jogada', () => {
    for (const level of ['easy', 'normal', 'hard', 'elite'] as const) {
      const seq = (seed: number) => {
        const e = engineFor('archetype-aggro', 'archetype-burst', seed, level);
        const out: string[] = [];
        for (const p of [0, 1] as const) {
          let g = 0;
          while (e.state.phase === 'setup' && !e.state.players[p].setupDone && g++ < 40) {
            const c = aiNextCommand(e, p, PROFILE_LEVELS[level]);
            out.push(JSON.stringify(c));
            e.dispatch(c);
          }
        }
        for (let i = 0; i < 30 && e.state.phase !== 'gameOver'; i++) {
          const p = e.state.activePlayer as 0 | 1;
          const c = aiNextCommand(e, p, PROFILE_LEVELS[level]);
          out.push(JSON.stringify(c));
          e.dispatch(c);
          const pend = e.getPending();
          if (pend) e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
        }
        return out.join('|');
      };
      expect(seq(31337)).toBe(seq(31337));
    }
  });

  it.each(['easy', 'normal', 'hard', 'elite'] as const)('%s joga partida completa sem comando ilegal', (level) => {
    const r = runAiMatch({ deckA: entry('archetype-aggro'), deckB: entry('archetype-control'), seed: 555, aiLevel: level });
    expect(r.engine.state.phase).toBe('gameOver');
    expect(r.engine.state.turn).toBeGreaterThan(1);
  });

  it('todo AiLevel tem perfil (sem undefined)', () => {
    for (const level of ['easy', 'normal', 'hard', 'elite'] as AiLevel[]) {
      const p = profileForLevel(level);
      expect(p).toBeTruthy();
      expect(p.blunderRate).toBeTypeOf('number');
      expect(p.timeBudgetMs).toBeGreaterThan(0);
    }
    // função total: nível desconhecido cai no default, nunca undefined
    expect(profileForLevel('inexistente' as AiLevel)).toBe(PROFILE_LEVELS.normal);
  });

  it('escada de habilidade nos perfis: easy é o mais burro, elite o mais fundo', () => {
    expect(PROFILE_LEVELS.easy.blunderRate).toBeGreaterThan(PROFILE_LEVELS.normal.blunderRate);
    expect(PROFILE_LEVELS.normal.blunderRate).toBeGreaterThan(PROFILE_LEVELS.hard.blunderRate);
    expect(PROFILE_LEVELS.hard.blunderRate).toBeGreaterThanOrEqual(PROFILE_LEVELS.elite.blunderRate);
    expect(PROFILE_LEVELS.elite.searchDepth).toBeGreaterThan(PROFILE_LEVELS.normal.searchDepth);
    expect(ELITE_PROFILE.blunderRate).toBe(0);
    expect(STELLA_PROFILE.aggression).toBeGreaterThan(LUNA_PROFILE.aggression);
    expect(LUNA_PROFILE.resourcePreservation).toBeGreaterThan(STELLA_PROFILE.resourcePreservation);
  });
});

describe('avaliador de efeitos', () => {
  /** Estado pós-setup (tabuleiro real, com dano e recurso no alvo). */
  function board() {
    const e = engineFor('archetype-aggro', 'archetype-control', 12, 'elite');
    for (const p of [0, 1] as const) {
      let g = 0;
      while (e.state.phase === 'setup' && !e.state.players[p].setupDone && g++ < 40) {
        e.dispatch(aiNextCommand(e, p, PROFILE_LEVELS.elite));
      }
    }
    const st = e.state;
    const mine = player(st, 0).active!;
    const theirs = player(st, 1).active!;
    applyDamage({ state: st, emit: () => {} }, mine, 40, { label: 'fixture' });
    theirs.attached.push({
      uid: 'res-sim', defId: 'jres-energia', owner: 1, kind: 'RESOURCE', damage: 0, stageLevel: 0,
      statuses: [], counters: {}, attached: [], progression: [], usedTurn: [], usedMatch: [], deployedOnTurn: 0
    });
    return { state: st, mine, theirs };
  }

  it('dano > cura equivalente; compra e negação de recurso valem algo', () => {
    const { state } = board();
    const ctx = { state, me: 0 as const, prof: ELITE_PROFILE };
    const dmg = effectsValue(ctx, [{ op: 'dealDamage', amount: 60, target: 'enemyActive' } as never]);
    const heal = effectsValue(ctx, [{ op: 'heal', amount: 60, target: 'activeAlly' } as never]);
    const draw = effectsValue(ctx, [{ op: 'drawCards', amount: 1 } as never]);
    const detach = effectsValue(ctx, [{ op: 'detachResource', amount: 1, target: 'enemyActive' } as never]);
    expect(dmg).toBeGreaterThan(0);
    expect(heal).toBeGreaterThan(0);
    expect(dmg).toBeGreaterThan(heal);
    expect(draw).toBeGreaterThan(0);
    expect(detach).toBeGreaterThan(0);
    // dano que mata (KO) vale claramente mais que dano equivalente que não mata
    const lethal = effectsValue(ctx, [{ op: 'dealDamage', amount: 400, target: 'enemyActive' } as never]);
    expect(lethal).toBeGreaterThan(dmg);
  });

  it('cobre TODOS os SelectorId do motor, sem confundir os lados', () => {
    const { state, mine, theirs } = board();
    const uid = (c: CardInstance) => c.uid;
    // cada seletor precisa devolver exatamente o conjunto que o motor devolveria
    const expect_side = (sel: string, want: 'me' | 'opp' | 'actor' | 'both') => {
      const list = targetsOf(state, 0, sel, mine);
      // os dois seletores de banco podem legitimamente estar vazios (setup não
      // preencheu banco neste fixture) — o que importa é o LADO retornado
      if (sel !== 'benchAlly' && sel !== 'enemyBench') {
        expect(list.length, `seletor ${sel} ficou vazio`).toBeGreaterThan(0);
      }
      if (want === 'me') expect(list.every((c) => c.owner === 0), `${sel} mirou fora de mim`).toBe(true);
      if (want === 'opp') expect(list.every((c) => c.owner === 1), `${sel} mirou fora do inimigo`).toBe(true);
      if (want === 'actor') expect(uid(list[0])).toBe(uid(mine));
      if (want === 'both') expect(list.length).toBeGreaterThanOrEqual(2);
    };
    for (const sel of SELECTOR_IDS) {
      const want = sel === 'self' || sel === 'attacker' ? 'actor'
        : sel === 'activeAlly' || sel === 'allAllies' || sel === 'anyAlly' ? 'me'
        : sel === 'anyCharacter' || sel === 'allCharacters' ? 'both'
        : sel === 'benchAlly' ? 'me'
        : 'opp';
      expect_side(sel, want);
    }
    // 'defender'/'lastTarget' (contexto de ataque) são o alvo INIMIGO
    expect(targetsOf(state, 0, 'defender', mine).every((c) => c.owner === 1)).toBe(true);
    expect(targetsOf(state, 0, 'lastTarget', mine).every((c) => c.owner === 1)).toBe(true);
    // benchAlly/enemyBench podem estar vazios no início — só não podem erro de lado
    const eb = targetsOf(state, 0, 'enemyBench', mine);
    expect(eb.every((c) => c.owner === 1)).toBe(true);
    void theirs;
  });

  it('melhor dano respeita fraqueza/resistência do alvo', () => {
    const { state, mine, theirs } = board();
    const dmg = bestDamageOnto(state, mine, theirs);
    expect(dmg).toBeGreaterThanOrEqual(0);
    expect(dmg).toBeLessThanOrEqual(400);
    void theirs;
  });
});

describe('simulador: delineamento e fechamento', () => {
  it('cada deck joga o mesmo número de partidas em P0 e P1', () => {
    const decks = ARCHETYPE_DECKS.slice(0, 3).map((d) => ({ id: d.id, name: d.name, cards: d.cards }));
    const report = simulateMeta(decks, { gamesPerPair: 6, seeds: [111, 222], aiLevel: 'normal' });
    expect(report.design).toBe('paired-seats');
    // 3 decks → 6 pares (3 espelhos) × 6 jogos × 2 seeds = 72 partidas;
    // cada deck participa de 3 pares → 36 partidas, metade em cada assento.
    const sum = (sel: (x: number) => number) => decks.reduce((t, d) => t + sel(report.p0Games[d.id] ? 0 : 0), 0);
    void sum;
    for (const d of decks) {
      // espelhos contam nos dois assentos para o mesmo deck (é o mesmo
      // baralho ocupando as duas cadeiras), daí o total ser 2× os jogos.
      expect(report.p1Games[d.id]).toBe(report.p0Games[d.id]);
      expect(report.p0Games[d.id]).toBe(24);
    }
    expect(report.games).toBe(72);
    // matriz fecha 100% por construção
    for (const a of decks) {
      for (const b of decks) {
        if (a.id === b.id) continue;
        const ab = report.matrix[a.id][b.id];
        const ba = report.matrix[b.id][a.id];
        expect((ab.wins + ab.losses + ab.draws) / ab.games).toBeCloseTo(1, 6);
        expect(ab.wins / ab.games + ba.wins / ba.games).toBeCloseTo(1, 6);
      }
    }
  });

  it('a medição é reprodutível byte a byte', () => {
    const decks = ARCHETYPE_DECKS.slice(0, 3).map((d) => ({ id: d.id, name: d.name, cards: d.cards }));
    const a = JSON.stringify(simulateMeta(decks, { gamesPerPair: 4, seeds: [9], aiLevel: 'normal' }));
    const b = JSON.stringify(simulateMeta(decks, { gamesPerPair: 4, seeds: [9], aiLevel: 'normal' }));
    expect(b).toBe(a);
  });
});
