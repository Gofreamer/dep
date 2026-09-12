/**
 * Diagnóstico de soft-lock — detector de estados impossíveis + regressões.
 *
 * SOFT-LOCK: gameOver == false mas não existe maneira válida de continuar.
 * Estes testes exercitam o detector (diagnostics.ts), a promoção automática
 * com reserva única e a resolubilidade de TODA escolha pendente pelo engine.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { MatchEngine } from '../src/engine/engine';
import { diagnoseSoftLock } from '../src/engine/diagnostics';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import type { Command } from '../src/engine/types';
import { applyDamage, toDiscard } from '../src/engine/effects/shared';
import { findCard, maxHp } from '../src/engine/queries';
import { autoSetup, deckOf, makeEngine, playUntilEnd, rigHand } from './helpers';

beforeAll(() => registerJetDataPack());

describe('diagnoseSoftLock — detector', () => {
  it('não suspeita de um estado saudável (setup e main)', () => {
    const e = makeEngine({ p0: deckOf('deck-jet-kof-12'), p1: deckOf('deck-jet-asgard') });
    let r = e.diagnose();
    expect(r.suspicious).toBe(false);
    autoSetup(e);
    r = e.diagnose();
    expect(r.suspicious).toBe(false);
    expect(r.phase).toBe('main');
    expect(r.legalSummary).not.toBeNull();
  });

  it('aponta choice pendente com zero candidatos e min obrigatório', () => {
    const e = makeEngine({ p0: deckOf('deck-jet-kof-12'), p1: deckOf('deck-jet-asgard') });
    autoSetup(e);
    const state = e.state;
    const r = diagnoseSoftLock(state, {
      pending: { kind: 'cards', player: 0, prompt: 'escolha', candidates: [], min: 1, max: 1, optional: false, labels: {} }
    });
    expect(r.suspicious).toBe(true);
    expect(r.reasons.join(' ')).toContain('choice_sem_candidatos_min_obrigatorio');
  });

  it('aponta choice pendente com candidatos que não existem mais no estado', () => {
    const e = makeEngine({ p0: deckOf('deck-jet-kof-12'), p1: deckOf('deck-jet-asgard') });
    autoSetup(e);
    const r = diagnoseSoftLock(e.state, {
      pending: { kind: 'target', player: 0, prompt: 'alvo', candidates: ['c999999'], min: 1, max: 1, optional: false, labels: {} }
    });
    expect(r.suspicious).toBe(true);
    expect(r.reasons.join(' ')).toContain('choice_candidatos_inexistentes');
  });

  it('não suspeita de estado gameOver', () => {
    const e = makeEngine({ p0: deckOf('deck-jet-kof-12'), p1: deckOf('deck-jet-asgard') });
    autoSetup(e);
    e.state.winner = 1;
    e.state.phase = 'gameOver';
    e.state.endReason = 'teste';
    expect(e.diagnose().suspicious).toBe(false);
  });
});

describe('KO do ativo — promoção automática e escolha', () => {
  /** Derruba o ativo de p0 e dispara a resolução de derrotas via fluxo de turno. */
  function koActive(e: MatchEngine): void {
    // garante que é o turno do jogador 0 antes de aplicar o dano
    while (e.state.activePlayer !== 0 && e.state.phase === 'main') {
      e.dispatch({ type: 'END_TURN', player: 1 });
    }
    const p0 = e.state.players[0];
    const active = p0.active!;
    applyDamage(e.g(), active, maxHp(e.state, active) + 1, { label: 'teste' });
    e.dispatch({ type: 'END_TURN', player: 0 }); // endTurnGen → resolveDefeats
  }

  it('com EXATAMENTE uma reserva: promove automaticamente, sem pending', () => {
    const e = makeEngine({ p0: deckOf('deck-jet-kof-12'), p1: deckOf('deck-jet-asgard') });
    autoSetup(e);
    const p0 = e.state.players[0];
    // garante exatamente 1 reserva (excedentes vão para o descarte)
    while (p0.bench.length > 1) toDiscard(e.g(), p0.bench.pop()!, 0);
    expect(p0.bench.length).toBe(1);
    const active = p0.active!;
    const benchUid = p0.bench[0].uid;
    koActive(e);
    expect(p0.active).not.toBeNull();
    expect(p0.active!.uid).toBe(benchUid);
    expect(p0.bench.length).toBe(0);
    expect(active.uid).not.toBe(p0.active!.uid);
    expect(e.state.phase).not.toBe('gameOver');
    expect(e.diagnose().suspicious).toBe(false);
  });

  it('com MAIS de uma reserva: pede escolha resolvível (não soft-locka)', () => {
    const e = makeEngine({ p0: deckOf('deck-jet-kof-12'), p1: deckOf('deck-jet-asgard') });
    autoSetup(e);
    const p0 = e.state.players[0];
    while (e.state.activePlayer !== 0 && e.state.phase === 'main') {
      e.dispatch({ type: 'END_TURN', player: 1 });
    }
    // garante material: mão com bases para encher a reserva até 2+
    rigHand(e, 0, ['agent-ran-yuki-base', 'agent-jenny-base', 'agent-shirakami-niku-base']);
    while (p0.bench.length < 2) {
      const c = p0.hand.find((x) => x.kind === 'CHARACTER');
      if (!c) break;
      const r = e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: c.uid });
      expect(r.ok, `deploy ${c.defId}: ${r.error}`).toBe(true);
    }
    expect(p0.bench.length).toBeGreaterThanOrEqual(2);
    const active = p0.active!;
    const benchUids = p0.bench.map((c) => c.uid);
    koActive(e);
    const pending = e.getPending();
    expect(pending).not.toBeNull();
    expect(pending!.player).toBe(0);
    expect([...pending!.candidates].sort()).toEqual([...benchUids].sort());
    // resolve a escolha → jogo continua
    const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: 0, selected: [pending!.candidates[0]] });
    expect(r.ok).toBe(true);
    expect(p0.active!.uid).toBe(pending!.candidates[0]);
    expect(e.state.phase).not.toBe('gameOver');
    expect(e.diagnose().suspicious).toBe(false);
  });

  it('sem reserva alguma: derrota por no_active (nunca trava)', () => {
    const e = makeEngine({ p0: deckOf('deck-jet-kof-12'), p1: deckOf('deck-jet-asgard') });
    autoSetup(e);
    const p0 = e.state.players[0];
    while (p0.bench.length > 0) toDiscard(e.g(), p0.bench.pop()!, 0);
    koActive(e);
    expect(e.state.phase).toBe('gameOver');
    expect(e.state.winner).toBe(1);
    expect(e.state.endReason).toBe('no_active');
  });
});

describe('Toda escolha pendente é resolvível pelo engine', () => {
  it('retrieveFromDiscard (jact-retomada) gera pending com candidatos do descarte', () => {
    const e = makeEngine({ p0: deckOf('deck-jet-morning-star'), p1: deckOf('deck-jet-asgard') });
    autoSetup(e);
    // Descarta duas cartas reais para o descarte do jogador 0 (com 2+, a
    // escolha exige decisão → pending; com 1 a engine escolhe sozinha).
    const p0 = e.state.players[0];
    toDiscard(e.g(), p0.hand[0], 0);
    toDiscard(e.g(), p0.hand[0], 0);
    expect(p0.discard.length).toBeGreaterThanOrEqual(2);
    while (e.state.activePlayer !== 0 && e.state.phase === 'main') {
      e.dispatch({ type: 'END_TURN', player: 1 });
    }
    // Põe a Retomada na mão e joga.
    rigHand(e, 0, ['jact-retomada', 'jres-energia']);
    const r = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: p0.hand.find((c) => c.defId === 'jact-retomada')!.uid });
    expect(r.ok).toBe(true);
    const pending = e.getPending();
    expect(pending).not.toBeNull();
    expect(pending!.kind).toBe('cards');
    expect(pending!.candidates.length).toBeGreaterThan(0);
    // todos os candidatos existem no estado (garantia do diagnóstico)
    for (const uid of pending!.candidates) expect(findCard(e.state, uid)).not.toBeNull();
    // resolve e o jogo continua
    const r2 = e.dispatch({ type: 'RESOLVE_CHOICE', player: 0, selected: [pending!.candidates[0]] });
    expect(r2.ok).toBe(true);
    expect(e.diagnose().suspicious).toBe(false);
  });
});

describe('Partidas IA×IA completas nunca passam por estado suspeito', () => {
  it('cada comando de 3 partidas é diagnosticado limpo', () => {
    for (const seed of [101, 202, 303]) {
      const e = makeEngine({ seed, p0: deckOf('deck-jet-kof-12'), p1: deckOf('deck-jet-asgard') });
      // setup dirigido por jogador (mesmo padrão da bateria de partidas)
      for (const p of [0, 1] as const) {
        let sguard = 0;
        while (!e.state.players[p].setupDone && sguard++ < 30) {
          const cmd = aiNextCommand(e, p);
          expect(e.dispatch(cmd).ok, `setup ilegal: ${cmd.type}`).toBe(true);
        }
      }
      let guard = 0;
      while (e.state.phase !== 'gameOver' && guard++ < 600) {
        const p = e.state.activePlayer;
        const cmd: Command = aiNextCommand(e, p);
        const r = e.dispatch(cmd);
        expect(r.ok, `seed ${seed} cmd ${cmd.type}: ${r.error}`).toBe(true);
        const pending = e.getPending();
        if (pending) {
          e.dispatch({ type: 'RESOLVE_CHOICE', player: pending.player, selected: aiSmartChoice(e.state, pending.player, pending) });
        }
        const d = e.diagnose();
        expect(d.suspicious, `seed ${seed} turno ${e.state.turn}: ${d.reasons.join('|')} (cmd=${cmd.type})`).toBe(false);
      }
      expect(e.state.phase).toBe('gameOver');
    }
  });
});
