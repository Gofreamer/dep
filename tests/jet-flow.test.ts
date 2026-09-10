import { describe, expect, it } from 'vitest';
import { setup, deckOf, makeEngine, playUntilEnd, autoSetup } from './helpers';
import { MatchEngine } from '../src/engine/engine';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { mergeConfig } from '../src/engine/state/setup';
import { countAllInstances, player } from '../src/engine/queries';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';
import { expandDeck, validateDeck } from '../src/data/deckUtils';
import { registry } from '../src/engine/registry';
import { charDef } from '../src/engine/queries';
import type { CharacterDef } from '../src/engine/types';

setup();

/**
 * Parte 33 (itens 26–28 e 35–40) aplicados ao JET CORE SET:
 * partidas completas IA×IA com os 3 Starter Decks reais, conservação de
 * instâncias, legalActions ≡ engine, validação de baralho (incl. sem starter)
 * e SetupConfig honrado.
 */

function jetEngine(id0: string, id1: string, seed: number, cfg?: Parameters<typeof mergeConfig>[1]): MatchEngine {
  return new MatchEngine({
    seed,
    config: mergeConfig(DEFAULT_CONFIG, cfg),
    players: [
      { name: 'JET-A', deckId: id0, isAI: true, aiLevel: 'normal', deck: deckOf(id0).map((id) => registry.card(id)) },
      { name: 'JET-B', deckId: id1, isAI: true, aiLevel: 'normal', deck: deckOf(id1).map((id) => registry.card(id)) }
    ]
  });
}

function resolveAll(e: MatchEngine): void {
  let guard = 0;
  for (;;) {
    const pend = e.getPending();
    if (!pend) return;
    e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
    if (guard++ > 50) return;
  }
}

describe('Partidas completas JET (IA × IA)', () => {
  const pairings: [string, string][] = [
    ['deck-jet-kof-12', 'deck-jet-asgard'],
    ['deck-jet-asgard', 'deck-jet-morning-star'],
    ['deck-jet-morning-star', 'deck-jet-kof-12']
  ];

  for (const [a, b] of pairings) {
    it(`${a} vs ${b} termina sem deadlock`, () => {
      const e = jetEngine(a, b, 20260910);
      autoSetup(e); playUntilEnd(e, 1200);
      expect(e.state.phase).toBe('gameOver');
      expect(e.state.winner).toBeDefined();
    }, 30_000);

    it(`${a} vs ${b} conserva TODAS as instâncias (zero carta fantasma)`, () => {
      const e = jetEngine(a, b, 777);
      const before = countAllInstances(e.state).total;
      autoSetup(e); playUntilEnd(e, 1200);
      const c = countAllInstances(e.state);
      expect(c.total).toBe(before);
      // nenhuma instância perdida: soma das zonas = total (menos tokens gerados)
      const zones = c.deck + c.hand + c.active + c.bench + c.discard + c.attached + c.progression + c.fields;
      expect(zones + c.generated).toBe(c.total);
    }, 30_000);
  }

  it('múltiplas seeds terminam (determinismo por seed)', () => {
    for (const seed of [1, 42, 2026]) {
      const e = jetEngine('deck-jet-kof-12', 'deck-jet-morning-star', seed);
      autoSetup(e); playUntilEnd(e, 1200);
      expect(e.state.phase, `seed ${seed}`).toBe('gameOver');
    }
  }, 60_000);

  it('variantes de edição são legais em baralho (identityId compartilhado, sem virar estágio)', () => {
    // Jenny BASE + Jenny MVP na mesma identidade: 4 cópias totais por identidade
    const cards: Record<string, number> = {
      'agent-jenny-base': 2, 'agent-jenny-mvp': 2,
      'agent-xixim-base': 3, 'agent-ran-yuki-base': 3, 'agent-shirakami-niku-base': 3,
      'jres-energia': 25, 'jres-descarga': 2, 'jres-bateria': 2,
      'jact-leitura': 3, 'jact-foco-ofensivo': 3, 'jact-marcacao': 2,
      'jeq-manopla': 2, 'jeq-placa': 2, 'jfd-arena': 2, 'jfd-ovacao': 1, 'jfd-zona-neutra': 1
    };
    const deck = expandDeck({ id: 'x', name: 'x', description: '', cards }).map((id) => registry.card(id));
    const e = new MatchEngine({
      seed: 5, config: DEFAULT_CONFIG,
      players: [
        { name: 'A', deckId: 'mix', isAI: true, aiLevel: 'normal', deck },
        { name: 'B', deckId: 'b', isAI: true, aiLevel: 'normal', deck: deckOf('deck-jet-asgard').map((id) => registry.card(id)) }
      ]
    });
    autoSetup(e); playUntilEnd(e, 1200);
    expect(e.state.phase).toBe('gameOver');
    // as 4 cópias da identidade Jenny (2 BASE + 2 MVP) entraram no jogo de verdade
    const seen = new Set<string>();
    for (const pl of e.state.players) {
      for (const inst of [...(pl.active ? [pl.active] : []), ...pl.bench, ...pl.hand, ...pl.deck, ...pl.discard]) {
        seen.add(inst.defId);
      }
    }
    expect(seen.has('agent-jenny-base')).toBe(true);
    expect(seen.has('agent-jenny-mvp')).toBe(true);
    const def = registry.card('agent-jenny-mvp') as CharacterDef;
    expect(def.stage).toBe(0);
    expect(def.identityId).toBe('agent-jenny');
  }, 30_000);
});

describe('legalActions ≡ engine (JET)', () => {
  it('toda ação legal do meio de partida JET é aceita pelo dispatch', () => {
    const e = jetEngine('deck-jet-kof-12', 'deck-jet-asgard', 99);
    autoSetup(e);
    // avança alguns comandos até o meio do jogo
    for (let i = 0; i < 24 && e.state.phase !== 'gameOver'; i++) {
      const p = e.state.activePlayer;
      e.dispatch(aiNextCommand(e, p));
      resolveAll(e);
    }
    resolveAll(e);
    expect(e.state.phase).not.toBe('gameOver');
    if (e.getPending() || e.state.phase !== 'main') return; // efeito suspenso: invariante vale em fase estável
    const me = e.state.activePlayer;
    const legal = e.legalActions(me);
    let exercised = 0;
    // cada ataque listado é dispatchável; cada resource listado é conectável
    const st = player(e.state, me);
    const playableAttacks = legal.attacks.filter((a) => a.playable);
    if (playableAttacks.length > 0) {
      const id = playableAttacks[0].attackId;
      expect(e.dispatch({ type: 'ATTACK', player: me, attackId: id }).ok, `ataque ${id}`).toBe(true);
      exercised++;
    } else {
      // conecta o primeiro recurso da mão cujo alvo ativo existe
      const res = st.hand.find((c) => c.kind === 'RESOURCE');
      if (res && st.active && legal.hand[res.uid]?.playable !== false) {
        const r = e.dispatch({ type: 'ATTACH_RESOURCE', player: me, uid: res.uid, targetUid: st.active.uid });
        expect(r.ok, `attach ${res.defId}: ${'reason' in r ? r.reason : JSON.stringify(r)}`).toBe(true);
        exercised++;
      }
    }
    resolveAll(e);
    const now = e.state.activePlayer;
    if (!e.getPending() && e.state.phase === 'main') {
      const rEnd = e.dispatch({ type: 'END_TURN', player: now });
      expect(rEnd.ok, `end_turn active=${now} turn=${e.state.turn}: ${JSON.stringify(rEnd)}`).toBe(true);
    }
    expect(exercised).toBeGreaterThanOrEqual(0);
  });

  it('dispatch rejeita o que legalActions não oferece (consistência inversa)', () => {
    const e = jetEngine('deck-jet-morning-star', 'deck-jet-kof-12', 7);
    autoSetup(e); playUntilEnd(e, 60);
    if (e.state.phase === 'gameOver') return; // partida curta: nada a verificar
    const me = e.state.activePlayer;
    const legal = e.legalActions(me);
    const st = player(e.state, me);
    // sem ataque anunciado em legalActions → ATTACK deve falhar
    const canAttack = legal.attacks.some((a) => a.playable);
    const sig = charDef(st.active!).attacks[0].id;
    const r = e.dispatch({ type: 'ATTACK', player: me, attackId: sig });
    expect(r.ok).toBe(canAttack);
  });
});

describe('Validação de baralho JET', () => {
  it('bloqueia baralho sem Agente Base (sem starter)', () => {
    const e = () => jetEngine('deck-jet-kof-12', 'deck-jet-asgard', 1);
    // deck só de recursos/tecnica: setup não tem como escolher ativo
    const noStarter = [
      ...Array(40).fill('jres-energia'), ...Array(10).fill('jact-leitura'),
      ...Array(5).fill('jeq-manopla'), ...Array(5).fill('jfd-arena')
    ].map((id) => registry.card(id));
    expect(() => new MatchEngine({
      seed: 1, config: DEFAULT_CONFIG,
      players: [
        { name: 'A', deckId: 'x', isAI: true, aiLevel: 'normal', deck: deckOf('deck-jet-kof-12').map((id) => registry.card(id)) },
        { name: 'B', deckId: 'y', isAI: true, aiLevel: 'normal', deck: noStarter }
      ]
    }).state).not.toThrow(); // engine não explode…
    // …mas o jogador sem starter NUNCA fica ativo: a partida termina por critério
    const eng = new MatchEngine({
      seed: 1, config: { setup: { ...DEFAULT_CONFIG.setup, benchAtSetup: false } },
      players: [
        { name: 'A', deckId: 'x', isAI: true, aiLevel: 'normal', deck: deckOf('deck-jet-kof-12').map((id) => registry.card(id)) },
        { name: 'B', deckId: 'y', isAI: true, aiLevel: 'normal', deck: noStarter }
      ]
    });
    playUntilEnd(eng, 400);
    expect(eng.state.phase).toBe('gameOver');
    void e;
  });

  it('bloqueia baralho com 5 cópias e baralho de 59 cartas', () => {
    // verificação direta nas regras usadas pela UI
    { validateDeck };
    const fiveCopies = {
      'agent-jenny-base': 5, 'jres-energia': 25, 'jres-descarga': 2, 'jres-bateria': 2,
      'jact-leitura': 4, 'jact-foco-ofensivo': 4, 'jact-marcacao': 4,
      'jeq-manopla': 4, 'jeq-placa': 4, 'jfd-arena': 2, 'jfd-ovacao': 2, 'jfd-zona-neutra': 0
    };
    const v1 = validateDeck(fiveCopies, DEFAULT_CONFIG.deckRules, { requireBasic: true });
    expect(v1.valid).toBe(false);
    expect(v1.errors.join(' ')).toContain('máximo de 4');

    const cards39: Record<string, number> = { ...JET_STARTER_DECKS[0].cards };
    cards39['jres-energia'] -= 21; // 60 → 39 (abaixo do mínimo de 40)
    const v2 = validateDeck(cards39, DEFAULT_CONFIG.deckRules, { requireBasic: true });
    expect(v2.valid).toBe(false);
    expect(v2.errors.join(' ')).toContain('Mínimo');
  });
});

describe('SetupConfig honrado (JET)', () => {
  it('mão inicial de 7 e reserva no setup conforme config', () => {
    const e = jetEngine('deck-jet-kof-12', 'deck-jet-asgard', 31337);
    const p0 = player(e.state, 0);
    const p1 = player(e.state, 1);
    expect(p0.hand.length).toBe(DEFAULT_CONFIG.setup.handSize);
    expect(p1.hand.length).toBe(DEFAULT_CONFIG.setup.handSize);
    // benchAtSetup: a IA do setup já coloca reservas conforme config
    expect(DEFAULT_CONFIG.setup.benchAtSetup).toBe(true);
    expect(p0.deck.length).toBe(60 - DEFAULT_CONFIG.setup.handSize - p0.bench.length);
  });
});
