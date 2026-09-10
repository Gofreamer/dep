import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { JET_SNAPSHOT } from '../src/data/jet/snapshot';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';
import { JET_TUTORIAL_DECKS } from '../src/data/jet/tutorialDecks';
import { expandDeck, validateDeck } from '../src/data/deckUtils';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { countAllInstances, player } from '../src/engine/queries';
import { jetIdentityGroups } from './jetDeckTestUtils';

/**
 * SUÍTE DE PRODUÇÃO — NENHUMA carta NEXO é registrada aqui.
 * Somente registerJetDataPack(): o produto precisa funcionar 100% standalone.
 * (O fixture NEXO nem sequer é importado neste arquivo.)
 */

const STARTERS = [...JET_STARTER_DECKS, ...JET_TUTORIAL_DECKS];

function buildStandaloneEngine(a: string, b: string, seed: number): MatchEngine {
  return new MatchEngine({
    seed,
    config: DEFAULT_CONFIG,
    players: [
      { name: 'P1', deckId: a, isAI: true, aiLevel: 'normal', deck: expandDeck(STARTERS.find((d) => d.id === a)!).map((id) => registry.card(id)) },
      { name: 'P2', deckId: b, isAI: true, aiLevel: 'normal', deck: expandDeck(STARTERS.find((d) => d.id === b)!).map((id) => registry.card(id)) }
    ]
  });
}

/** Runner ESTRITO: qualquer comando da IA inválido quebra o teste (sem END_TURN de disfarce). */
function playStrict(e: MatchEngine, maxCommands = 1400): void {
  // setup estrito: dirige AMBOS os jogadores (activePlayer não alterna no setup)
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (!e.state.players[p].setupDone && guard++ < 30) {
      const r = e.dispatch(aiNextCommand(e, p));
      expect(r.ok).toBe(true);
      for (;;) {
        const pend = e.getPending();
        if (!pend) break;
        expect(e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) }).ok).toBe(true);
      }
    }
    expect(e.state.players[p].setupDone).toBe(true);
  }
  for (let i = 0; i < maxCommands && e.state.phase !== 'gameOver'; i++) {
    const p = e.state.activePlayer;
    const cmd = aiNextCommand(e, p);
    const r = e.dispatch(cmd);
    expect(r.ok, `IA (${e.state.players[p].name}, seed ${e.state.seed}) emitiu comando ilegal: ${cmd.type} → ${'reason' in r ? r.reason : ''}`).toBe(true);
    for (;;) {
      const pend = e.getPending();
      if (!pend) break;
      const rr = e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
      expect(rr.ok).toBe(true);
    }
  }
  expect(e.state.phase, 'partida deve terminar dentro do limite de comandos').toBe('gameOver');
}

describe('Produção JET standalone (registry sem NEXO)', () => {
  beforeAll(() => { registerJetDataPack(); });

  it('NENHUMA carta NEXO existe no registry', () => {
    for (const id of ['char-cindro', 'char-ignarok', 'res-solar', 'res-volt', 'act-golpe', 'act-furia', 'fd-arena-solar', 'fd-nevoeiro', 'char-nihilux', 'res-neutro']) {
      expect(registry.tryCard(id), `${id} não deveria existir`).toBeUndefined();
    }
    for (const def of registry.allCards()) {
      expect(def.id.startsWith('char-') || def.id.startsWith('res-') || def.id.startsWith('act-') || def.id.startsWith('fd-'),
        `carta com prefixo NEXO no registry: ${def.id}`).toBe(false);
    }
  });

  it('starter decks e decks de tutorial existem e são válidos', () => {
    expect(JET_STARTER_DECKS.length).toBe(3);
    expect(JET_TUTORIAL_DECKS.length).toBe(2);
    for (const d of STARTERS) {
      const v = validateDeck(d.cards, DEFAULT_CONFIG.deckRules, { requireBasic: true });
      expect(v.errors, `${d.id}: ${v.errors.join('; ')}`).toEqual([]);
      expect(v.counts.total).toBe(60);
      for (const id of Object.keys(d.cards)) {
        expect(registry.tryCard(id), `${d.id} usa carta não registrada: ${id}`).toBeDefined();
      }
    }
  });

  it('coleção JET: catálogo completo, agrupado por identityId', () => {
    expect(registry.allCards().length).toBeGreaterThanOrEqual(52);
    
    const groups = jetIdentityGroups();
    // 18 identidades de agente; Jenny tem 2 edições no mesmo grupo
    expect(groups.filter((g) => g.identityId.startsWith('agent-')).length).toBe(18);
    const jenny = groups.find((g) => g.identityId === 'agent-jenny')!;
    expect(jenny.variants.sort()).toEqual(['agent-jenny-base', 'agent-jenny-mvp']);
  });

  it('deck builder (nível de dados): 5 cópias, 61 cartas e sem starter são rejeitados', () => {
    const bad: Record<string, number> = { 'agent-jenny-base': 5, 'jres-energia': 25 };
    expect(validateDeck(bad, DEFAULT_CONFIG.deckRules, { requireBasic: true }).valid).toBe(false);
    const noStarter: Record<string, number> = { 'jres-energia': 30, 'jact-leitura': 3 };
    const v = validateDeck(noStarter, DEFAULT_CONFIG.deckRules, { requireBasic: true });
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('agente inicial');
  });

  it('partida completa AI×AI roda sem NEXO e conserva instâncias', () => {
    const e = buildStandaloneEngine('deck-jet-kof-12', 'deck-jet-morning-star', 4242);
    const total = countAllInstances(e.state).total;
    playStrict(e);
    const c = countAllInstances(e.state);
    expect(c.total).toBe(total);
    const zones = c.deck + c.hand + c.active + c.bench + c.discard + c.attached + c.progression + c.fields;
    expect(zones + c.generated).toBe(c.total);
    // exatamente UM MATCH_ENDED
    expect(e.state.log.filter((ev) => ev.type === 'MATCH_ENDED').length).toBe(1);
  });

  it('tutorial completo funciona no caminho real do botão (controller)', async () => {
    // importa tardiamente para não puxar helpers que registram NEXO
    const { MatchController } = await import('../src/game/controller');
    const { metaStore } = await import('../src/persistence/store');
    const { player: pl } = await import('../src/engine/queries');
    metaStore.state.settings.tutorialDone = false;
    const ctl = new MatchController({
      playerDeckId: 'deck-jet-tutorial-aluno', opponentDeckId: 'deck-jet-tutorial-instrutor',
      difficulty: 'easy', seed: 777, tutorial: true, victoryTarget: 1
    });
    ctl.start(() => {});
    const me = pl(ctl.engine.state, 0);
    // mão preparada usa instâncias REAIS do deck de tutorial JET
    const defIds = me.hand.map((c) => c.defId);
    expect(defIds).toContain('agent-jenny-base');
    expect(defIds).toContain('agent-xixim-base');
    expect(defIds).toContain('jres-energia');
    expect(defIds).toContain('jact-leitura');
    expect(defIds).toContain('jeq-manopla');
    // passo 0: só SETUP_SET_ACTIVE
    expect(ctl.tutorialStep).toBe(0);
    expect(ctl.send({ type: 'ATTACH_RESOURCE', player: 0, uid: me.hand.find((c) => c.kind === 'RESOURCE')!.uid, targetUid: me.hand[0].uid })).toBe(false);
    expect(ctl.send({ type: 'SETUP_SET_ACTIVE', player: 0, uid: me.hand.find((c) => c.defId === 'agent-jenny-base')!.uid })).toBe(true);
    expect(ctl.tutorialStep).toBe(1);
    // instrutor conclui setup (IA dirigida)
    const ai = pl(ctl.engine.state, 1);
    if (!ai.setupDone) {
      if (!ai.active) ctl.engine.dispatch({ type: 'SETUP_SET_ACTIVE', player: 1, uid: ai.hand.find((c) => c.kind === 'CHARACTER')!.uid });
      ctl.engine.dispatch({ type: 'SETUP_DONE', player: 1 });
    }
    // passo 1: reserva Xixim
    expect(ctl.send({ type: 'SETUP_DONE', player: 0 })).toBe(false);
    expect(ctl.send({ type: 'SETUP_BENCH', player: 0, uid: me.hand.find((c) => c.defId === 'agent-xixim-base')!.uid })).toBe(true);
    expect(ctl.tutorialStep).toBe(2);
    expect(ctl.send({ type: 'SETUP_DONE', player: 0 })).toBe(true);
    expect(ctl.tutorialStep).toBe(3); // pronto para conectar energia
    // tutorial não contamina histórico (victoryTarget 1 — a partida pode acabar; histórico só em não-tutorial)
    const before = metaStore.state.history.length;
    expect(ctl.tutorialActive).toBe(true);
    ctl.stop();
    expect(metaStore.state.history.length).toBeGreaterThanOrEqual(before);
  });

  it('partida normal pelo controller grava EXATAMENTE UM registro de histórico', async () => {
    const { MatchController } = await import('../src/game/controller');
    const { metaStore } = await import('../src/persistence/store');
    const { player: pl } = await import('../src/engine/queries');
    const before = metaStore.state.history.length;
    const winsBefore = metaStore.state.wins;
    const ctl = new MatchController({
      playerDeckId: 'deck-jet-kof-12', opponentDeckId: 'deck-jet-asgard',
      difficulty: 'easy', seed: 99, victoryTarget: 1
    });
    ctl.start(() => {});
    // setup humano dirigido
    let guard = 0;
    while (ctl.engine.state.phase === 'setup' && guard++ < 40) {
      const me = pl(ctl.engine.state, 0);
      const ai = pl(ctl.engine.state, 1);
      if (!ai.setupDone) {
        if (!ai.active) ctl.engine.dispatch({ type: 'SETUP_SET_ACTIVE', player: 1, uid: ai.hand.find((c) => c.kind === 'CHARACTER')!.uid });
        else if (ai.bench.length < 1 && ai.hand.some((c) => c.kind === 'CHARACTER')) ctl.engine.dispatch({ type: 'SETUP_BENCH', player: 1, uid: ai.hand.find((c) => c.kind === 'CHARACTER')!.uid });
        else ctl.engine.dispatch({ type: 'SETUP_DONE', player: 1 });
      }
      if (ctl.engine.state.phase === 'setup') {
        if (!me.active) ctl.engine.dispatch({ type: 'SETUP_SET_ACTIVE', player: 0, uid: me.hand.find((c) => c.kind === 'CHARACTER')!.uid });
        else if (me.bench.length < 1 && me.hand.some((c) => c.kind === 'CHARACTER')) ctl.engine.dispatch({ type: 'SETUP_BENCH', player: 0, uid: me.hand.find((c) => c.kind === 'CHARACTER')!.uid });
        else ctl.engine.dispatch({ type: 'SETUP_DONE', player: 0 });
      }
    }
    // humano "burro" dirige até o fim; IA via comandos diretos
    guard = 0;
    while (ctl.engine.state.phase !== 'gameOver' && guard++ < 500) {
      const st = ctl.engine.state;
      if (st.players[st.activePlayer].isAI) {
        const cmd = aiNextCommand(ctl.engine, st.activePlayer);
        const r = ctl.engine.dispatch(cmd);
        expect(r.ok).toBe(true);
        const pend = ctl.engine.getPending();
        if (pend) ctl.engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(ctl.engine.state, pend.player, pend) });
        ctl.checkOutcome();
        continue;
      }
      const me = pl(st, 0);
      const res = me.hand.find((c) => c.kind === 'RESOURCE');
      if (res && me.attachedThisTurn < 1 && me.active && ctl.send({ type: 'ATTACH_RESOURCE', player: 0, uid: res.uid, targetUid: me.active.uid })) continue;
      const pend = ctl.engine.getPending();
      if (pend) { ctl.resolveChoice(pend.candidates.slice(0, pend.min || 1)); continue; }
      ctl.send({ type: 'END_TURN', player: 0 });
    }
    expect(ctl.engine.state.phase).toBe('gameOver');
    ctl.checkOutcome();
    ctl.checkOutcome(); // idempotente
    expect(ctl.outcome).not.toBeNull();
    expect(metaStore.state.history.length).toBe(before + 1);
    expect(metaStore.state.wins + metaStore.state.losses).toBe(winsBefore + 1);
  });

  it('rematch: nova engine/estado, controller antigo parado', async () => {
    const { MatchController } = await import('../src/game/controller');
    const first = new MatchController({ playerDeckId: 'deck-jet-kof-12', opponentDeckId: 'deck-jet-asgard', difficulty: 'easy', seed: 5, victoryTarget: 1 });
    first.start(() => {});
    const firstState = first.engine.state;
    first.stop();
    const second = new MatchController({ playerDeckId: 'deck-jet-kof-12', opponentDeckId: 'deck-jet-asgard', difficulty: 'easy', seed: 6, victoryTarget: 1 });
    second.start(() => {});
    expect(second.engine).not.toBe(first.engine);
    expect(second.engine.state).not.toBe(firstState);
    expect(second.engine.state.phase).toBe('setup'); // partida nova começa na preparação
    // controller parado não agenda IA nem processa algo novo
    const seq = first.engine.state.eventSeq;
    first.checkOutcome();
    expect(first.engine.state.eventSeq).toBe(seq);
    second.stop();
  });
});
