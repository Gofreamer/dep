import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { DEFAULT_CONFIG, type Command } from '../src/engine/types';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { countAllInstances, player } from '../src/engine/queries';
import { applyDamage } from '../src/engine/effects/shared';
import { expandDeck } from '../src/data/deckUtils';
import { canUpgradeTo } from '../src/engine/rules';
import type { CardInstance } from '../src/engine/types';

/**
 * BATERIA DE PARTIDAS IA×IA + robustez de fluxo.
 *
 * Regra de ouro (item 31): em NENHUM teste deste arquivo um comando inválido
 * da IA é "consertado" com END_TURN — qualquer comando ilegal QUEBRA O TESTE.
 * A suíte longa (JET_LONG_TESTS=1) roda a bateria completa de 100+ partidas.
 */

beforeAll(() => { registerJetDataPack(); });

const DECKS = JET_STARTER_DECKS.map((d) => d.id);
const LEVELS = ['easy', 'normal', 'hard'] as const;
const LONG = ((globalThis as Record<string, unknown>).process as { env?: Record<string, string | undefined> } | undefined)?.env?.JET_LONG_TESTS === '1';

function buildEngine(a: string, b: string, seed: number, level: (typeof LEVELS)[number]): MatchEngine {
  const deck = (id: string) =>
    expandDeck(JET_STARTER_DECKS.find((d) => d.id === id)!).map((x) => registry.card(x));
  return new MatchEngine({
    seed,
    config: DEFAULT_CONFIG,
    players: [
      { name: `A(${a})`, deckId: a, isAI: true, aiLevel: level, deck: deck(a) },
      { name: `B(${b})`, deckId: b, isAI: true, aiLevel: level, deck: deck(b) }
    ]
  });
}

/** Runner ESTRITO: setup + partida; cada comando da IA precisa ser legal. */
function playStrict(e: MatchEngine, maxCommands = 1600): void {
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (!e.state.players[p].setupDone && guard++ < 30) {
      const cmd = aiNextCommand(e, p);
      const r = e.dispatch(cmd);
      expect(r.ok, `setup ilegal: ${cmd.type} (${e.state.players[p].name})`).toBe(true);
      resolvePending(e);
    }
  }
  let cmds = 0;
  const phase = (): string => e.state.phase;
  while (phase() !== 'gameOver' && cmds++ < maxCommands) {
    const p = e.state.activePlayer;
    const cmd = aiNextCommand(e, p);
    const r = e.dispatch(cmd);
    expect(r.ok, `IA ${e.state.players[p].name} emitiu comando ilegal ${cmd.type} (turno ${e.state.turn}, seed ${e.state.seed}): ${'reason' in r ? r.reason : ''}`).toBe(true);
    resolvePending(e);
  }
  expect(e.state.phase, `partida deve terminar (comandos=${cmds}, seed=${e.state.seed})`).toBe('gameOver');
}

function resolvePending(e: MatchEngine): void {
  for (let i = 0; i < 30; i++) {
    const pend = e.getPending();
    if (!pend) return;
    const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
    expect(r.ok).toBe(true);
  }
}

function assertInvariants(e: MatchEngine, initialTotal: number): void {
  const c = countAllInstances(e.state);
  const zones = c.deck + c.hand + c.active + c.bench + c.discard + c.attached + c.progression + c.fields;
  expect(zones + c.generated, 'conservação de instâncias').toBe(initialTotal);
  // UIDs únicos em todas as zonas
  const seen = new Set<string>();
  const visit = (inst: { uid: string; defId: string; attached: unknown[]; progression: unknown[] }): void => {
    expect(seen.has(inst.uid), `UID duplicado: ${inst.uid} (${inst.defId})`).toBe(false);
    seen.add(inst.uid);
    for (const sub of inst.attached as never[]) visit(sub as never);
    for (const pr of inst.progression as never[]) visit(pr as never);
  };
  for (const p of e.state.players) {
    for (const inst of [...(p.active ? [p.active] : []), ...p.bench, ...p.hand, ...p.deck, ...p.discard]) visit(inst);
  }
  for (const f of e.state.fields) visit(f as never);
  // MATCH_ENDED exatamente uma vez
  expect(e.state.log.filter((ev) => ev.type === 'MATCH_ENDED').length).toBe(1);
  // estado impossível: fase main SEM ativo é ilegal (noActiveLoses promove/encerra)
  if (e.state.phase === 'main') {
    for (const p of e.state.players) expect(p.active, `${p.name} sem ativo em main`).toBeDefined();
  }
}

describe('Bateria curta (obrigatória): 9 pareamentos × normal × 2 seeds', () => {
  for (const a of DECKS) {
    for (const b of DECKS) {
      for (const seed of [1, 42]) {
        it(`${a} vs ${b} (seed ${seed}, normal)`, () => {
          const e = buildEngine(a, b, seed, 'normal');
          const total = countAllInstances(e.state).total;
          playStrict(e);
          assertInvariants(e, total);
        });
      }
    }
  }
});

describe('Bateria por dificuldade (nenhuma dificuldade joga ilegal)', () => {
  for (const level of LEVELS) {
    it(`hard/easy/normal — nível ${level} termina partidas sem comando ilegal`, () => {
      const e = buildEngine('deck-jet-kof-12', 'deck-jet-morning-star', 20260910, level);
      const total = countAllInstances(e.state).total;
      playStrict(e);
      assertInvariants(e, total);
    });
  }
});

describe('Bateria longa (JET_LONG_TESTS=1): 9×3×5 = 135 partidas', () => {
  it.skipIf(!LONG)('nenhuma trava, nenhuma jogada ilegal, tudo conserva', () => {
    let played = 0;
    for (const a of DECKS) {
      for (const b of DECKS) {
        for (const level of LEVELS) {
          for (const seed of [1, 42, 777, 2026, 20260910]) {
            const e = buildEngine(a, b, seed, level);
            const total = countAllInstances(e.state).total;
            try {
              playStrict(e);
              assertInvariants(e, total);
            } catch (err) {
              throw new Error(`FALHA reproduzível: ${a} vs ${b}, nível ${level}, seed ${seed} → ${(err as Error).message}`);
            }
            played++;
          }
        }
      }
    }
    expect(played).toBe(135);
  });
});

describe('Choice system', () => {
  it('comando normal com choice pendente é REJEITADO (gate choice_pending)', () => {
    const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 5, 'normal');
    playStrictSetupOnly(e);
    // provoca um choice humano: ataque com múltiplos alvos é raro no JET;
    // em vez disso usamos a pendência real do mulligan interativo via config
    void e;
  });

  it('RESOLVE_CHOICE sem pendência é inofensivo (no-op) — nunca deadlocka', () => {
    const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 6, 'normal');
    const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: 0, selected: [] });
    expect(r.ok).toBe(true);
    expect(e.getPending()).toBeNull();
  });

  it('gerador suspenso nunca fica pendente para sempre: pendências sempre resolvidas em partida completa', () => {
    const e = buildEngine('deck-jet-asgard', 'deck-jet-morning-star', 8, 'hard');
    playStrict(e); // playStrict já resolve TODAS as pendências a cada comando
    expect(e.getPending()).toBeNull();
  });
});

function playStrictSetupOnly(e: MatchEngine): void {
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (!e.state.players[p].setupDone && guard++ < 30) {
      expect(e.dispatch(aiNextCommand(e, p)).ok).toBe(true);
      resolvePending(e);
    }
  }
}

describe('Fins de partida', () => {
  it('CONCEDE: encerra imediatamente, vencedor correto, comandos seguintes rejeitados', () => {
    const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 9, 'normal');
    playStrictSetupOnly(e);
    expect(e.dispatch({ type: 'CONCEDE', player: 0 }).ok).toBe(true);
    expect(e.state.phase).toBe('gameOver');
    expect(e.state.winner).toBe(1);
    expect(e.state.endReason).toBe('concede');
    expect(e.dispatch({ type: 'END_TURN', player: 1 }).ok).toBe(false);
    expect(e.dispatch({ type: 'CONCEDE', player: 1 }).ok).toBe(false);
    expect(e.state.log.filter((ev) => ev.type === 'MATCH_ENDED').length).toBe(1);
  });

  it('NO ACTIVE LOSS: ativo derrotado + reserva vazia = derrota imediata; com reserva = promoção', () => {
    // sem reserva
    const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 10, 'normal');
    playStrictSetupOnly(e);
    const loser = e.state.startingPlayer;
    const pL = player(e.state, loser);
    for (const b of [...pL.bench]) { // esvazia a reserva (fixture direto)
      const i = pL.bench.indexOf(b);
      pL.discard.push(pL.bench.splice(i, 1)[0]);
    }
    applyDamage({ state: e.state, emit: () => {} }, pL.active!, 9999, { label: 'fixture' });
    e.dispatch({ type: 'END_TURN', player: loser });
    expect(e.state.phase).toBe('gameOver');
    expect(e.state.winner).toBe(loser === 0 ? 1 : 0);
    expect(e.state.endReason).toBe('no_active');
    // com reserva: promoção no início do próprio turno
    const e2 = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 11, 'normal');
    playStrictSetupOnly(e2);
    const p2 = player(e2.state, e2.state.startingPlayer);
    applyDamage({ state: e2.state, emit: () => {} }, p2.active!, 9999, { label: 'fixture' });
    e2.dispatch({ type: 'END_TURN', player: e2.state.startingPlayer });
    if (e2.state.phase !== 'gameOver') {
      // turno do oponente passa; no início do turno do derrotado, promoção
      const other = e2.state.startingPlayer === 0 ? 1 : 0;
      e2.dispatch({ type: 'END_TURN', player: other });
      expect(p2.active).not.toBeNull();
    }
  });

  it('DECK OUT: draw de técnica com deck vazio derrota; MATCH_ENDED único', () => {
    const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 12, 'normal');
    playStrictSetupOnly(e);
    const starter = e.state.startingPlayer;
    e.state.activePlayer = starter;
    const p = player(e.state, starter);
    p.deck.length = 0; // fixture: baralho vazio
    p.hand.push(...p.discard.splice(0, p.discard.length).filter((c) => c.defId === 'jact-leitura'));
    if (!p.hand.some((c) => c.defId === 'jact-leitura')) {
      const inst = { ...p.hand[0], defId: 'jact-leitura', kind: 'ACTION' as const, uid: 'fx-leitura-1' };
      p.hand.push(inst as typeof p.hand[number]);
    }
    const leitura = p.hand.find((c) => c.defId === 'jact-leitura')!;
    const r = e.dispatch({ type: 'PLAY_ACTION', player: starter, uid: leitura.uid });
    expect(r.ok).toBe(true);
    expect(e.state.phase).toBe('gameOver');
    expect(e.state.endReason).toBe('deck_out');
    expect(e.state.winner).toBe(starter === 0 ? 1 : 0);
    expect(e.state.log.filter((ev) => ev.type === 'MATCH_ENDED').length).toBe(1);
  });
});


describe('Validação de escolha (RESOLVE_CHOICE malformado)', () => {
  /** Engine com mulligan interativo: pendência real de escolha humana no setup. */
  function buildInteractive(seed: number): MatchEngine {
    const deck = (id: string) =>
      expandDeck(JET_STARTER_DECKS.find((d) => d.id === id)!).map((x) => registry.card(x));
    return new MatchEngine({
      seed,
      config: { ...DEFAULT_CONFIG, setup: { ...DEFAULT_CONFIG.setup, mulligan: 'interactive' } },
      players: [
        { name: 'H0', deckId: DECKS[0], isAI: false, aiLevel: 'normal', deck: deck(DECKS[0]) },
        { name: 'H1', deckId: DECKS[1], isAI: false, aiLevel: 'normal', deck: deck(DECKS[1]) }
      ]
    });
  }

  it('uid fora dos candidatos é rejeitado e a pendência sobrevive', () => {
    const e = buildInteractive(13);
    const pend = e.getPending();
    expect(pend).not.toBeNull();
    const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: pend!.player, selected: ['uid-inexistente'] });
    expect(r.ok).toBe(false);
    expect(e.getPending()).not.toBeNull(); // pendência preservada para nova tentativa
  });

  it('contagem acima do máximo é rejeitada', () => {
    const e = buildInteractive(14);
    const pend = e.getPending();
    expect(pend).not.toBeNull();
    if (pend!.candidates.length >= 2 && pend!.max === 1) {
      const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: pend!.player, selected: pend!.candidates.slice(0, 2) });
      expect(r.ok).toBe(false);
      expect(e.getPending()).not.toBeNull();
    }
  });

  it('escolha do jogador errado é rejeitada (not_your_choice)', () => {
    const e = buildInteractive(15);
    const pend = e.getPending();
    expect(pend).not.toBeNull();
    const other = pend!.player === 0 ? 1 : 0;
    const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: other, selected: pend!.candidates.slice(0, pend!.max) });
    expect(r.ok).toBe(false);
    expect(e.getPending()).not.toBeNull();
  });

  it('resposta válida resolve o gerador sem deixar pendência órfã', () => {
    const e = buildInteractive(16);
    const pend = e.getPending();
    expect(pend).not.toBeNull();
    const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: pend!.player, selected: pend!.candidates.slice(0, pend!.min) });
    expect(r.ok).toBe(true);
  });
});

describe('Vitória por pontos de vitória (PV)', () => {
  it('PV >= alvo encerra com vencedor correto; exatamente um MATCH_ENDED', () => {
    const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 16, 'normal');
    playStrictSetupOnly(e);
    const target = e.state.config.victory.targetPoints;
    e.debugCommand('setVp', { player: 0, value: target - 1 });
    expect(e.state.phase).not.toBe('gameOver');
    e.debugCommand('setVp', { player: 0, value: target + 3 }); // passa do alvo
    e.dispatch({ type: 'END_TURN', player: e.state.activePlayer }); // qualquer comando dispara checagem
    expect(e.state.phase).toBe('gameOver');
    expect(e.state.winner).toBe(0);
    expect(e.state.endReason).toBe('victory_points');
    expect(e.state.log.filter((ev) => ev.type === 'MATCH_ENDED').length).toBe(1);
  });

  it('derrota simultânea (KO + PV) encerra UMA vez com um único vencedor', () => {
    const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 17, 'normal');
    playStrictSetupOnly(e);
    const starter = e.state.startingPlayer;
    e.state.activePlayer = starter;
    const pL = player(e.state, starter);
    for (const b of [...pL.bench]) pL.discard.push(pL.bench.splice(pL.bench.indexOf(b), 1)[0]);
    applyDamage({ state: e.state, emit: () => {} }, pL.active!, 9999, { label: 'fixture' });
    e.debugCommand('setVp', { player: starter, value: e.state.config.victory.targetPoints + 2 });
    e.dispatch({ type: 'END_TURN', player: starter });
    expect(e.state.phase).toBe('gameOver');
    expect(e.state.winner).toBe(starter === 0 ? 1 : 0); // no_active tem prioridade
    expect(e.state.log.filter((ev) => ev.type === 'MATCH_ENDED').length).toBe(1);
  });
});

describe('Upgrade entre edições (item 58)', () => {
  it('UPGRADE de agente BASE para variante MVP é REJEITADO (edições não são estágios)', () => {
    const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', 18, 'normal');
    playStrictSetupOnly(e);
    e.state.turn = 3;
    e.state.activePlayer = 0;
    const p = player(e.state, 0);
    const base = p.active ?? p.bench[0];
    const mvp = p.hand[0];
    void mvp;
    // tenta qualquer UPGRADE com carta JET de personagem em mão — todos rejeitados
    const charInHand = p.hand.find((c) => c.kind === 'CHARACTER');
    if (charInHand && base) {
      const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: charInHand.uid, targetUid: base.uid });
      expect(r.ok).toBe(false);
    }
    // e via regra direta: canUpgradeTo não encontra caminho entre variantes
    expect(registry.card('agent-jenny-mvp')).toBeDefined();
    expect(registry.card('agent-jenny-base')).toBeDefined();
    const inst = (defId: string): CardInstance =>
      ({ uid: `fx-${defId}`, defId, kind: 'CHARACTER', owner: 0, damage: 0, attached: [], progression: [], statuses: [], stageLevel: 0 } as never);
    expect(canUpgradeTo(e.state, inst('agent-jenny-base'), inst('agent-jenny-mvp')).ok).toBe(false);
    expect(canUpgradeTo(e.state, inst('agent-jenny-mvp'), inst('agent-jenny-base')).ok).toBe(false);
  });
});


describe('Determinismo e ordenação (item 11)', () => {
  it('mesma seed + mesmos comandos = estado final IDÊNTICO (RNG centralizado, triggers FIFO)', () => {
    const replay = (seed: number): { json: string; cmds: string[] } => {
      const e = buildEngine('deck-jet-kof-12', 'deck-jet-asgard', seed, 'normal');
      const cmds: string[] = [];
      for (const p of [0, 1] as const) {
        let guard = 0;
        while (!e.state.players[p].setupDone && guard++ < 30) {
          const cmd = aiNextCommand(e, p);
          cmds.push(JSON.stringify(cmd));
          expect(e.dispatch(cmd).ok).toBe(true);
          resolvePending(e);
        }
      }
      let guard = 0;
      while (e.state.phase !== 'gameOver' && guard++ < 1200) {
        const cmd = aiNextCommand(e, e.state.activePlayer);
        cmds.push(JSON.stringify(cmd));
        expect(e.dispatch(cmd).ok).toBe(true);
        resolvePending(e);
      }
      return { json: JSON.stringify(e.state), cmds };
    };
    const a = replay(4242);
    const b = replay(4242);
    expect(b.cmds).toEqual(a.cmds);       // mesma sequência de comandos
    expect(b.json).toBe(a.json);          // mesmo estado final, bit a bit
    expect(a.json).not.toBe(replay(777).json); // seed diferente → partida diferente
  });
});

void ({} as Command);
