import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { expandDeck } from '../src/data/deckUtils';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';
import { aiNextCommand } from '../src/engine/ai/ai';
import { checkRestrictions } from '../src/engine/rules';
import { player } from '../src/engine/queries';
import { computeLegalActions } from '../src/engine/validation';

/**
 * AÇÕES SEM CUSTO → LIMITADAS POR DEF (regra de espécie da 2.1).
 *
 * `toTechnique` documenta a Ação como "grátis, limitada pelas restrictions",
 * mas no 2.0 a regra só valia para quem DECLARASSE `oncePerTurn`. Os `jsyn-*`
 * (sinergias, justamente o payoff de cada arquétipo) passavam sem limite algum,
 * então duas cópias da mesma técnica no mesmo turno = 2× dano/2× marca de graça.
 * Agora toda AÇÃO é limitada a 1 cópia por def por turno, via config
 * (`turn.actionOncePerTurn`), aplicada em `checkRestrictions` — a mesma função
 * usada pelo `dispatch` e por `computeLegalActions` (a IA nunca vê opção que a
 * regra proíbe).
 */

beforeAll(() => { registerJetDataPack(); });

function twoCopiesEngine(config?: any): MatchEngine {
  const deck = (id: string) => expandDeck(JET_STARTER_DECKS.find((d) => d.id === id)!).map((x) => registry.card(x));
  const e = new MatchEngine({ seed: 77, config, players: [
    { name: 'A', deckId: 'deck-jet-kof-12', isAI: false, aiLevel: 'normal', deck: deck('deck-jet-kof-12') },
    { name: 'B', deckId: 'deck-jet-asgard', isAI: false, aiLevel: 'normal', deck: deck('deck-jet-asgard') }
  ] });
  for (const p of [0, 1] as const) {
    let g = 0;
    while (e.state.phase === 'setup' && !e.state.players[p].setupDone && g++ < 40) {
      e.dispatch(aiNextCommand(e, p));
    }
  }
  return e;
}

/** Coloca N cópias de uma ação na mão do jogador (e garante que ela é jogável). */
function rigAction(e: MatchEngine, pIdx: 0 | 1, defId: string, copies: number): string[] {
  const p = player(e.state, pIdx);
  const pool = [...p.deck, ...p.discard].filter((c) => c.defId === defId);
  const picked = pool.slice(0, copies);
  const def = registry.card(defId) as any;
  for (let i = picked.length; i < copies; i++) {
    picked.push({
      uid: `rig-${defId}-${i}`, defId, owner: pIdx, kind: def.kind, damage: 0, stageLevel: 0,
      statuses: [], counters: {}, attached: [], progression: [], usedTurn: [], usedMatch: [], deployedOnTurn: 0
    } as any);
  }
  for (const c of picked) {
    const from = p.deck.indexOf(c);
    if (from >= 0) p.deck.splice(from, 1);
    p.hand.push(c);
  }
  return picked.map((c) => c.uid);
}

describe('regra de 1 ação por def/turno', () => {
  it('bloqueia a segunda cópia da mesma técnica no mesmo turno', () => {
    const e = twoCopiesEngine({ ...DEFAULT_CONFIG });
    const uids = rigAction(e, 0, 'jsyn-kof-furia', 2);
    expect(e.state.phase).toBe('main');
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: uids[0] }).ok).toBe(true);
    const second = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: uids[1] });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('restriction_once_per_turn');
  });

  it('libera de novo no turno seguinte', () => {
    const e = twoCopiesEngine({ ...DEFAULT_CONFIG });
    const uids = rigAction(e, 0, 'jsyn-kof-furia', 2);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: uids[0] }).ok).toBe(true);
    e.dispatch({ type: 'END_TURN', player: 0 });
    e.dispatch({ type: 'END_TURN', player: 1 });
    expect(e.state.turn).toBeGreaterThanOrEqual(3);
    // a carta pode ter ido para o topo do baralho/consumida: devolve para a mão
    const p = player(e.state, 0);
    const inHand = p.hand.find((c) => c.defId === 'jsyn-kof-furia') ?? p.deck.find((c) => c.defId === 'jsyn-kof-furia');
    expect(inHand).toBeTruthy();
    if (!p.hand.includes(inHand!)) p.hand.push(inHand!);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: inHand!.uid }).ok).toBe(true);
  });

  it('computeLegalActions nunca oferece a cópia bloqueada (IA não trapaceia)', () => {
    const e = twoCopiesEngine({ ...DEFAULT_CONFIG });
    const uids = rigAction(e, 0, 'jsyn-kof-furia', 3);
    // antes de jogar: as 3 cópias são individualmente legais
    const before = computeLegalActions(e.state, 0, 0).playableActions;
    expect(before.filter((u) => uids.includes(u)).length).toBe(3);
    const mine = before.filter((u) => uids.includes(u));
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: mine[0] }).ok).toBe(true);
    const after = computeLegalActions(e.state, 0, 0).playableActions;
    expect(after.filter((u) => uids.includes(u)).length).toBe(0);
    // as outras ações continuam na lista (a regra não é "1 ação por turno")
    expect(after.length).toBeGreaterThanOrEqual(1);
  });

  it('config desliga a regra (fixtures de teste)', () => {
    const e = twoCopiesEngine({ ...DEFAULT_CONFIG, turn: { ...DEFAULT_CONFIG.turn, actionOncePerTurn: false } });
    const uids = rigAction(e, 0, 'jsyn-kof-furia', 2);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: uids[0] }).ok).toBe(true);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: uids[1] }).ok).toBe(true);
  });

  it('ações SEM restriction (dano grátis) também ficam limitadas', () => {
    const e = twoCopiesEngine({ ...DEFAULT_CONFIG });
    const uids = rigAction(e, 0, 'jact-primeiro-sangue', 2);
    const def = registry.card('jact-primeiro-sangue') as any;
    // o caso geral: sem `restrictions`, a regra de espécie ainda se aplica
    expect(checkRestrictions(e.state, 0, def).ok || checkRestrictions(e.state, 0, { ...def, restrictions: undefined }).ok).toBe(true);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: uids[0] }).ok).toBe(true);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: uids[1] }).ok).toBe(false);
  });

  it('ações DIFERENTES continuam jogáveis no mesmo turno', () => {
    const e = twoCopiesEngine({ ...DEFAULT_CONFIG });
    const a = rigAction(e, 0, 'jact-primeiro-sangue', 1);
    const b = rigAction(e, 0, 'jact-varredura', 1);
    const c = rigAction(e, 0, 'jsyn-kof-furia', 1);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: a[0] }).ok).toBe(true);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: b[0] }).ok).toBe(true);
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: c[0] }).ok).toBe(true);
  });
});
