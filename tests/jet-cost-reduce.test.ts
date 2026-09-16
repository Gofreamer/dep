import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { computeLegalActions } from '../src/engine/validation';
import { effectiveAttackCostReduce, effectiveAttackCost } from '../src/engine/rules';
import type { CardInstance, MatchState } from '../src/engine/types';

/**
 * JET 2.1 — regras de redução de custo de Energia.
 *
 * O texto de `Catalisador de Combate` / `Impulso KOF` / `Gerador de Interferência`
 * sempre prometeu "1 Energia a menos (mínimo 1)". No 2.0 o piso não era
 * implementado e os redutores empilhavam: dois deles zeravam qualquer custo e um
 * agente sem Energia conectada atacava por 40 de dano — causa estrutural da
 * dominância aggro. Estes testes travam o comportamento corrigido e a
 * consistência `legalActions` ↔ `dispatch`.
 *
 * Nota: `jres-catalisador` é uma ENERGIA que também reduz custo (então conta no
 * pool). Os testes de "zero Energia" usam redutores que NÃO são energia
 * (`jeq-impulso-kof`, `jeq-gerador`).
 */

beforeAll(() => { registerJetDataPack(); });

function fakeAttach(defId: string, kind: CardInstance['kind'], owner: 0 | 1 = 0): CardInstance {
  return {
    uid: `sim-${defId}-${Math.random().toString(36).slice(2)}`,
    defId, owner, kind, damage: 0, stageLevel: 0, statuses: [], counters: {},
    attached: [], progression: [], usedTurn: [], usedMatch: [], deployedOnTurn: 0
  };
}

const energy = (n: number, host: CardInstance): void => {
  for (let i = 0; i < n; i++) host.attached.push(fakeAttach('jres-energia', 'RESOURCE'));
};

/** Engine mínima em fase main, com a vez do jogador 0 e o agente pedido no ativo. */
function arena(activeDefId: string, attachedEquipment: string[] = []): MatchEngine {
  const cards = (id: string): any[] => { const base = registry.card(id); return [base, ...Array.from({ length: 55 }, () => base)]; };
  const e = new MatchEngine({
    seed: 7,
    players: [
      { name: 'a', deckId: 'a', isAI: false, aiLevel: 'hard', deck: cards(activeDefId) },
      { name: 'b', deckId: 'b', isAI: false, aiLevel: 'hard', deck: cards(activeDefId) }
    ]
  });
  for (const p of [0, 1] as const) {
    const legal = computeLegalActions(e.state, p, 0);
    e.dispatch({ type: 'SETUP_SET_ACTIVE', player: p, uid: legal.setupActive[0] });
    e.dispatch({ type: 'SETUP_DONE', player: p });
  }
  while (e.state.activePlayer !== 0 && e.state.phase === 'main') {
    e.dispatch({ type: 'END_TURN', player: e.state.activePlayer });
  }
  const act = e.state.players[0].active!;
  for (const id of attachedEquipment) act.attached.push(fakeAttach(id, 'EQUIPMENT'));
  return e;
}

const playable = (e: MatchEngine, attackId: string): boolean =>
  (computeLegalActions(e.state, 0, e.state.turn).attacks.find((a) => a.attackId === attackId)?.playable) === true;

const atkOf = (cardId: string, index: number): any => (registry.card(cardId) as any).attacks[index];
const grantedOf = (equipId: string): any => (registry.card(equipId) as any).grantsAttacks[0];

describe('redução de custo de ataque (piso, anti-estouro, imunidade de finisher)', () => {
  it('piso: com redutor e 0 Energia conectadas o ataque de 2E NÃO é jogável', () => {
    const e = arena('agent-ran-yuki-base', ['jeq-impulso-kof']);
    expect(e.state.config.turn.attackCostFloor).toBe(1);
    expect(e.state.config.turn.maxAttackCostReduce).toBe(1);
    const act = e.state.players[0].active!;
    const atk = atkOf('agent-ran-yuki-base', 1); // 2E, 40 de dano
    const st: MatchState = e.state;
    expect(effectiveAttackCostReduce(st, act, atk.cost, atk)).toBe(1);
    expect(effectiveAttackCost(st, act, atk.cost, atk)).toBe(1);
    expect(playable(e, atk.id)).toBe(false);
    energy(1, act);
    expect(playable(e, atk.id)).toBe(true);
  });

  it('anti-estouro: dois redutores ainda rendem só 1 ponto de desconto', () => {
    const e = arena('agent-xixim-base', ['jeq-impulso-kof', 'jeq-gerador']);
    const act = e.state.players[0].active!;
    const st: MatchState = e.state;
    const oneE = atkOf('agent-xixim-base', 0); // 1E, 20
    const twoE = atkOf('agent-xixim-base', 1); // 2E, 30
    expect(effectiveAttackCostReduce(st, act, oneE.cost, oneE)).toBe(0); // piso segura
    expect(effectiveAttackCost(st, act, oneE.cost, oneE)).toBe(1);
    expect(effectiveAttackCostReduce(st, act, twoE.cost, twoE)).toBe(1); // e não empilha
    expect(effectiveAttackCost(st, act, twoE.cost, twoE)).toBe(1);
    expect(playable(e, oneE.id)).toBe(false); // custo 1 com pool 0
    energy(1, act);
    expect(playable(e, oneE.id)).toBe(true);
    expect(playable(e, twoE.id)).toBe(true); // 2E − 1 (cap) = 1 pago com a Energia conectada
  });

  it('finisher de 5E ignora redução por completo', () => {
    const e = arena('agent-ran-yuki-base', ['jeq-impulso-kof', 'jeq-gerador']);
    const act = e.state.players[0].active!;
    const fin = grantedOf('jeq-ultimato-kof'); // 5E, 180
    expect(fin.costReduceImmune).toBe(true);
    expect(effectiveAttackCostReduce(e.state, act, fin.cost, fin)).toBe(0);
    act.attached.push(fakeAttach('jeq-ultimato-kof', 'EQUIPMENT'));
    energy(4, act);
    expect(playable(e, fin.id)).toBe(false); // 4 < 5 — desconto nenhum
    energy(1, act);
    expect(playable(e, fin.id)).toBe(true);
  });

  it('todos os finishers de 4–5E do Core Set são imunes a desconto (e só eles)', () => {
    const finishers = registry.allCards()
      .filter((c) => c.kind === 'EQUIPMENT')
      .flatMap((c) => (((c as any).grantsAttacks ?? []) as any[]).map((a) => ({ card: c.id, atk: a })));
    expect(finishers.length).toBeGreaterThanOrEqual(8);
    for (const { card, atk } of finishers) {
      const cost = atk.cost.reduce((s: number, x: any) => s + x.amount, 0);
      if (cost >= 4) expect(atk.costReduceImmune, `${card}/${atk.id}`).toBe(true);
      else expect(atk.costReduceImmune ?? false, `${card}/${atk.id}`).toBe(false);
    }
  });

  it('legalActions e dispatch concordam (o que a UI nega, o engine rejeita)', () => {
    const e = arena('agent-ran-yuki-base', ['jeq-impulso-kof']);
    const atk = atkOf('agent-ran-yuki-base', 1);
    expect(playable(e, atk.id)).toBe(false);
    const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('resource');
  });
});
