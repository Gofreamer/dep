import { describe, expect, it } from 'vitest';
import { setup, deckOf } from './helpers';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { registry } from '../src/engine/registry';
import { MatchController } from '../src/game/controller';
import type { Command } from '../src/engine/types';
import { player } from '../src/engine/queries';
import { registerDataPack } from '../src/data/fixtures/nexo/cards';

setup();

/**
 * Integração: fluxo completo de um jogador humano (via MatchController)
 * contra a IA — do setup à vitória — e o gating do tutorial.
 */

function runAiSetup(ctl: MatchController): void {
  const ai = player(ctl.engine.state, 1);
  if (ai.setupDone) return;
  if (!ai.active) {
    const basic = ai.hand.find((c) => c.kind === 'CHARACTER' && defStage(c) === 0)!;
    ctl.engine.dispatch({ type: 'SETUP_SET_ACTIVE', player: 1, uid: basic.uid });
  } else if (ai.bench.length < 1 && ai.hand.some((c) => c.kind === 'CHARACTER' && defStage(c) === 0)) {
    const basic = ai.hand.find((c) => c.kind === 'CHARACTER' && defStage(c) === 0)!;
    ctl.engine.dispatch({ type: 'SETUP_BENCH', player: 1, uid: basic.uid });
  } else {
    ctl.engine.dispatch({ type: 'SETUP_DONE', player: 1 });
  }
}

function humanSetup(ctl: MatchController): void {
  // escolhe ativo + reserva + pronto (como a UI faria); IA de setup é dirigida manualmente
  let guard = 0;
  while (ctl.engine.state.phase === 'setup' && guard++ < 40) {
    const me = player(ctl.engine.state, 0);
    runAiSetup(ctl);
    if (ctl.engine.state.phase !== 'setup') break;
    if (!me.active) {
      const basic = me.hand.find((c) => c.kind === 'CHARACTER' && defStage(c) === 0)!;
      expect(ctl.send({ type: 'SETUP_SET_ACTIVE', player: 0, uid: basic.uid })).toBe(true);
    } else if (me.bench.length < 1 && me.hand.some((c) => c.kind === 'CHARACTER' && defStage(c) === 0)) {
      const c = me.hand.find((x) => x.kind === 'CHARACTER' && defStage(x) === 0)!;
      expect(ctl.send({ type: 'SETUP_BENCH', player: 0, uid: c.uid })).toBe(true);
    } else {
      expect(ctl.send({ type: 'SETUP_DONE', player: 0 })).toBe(true);
    }
  }
  expect(ctl.engine.state.phase).toBe('main');
}

function defStage(inst: { defId: string }): number {
  return (registry.card(inst.defId) as any).stage ?? 0;
}

function aiDrain(ctl: MatchController, max = 40): void {
  // roda comandos da IA manualmente (sem timers reais)
  let guard = 0;
  while (ctl.engine.state.phase !== 'gameOver' && guard++ < max) {
    const st = ctl.engine.state;
    if (!st.players[st.activePlayer].isAI) return;
    const cmd = aiNextCommand(ctl.engine, st.activePlayer);
    ctl.engine.dispatch(cmd);
    const pend = ctl.engine.getPending();
    if (pend) {
      ctl.engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(ctl.engine.state, pend.player, pend) });
    }
    ctl.checkOutcome();
  }
}

describe('Fluxo completo do jogador (controller)', () => {
  it('setup → turnos → partida termina', () => {
    registerDataPack();
    const ctl = new MatchController({ playerDeckId: 'deck-furia-solar', opponentDeckId: 'deck-controle-tatico', difficulty: 'normal', seed: 4242 });
    let syncs = 0;
    ctl.start(() => { syncs++; });
    humanSetup(ctl);

    // alguns turnos do humano: jogue o que for legal, depois encerre
    let guard = 0;
    while (ctl.engine.state.phase !== 'gameOver' && guard++ < 400) {
      const st = ctl.engine.state;
      if (st.players[st.activePlayer].isAI) { aiDrain(ctl); continue; }
      // humano "burro": conecta recurso, ataca se possível, encerra
      const me = player(st, 0);
      const res = me.hand.find((c) => c.kind === 'RESOURCE');
      const acted = res && me.attachedThisTurn < 1 && me.active;
      if (acted && me.active) {
        expect(ctl.send({ type: 'ATTACH_RESOURCE', player: 0, uid: res!.uid, targetUid: me.active.uid })).toBe(true);
        continue;
      }
      // resolve pendências humanas escolhendo o primeiro candidato
      const pend = ctl.engine.getPending();
      if (pend) {
        expect(ctl.resolveChoice(pend.candidates.slice(0, pend.min || 1))).toBe(true);
        continue;
      }
      ctl.send({ type: 'END_TURN', player: 0 });
    }
    expect(ctl.engine.state.phase).toBe('gameOver');
    expect(ctl.outcome).not.toBeNull();
    expect(syncs).toBeGreaterThan(5);
  }, 30_000);

  it('tutorial bloqueia comandos fora do passo atual', () => {
    registerDataPack();
    const ctl = new MatchController({ playerDeckId: 'deck-tutorial-aluno', opponentDeckId: 'deck-tutorial-instrutor', difficulty: 'easy', seed: 777, tutorial: true, victoryTarget: 1 });
    ctl.start(() => {});
    const me = player(ctl.engine.state, 0);
    // passo 0: apenas SETUP_SET_ACTIVE
    const basic = me.hand.find((c) => c.kind === 'CHARACTER')!;
    const res = me.hand.find((c) => c.kind === 'RESOURCE')!;
    expect(ctl.send({ type: 'ATTACH_RESOURCE', player: 0, uid: res.uid, targetUid: basic.uid })).toBe(false);
    expect(ctl.send({ type: 'SETUP_SET_ACTIVE', player: 0, uid: basic.uid })).toBe(true);
    expect(ctl.tutorialStep).toBe(1);
    // instrutor também precisa de setup (dirigido manualmente)
    const ai = player(ctl.engine.state, 1);
    const aiBasic = ai.hand.find((c) => c.kind === 'CHARACTER')!;
    ctl.engine.dispatch({ type: 'SETUP_SET_ACTIVE', player: 1, uid: aiBasic.uid });
    ctl.engine.dispatch({ type: 'SETUP_DONE', player: 1 });
    // passo 1: SETUP_BENCH
    const benchCand = me.hand.find((c) => c.kind === 'CHARACTER');
    if (benchCand) {
      expect(ctl.send({ type: 'SETUP_DONE', player: 0 })).toBe(false);
      expect(ctl.send({ type: 'SETUP_BENCH', player: 0, uid: benchCand.uid })).toBe(true);
      expect(ctl.tutorialStep).toBe(2);
    }
    expect(ctl.send({ type: 'SETUP_DONE', player: 0 })).toBe(true);
  });

  it('mão do tutorial vem preparada (rigged)', () => {
    registerDataPack();
    const ctl = new MatchController({ playerDeckId: 'deck-tutorial-aluno', opponentDeckId: 'deck-tutorial-instrutor', difficulty: 'easy', seed: 777, tutorial: true, victoryTarget: 1 });
    const me = player(ctl.engine.state, 0);
    const defIds = me.hand.map((c) => c.defId);
    expect(defIds).toContain('char-cindro');
    expect(defIds).toContain('char-ignarok');
    expect(defIds).toContain('res-solar');
    expect(defIds).toContain('act-golpe');
  });

  it('baralhos starter não alterados por partidas', () => {
    registerDataPack();
    const before = JSON.stringify(deckOf('deck-ascensao'));
    const ctl = new MatchController({ playerDeckId: 'deck-ascensao', opponentDeckId: 'deck-furia-solar', difficulty: 'easy', seed: 99 });
    humanSetup(ctl);
    expect(JSON.stringify(deckOf('deck-ascensao'))).toBe(before);
  });
});
