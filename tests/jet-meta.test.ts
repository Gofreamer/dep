import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { MatchController } from '../src/game/controller';
import { metaStore } from '../src/persistence/store';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { player } from '../src/engine/queries';
import { validateDeck } from '../src/data/deckUtils';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';
import { registry } from '../src/engine/registry';
import { factionColor } from '../src/ui/components/Artwork';

/**
 * Itens 44–49: revanche sem vazamento, histórico com exatamente UMA entrada
 * por partida, tutorial não polui W/L, validação central de baralho
 * (limite por identidade compartilhado entre variantes) e arte procedural.
 * localStorage não existe no ambiente de testes → MetaStore fica em memória.
 */

beforeAll(() => { registerJetDataPack(); });

/** Leva uma partida de controller ao fim dirigindo as IAs manualmente (sem timers). */
function driveToFinish(ctl: MatchController, max = 1200): void {
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (!ctl.engine.state.players[p].setupDone && guard++ < 30) {
      ctl.engine.dispatch(aiNextCommand(ctl.engine, p));
      const pend = ctl.engine.getPending();
      if (pend) ctl.engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(ctl.engine.state, pend.player, pend) });
    }
  }
  let guard = 0;
  while (ctl.engine.state.phase !== 'gameOver' && guard++ < max) {
    const st = ctl.engine.state;
    const pend = ctl.engine.getPending();
    if (pend) { ctl.engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(ctl.engine.state, pend.player, pend) }); continue; }
    ctl.engine.dispatch(aiNextCommand(ctl.engine, st.activePlayer));
    ctl.checkOutcome();
  }
  expect(ctl.engine.state.phase).toBe('gameOver');
}

describe('História e revanche (itens 44–45)', () => {
  it('partida normal grava EXATAMENTE uma entrada no histórico', () => {
    const before = metaStore.state.history.length;
    const ctl = new MatchController({ playerDeckId: 'deck-jet-kof-12', opponentDeckId: 'deck-jet-asgard', difficulty: 'normal', seed: 31337 });
    ctl.start(() => {});
    driveToFinish(ctl);
    expect(metaStore.state.history.length).toBe(before + 1);
    const rec = metaStore.state.history[0];
    expect(rec.playerDeckId).toBe('deck-jet-kof-12');
    expect(rec.opponentDeckId).toBe('deck-jet-asgard');
    expect(['win', 'loss']).toContain(rec.result);
  });

  it('chamar checkOutcome repetidamente NÃO duplica entradas', () => {
    const before = metaStore.state.history.length;
    const ctl = new MatchController({ playerDeckId: 'deck-jet-asgard', opponentDeckId: 'deck-jet-morning-star', difficulty: 'normal', seed: 31338 });
    ctl.start(() => {});
    driveToFinish(ctl);
    ctl.checkOutcome();
    ctl.checkOutcome();
    ctl.checkOutcome();
    expect(metaStore.state.history.length).toBe(before + 1);
  });

  it('tutorial NÃO grava vitória/derrota no histórico nem altera placar', () => {
    const before = metaStore.state.history.length;
    const wins = metaStore.state.wins;
    const losses = metaStore.state.losses;
    const ctl = new MatchController({
      playerDeckId: 'deck-jet-tutorial-aluno', opponentDeckId: 'deck-jet-tutorial-instrutor',
      difficulty: 'easy', seed: 9, tutorial: true, victoryTarget: 1
    });
    ctl.start(() => {});
    driveToFinish(ctl);
    expect(metaStore.state.history.length).toBe(before);
    expect(metaStore.state.wins).toBe(wins);
    expect(metaStore.state.losses).toBe(losses);
  });

  it('revanche = engine NOVA com seed nova; controller antigo parado', () => {
    const ctl1 = new MatchController({ playerDeckId: 'deck-jet-kof-12', opponentDeckId: 'deck-jet-kof-12', difficulty: 'normal', seed: 1001 });
    ctl1.start(() => {});
    ctl1.stop();
    const ctl2 = new MatchController({ playerDeckId: 'deck-jet-kof-12', opponentDeckId: 'deck-jet-kof-12', difficulty: 'normal', seed: 1002 });
    ctl2.start(() => {});
    expect(ctl2.engine).not.toBe(ctl1.engine);
    expect(ctl2.engine.state.seed).toBe(1002);
    // controller parado rejeita comandos (sem ticks órfãos)
    expect(ctl1.send({ type: 'END_TURN', player: 0 })).toBe(false);
    ctl2.stop();
  });
});

describe('Validação central de baralho (itens 46–47)', () => {
  const rules = DEFAULT_CONFIG.deckRules;

  it('limite por identidade é COMPARTILHADO entre variantes de edição', () => {
    // 2 Ran BASE + 3 Ran MVP = 5 cópias da MESMA identidade
    const mixed = { 'agent-jenny-base': 2, 'agent-jenny-mvp': 3, 'jres-energia': 55 };
    const cfg = { ...rules, maxCopiesPerIdentity: 4 };
    const v = validateDeck(mixed, cfg, { requireBasic: true });
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('por identidade');
    // 4 no total (2+2) passa
    const ok = validateDeck({ 'agent-jenny-base': 2, 'agent-jenny-mvp': 2, 'jres-energia': 56 }, cfg, { requireBasic: true });
    expect(ok.valid).toBe(true);
  });

  it('61 cartas é rejeitado; 60 é aceito', () => {
    const over = { ...JET_STARTER_DECKS[0].cards };
    over['jres-energia'] += 1;
    expect(validateDeck(over, rules, { requireBasic: true }).valid).toBe(false);
    expect(validateDeck({ ...JET_STARTER_DECKS[0].cards }, rules, { requireBasic: true }).valid).toBe(true);
  });

  it('erro é explicado em linguagem clara (a UI mostra validateDeck.errors)', () => {
    const v = validateDeck({ 'jres-energia': 60 }, rules, { requireBasic: true });
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('agente inicial');
    const unknown = validateDeck({ 'carta-fora-do-jogo': 1 }, rules, { requireBasic: false });
    expect(unknown.errors.join(' ')).toContain('desconhecida');
  });
});

describe('Arte procedural (item 49)', () => {
  it('factionColor é determinística e tem fallback para facção desconhecida', () => {
    const fac = registry.allCards().find((c) => c.faction)?.faction;
    if (fac) expect(factionColor(fac)).toBe(factionColor(fac));
    expect(factionColor('facção-inexistente')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
