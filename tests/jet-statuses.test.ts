import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { DEFAULT_CONFIG, type CharacterDef, type ActionDef } from '../src/engine/types';
import { applyDamage, applyStatusToChar, removeStatusFromChar } from '../src/engine/effects/shared';
import type { G } from '../src/engine/effects/shared';
import { charDef, player } from '../src/engine/queries';
import { expandDeck } from '../src/data/deckUtils';

/**
 * AUDITORIA DE STATUS CRÍTICOS — números exatos, tempos exatos.
 * marked / exhausted / stun / silence / root / tenacity conforme os textos.
 */

const DECK_RAN = { 'agent-ran-yuki-base': 4, 'jres-energia': 30, 'jact-leitura': 6 };
const DECK_JENNY = { 'agent-jenny-base': 4, 'jres-energia': 30, 'jact-leitura': 6 };

function engine(seed = 42, p0Cards: Record<string, number> = DECK_RAN): MatchEngine {
  return new MatchEngine({
    seed,
    config: DEFAULT_CONFIG,
    players: [
      { name: 'A', deckId: 'ta', isAI: false, aiLevel: 'normal', deck: expandDeck({ id: 'ta', name: 'ta', description: '', cards: p0Cards }).map((id) => registry.card(id)) },
      { name: 'B', deckId: 'tb', isAI: false, aiLevel: 'normal', deck: expandDeck({ id: 'tb', name: 'tb', description: '', cards: { 'agent-xixim-base': 4, 'jres-energia': 30, 'jact-leitura': 6 } }).map((id) => registry.card(id)) }
    ]
  });
}

function startMain(e: MatchEngine): void {
  // pula o setup de forma determinística; turno avançado p/ liberar ataques
  // (regra: quem começa não ataca no turno 1 — startingPlayerSkipsAttack).
  for (const p of [0, 1] as const) {
    while (!e.state.players[p].setupDone) {
      const me = player(e.state, p);
      if (!me.active) e.dispatch({ type: 'SETUP_SET_ACTIVE', player: p, uid: me.hand.find((c) => c.kind === 'CHARACTER')!.uid });
      else e.dispatch({ type: 'SETUP_DONE', player: p });
    }
  }
  e.state.turn = 3;
}

function give(e: MatchEngine, pIdx: 0 | 1, n: number): void {
  for (let i = 0; i < n; i++) e.debugCommand('giveResource', { targetUid: player(e.state, pIdx).active!.uid, defId: 'jres-energia' });
}

const g0 = (e: MatchEngine): G => ({ state: e.state, emit: (() => {}) as G['emit'] });

beforeAll(() => { registerJetDataPack(); });

describe('marked (+10 dano recebido de qualquer fonte)', () => {
  it('ataque de 20 causa 30 no alvo Marcado', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    give(e, 0, 1);
    const atk = charDef(player(e.state, 0).active!).attacks.find((a) => a.role === 'skill')!;
    const before = player(e.state, 1).active!.damage;
    applyStatusToChar(g0(e), player(e.state, 1).active!, 'marked', 2);
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
    expect(player(e.state, 1).active!.damage).toBe(before + 30); // 20 + 10
  });

  it('stacking é refresh (não multiplica) e dano de efeito também sofre o bônus', () => {
    const e = engine();
    startMain(e);
    const def = player(e.state, 1).active!;
    applyStatusToChar(g0(e), def, 'marked', 2);
    applyStatusToChar(g0(e), def, 'marked', 2); // refresh: continua 1 instância
    expect(def.statuses.filter((s) => s.id === 'marked').length).toBe(1);
    // dano de efeito (não-ataque) também sofre +10
    const dmgBefore = def.damage;
    applyDamage(g0(e), def, 15, { label: 'teste' });
    expect(def.damage).toBe(dmgBefore + 25); // 15 + 10
  });

  it('Purificação remove e a reaplicação volta a valer exatamente +10', () => {
    const e = engine();
    startMain(e);
    const def = player(e.state, 1).active!;
    applyStatusToChar(g0(e), def, 'marked', 2);
    removeStatusFromChar(g0(e), def, 'marked');
    expect(def.statuses.some((s) => s.id === 'marked')).toBe(false);
    const before = def.damage;
    applyDamage(g0(e), def, 10, {});
    expect(def.damage).toBe(before + 10); // sem marca: sem bônus
    applyStatusToChar(g0(e), def, 'marked', 2);
    applyDamage(g0(e), def, 10, {});
    expect(def.damage).toBe(before + 30); // 10 (sem marca) + (10 + 10 bônus)
  });

  it('marca expira no fim do turno do dono (aplicada com 2 tokens: dura 2 turnos do dono)', () => {
    const e = engine(7);
    startMain(e);
    const def = player(e.state, 1).active!;
    applyStatusToChar(g0(e), def, 'marked', 2);
    // fim do turno do dono (1): tick → 1 token
    e.state.activePlayer = 1;
    e.dispatch({ type: 'END_TURN', player: 1 });
    expect(def.statuses.some((s) => s.id === 'marked')).toBe(true);
    // fim do 2º turno do dono: remove
    e.state.activePlayer = 1;
    e.dispatch({ type: 'END_TURN', player: 1 });
    expect(def.statuses.some((s) => s.id === 'marked')).toBe(false);
  });
});

describe('tenacity (−20 dano recebido) — números exatos', () => {
  it('ataque 40 → 20 com Tenacidade; 40 → 30 com Tenacidade + Marca juntas', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    give(e, 0, 2);
    const atk = charDef(player(e.state, 0).active!).attacks.find((a) => a.role === 'signature')!; // 40
    const def = player(e.state, 1).active!;
    applyStatusToChar(g0(e), def, 'tenacity', 1);
    let before = def.damage;
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
    expect(def.damage).toBe(before + 20); // 40 − 20
    applyStatusToChar(g0(e), def, 'marked', 1);
    before = def.damage;
    e.state.activePlayer = 0; // attackEndsTurn devolveu o turno
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
    expect(def.damage).toBe(before + 30); // 40 + 10 − 20
  });

  it('dano de veneno/tick também é reduzido (nunca abaixo de 0)', () => {
    const e = engine();
    startMain(e);
    const def = player(e.state, 1).active!;
    applyStatusToChar(g0(e), def, 'tenacity', 5);
    applyStatusToChar(g0(e), def, 'poison', 5); // 10 por tick
    e.state.activePlayer = 1;
    const before = def.damage;
    e.dispatch({ type: 'END_TURN', player: 1 }); // tick do veneno no fim do turno
    expect(def.damage).toBe(before); // 10 − 20 → 0 (floor)
  });
});

describe('exhausted (não ataca no próximo turno)', () => {
  it('bloqueia o ataque durante TODO o turno seguinte do dono e expira no fim dele', () => {
    const e = engine(9);
    startMain(e);
    // aplicado no turno do jogador 0 sobre o ativo do jogador 1
    applyStatusToChar(g0(e), player(e.state, 1).active!, 'exhausted', 1);
    const atkB = charDef(player(e.state, 1).active!).attacks[0].id;
    // turno do jogador 1: não pode atacar
    e.state.activePlayer = 1;
    const legal = e.legalActions(1);
    expect(legal.attacks.every((a) => !a.playable)).toBe(true);
    expect(e.dispatch({ type: 'ATTACK', player: 1, attackId: atkB }).ok).toBe(false);
    // fim do turno do jogador 1: expira
    e.dispatch({ type: 'END_TURN', player: 1 });
    expect(player(e.state, 1).active!.statuses.some((s) => s.id === 'exhausted')).toBe(false);
    // turno seguinte do jogador 1 (após o turno 0): ataca normalmente
    e.state.activePlayer = 0;
    e.dispatch({ type: 'END_TURN', player: 0 });
    e.state.activePlayer = 1;
    give(e, 1, 2);
    const legal2 = e.legalActions(1);
    expect(legal2.attacks.some((a) => a.playable)).toBe(true);
    expect(e.dispatch({ type: 'ATTACK', player: 1, attackId: atkB }).ok).toBe(true);
  });

  it('não bloqueia outras ações (conexão de energia, técnico, recuo)', () => {
    const e = engine(10);
    startMain(e);
    // reserva determinística para o recuo
    const meP1 = player(e.state, 1);
    e.state.activePlayer = 1;
    if (meP1.bench.length === 0) {
      const d = meP1.deck.find((c) => c.kind === 'CHARACTER');
      if (d) { meP1.deck.splice(meP1.deck.indexOf(d), 1); meP1.hand.push(d); }
      const cand = meP1.hand.find((c) => c.kind === 'CHARACTER');
      if (cand) e.dispatch({ type: 'DEPLOY_CHARACTER', player: 1, uid: cand.uid });
    }
    applyStatusToChar(g0(e), player(e.state, 1).active!, 'exhausted', 1);
    const me = player(e.state, 1);
    let res = me.hand.find((c) => c.kind === 'RESOURCE');
    if (!res) { // garante uma energia na mão (compra do topo)
      const fromDeck = me.deck.find((c) => c.kind === 'RESOURCE');
      if (fromDeck) { me.deck.splice(me.deck.indexOf(fromDeck), 1); me.hand.push(fromDeck); res = fromDeck; }
    }
    expect(res).toBeDefined();
    expect(e.dispatch({ type: 'ATTACH_RESOURCE', player: 1, uid: res!.uid, targetUid: me.active!.uid }).ok).toBe(true);
    expect(e.dispatch({ type: 'RETREAT', player: 1, benchUid: 'nenhum' }).ok).toBe(false); // alvo inválido, NÃO status
    // recuo (custo 1) exige pagamento: conecta 1 energia e verifica canRetreat
    while ((me.active!.attached.filter((a) => a.kind === 'RESOURCE')).length < 1) {
      let r2 = me.hand.find((c) => c.kind === 'RESOURCE');
      if (!r2) { const d = me.deck.find((c) => c.kind === 'RESOURCE'); if (d) { me.deck.splice(me.deck.indexOf(d), 1); me.hand.push(d); r2 = d; } }
      if (!r2) break;
      expect(e.dispatch({ type: 'ATTACH_RESOURCE', player: 1, uid: r2!.uid, targetUid: me.active!.uid }).ok).toBe(true);
    }
    expect(e.legalActions(1).canRetreat).toBe(true);
  });
});

describe('stun (não ataca NEM recua no próximo turno do dono)', () => {
  it('bloqueia ATTACK e RETREAT durante o próximo turno do dono', () => {
    const e = engine(11);
    startMain(e);
    const def = player(e.state, 1);
    // garante reserva para o recuo
    const benchChar = def.hand.find((c) => c.kind === 'CHARACTER');
    if (benchChar) e.dispatch({ type: 'DEPLOY_CHARACTER', player: 1, uid: benchChar.uid });
    applyStatusToChar(g0(e), def.active!, 'stun', 1);
    e.state.activePlayer = 1;
    expect(e.dispatch({ type: 'ATTACK', player: 1, attackId: charDef(def.active!).attacks[0].id }).ok).toBe(false);
    expect(e.legalActions(1).canRetreat).toBe(false);
    if (def.bench.length > 0) {
      expect(e.dispatch({ type: 'RETREAT', player: 1, benchUid: def.bench[0].uid }).ok).toBe(false);
    }
  });

  it('exaustão ≠ atordoamento: exhausted permite recuar (com recuo pagável), stun não', () => {
    const e = engine(12);
    startMain(e);
    const def = player(e.state, 1);
    e.state.activePlayer = 1;
    if (def.bench.length === 0) {
      const d = def.deck.find((c) => c.kind === 'CHARACTER');
      if (d) { def.deck.splice(def.deck.indexOf(d), 1); def.hand.push(d); }
      const cand = def.hand.find((c) => c.kind === 'CHARACTER');
      if (cand) e.dispatch({ type: 'DEPLOY_CHARACTER', player: 1, uid: cand.uid });
    }
    // paga o recuo (custo 1 de Xixim): conecta 1 energia (attachPerTurn=1)
    while ((def.active!.attached.filter((a) => a.kind === 'RESOURCE')).length < 1) {
      let r = def.hand.find((c) => c.kind === 'RESOURCE');
      if (!r) { const d = def.deck.find((c) => c.kind === 'RESOURCE'); if (d) { def.deck.splice(def.deck.indexOf(d), 1); def.hand.push(d); r = d; } }
      if (!r) break;
      expect(e.dispatch({ type: 'ATTACH_RESOURCE', player: 1, uid: r!.uid, targetUid: def.active!.uid }).ok).toBe(true);
    }
    applyStatusToChar(g0(e), def.active!, 'exhausted', 1);
    expect(e.legalActions(1).canRetreat).toBe(true);
    // agora com stun: recuo bloqueado
    applyStatusToChar(g0(e), def.active!, 'stun', 1);
    expect(e.legalActions(1).canRetreat).toBe(false);
  });
});

describe('silence (habilidades bloqueadas; ataques e equipamentos não)', () => {
  it('USE_ABILITY é rejeitado e some de legalActions; ataque continua legal; equipamento continua legal', () => {
    const e = engine(13, DECK_JENNY);
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const active = me.active!;
    expect((registry.card(active.defId) as CharacterDef).abilities.length).toBeGreaterThan(0);
    applyStatusToChar(g0(e), active, 'silence', 2);
    const ab = (registry.card(active.defId) as CharacterDef).abilities[0];
    expect(e.dispatch({ type: 'USE_ABILITY', player: 0, charUid: active.uid, abilityId: ab.id }).ok).toBe(false);
    expect(e.legalActions(0).abilities.every((x) => !x.playable)).toBe(true);
    // ataque NÃO é bloqueado por silêncio
    give(e, 0, 1);
    const atk = charDef(active).attacks.find((a) => a.role === 'skill')!;
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
    // equipamento NÃO é bloqueado por silêncio
    const eq = me.hand.find((c) => c.kind === 'EQUIPMENT');
    if (eq) expect(e.dispatch({ type: 'PLAY_EQUIPMENT', player: 0, uid: eq.uid, targetUid: active.uid }).ok).toBe(true);
  });
});

describe('root (imobilizado: bloqueia o recuo manual enquanto durar)', () => {
  it('RETREAT é rejeitado; troca forçada por efeito NÃO é bloqueada (regra documentada)', () => {
    const e = engine(14);
    startMain(e);
    const def = player(e.state, 1);
    e.state.activePlayer = 1;
    if (def.bench.length === 0) {
      const d = def.deck.find((c) => c.kind === 'CHARACTER');
      if (d) { def.deck.splice(def.deck.indexOf(d), 1); def.hand.push(d); }
      const cand = def.hand.find((c) => c.kind === 'CHARACTER');
      if (cand) e.dispatch({ type: 'DEPLOY_CHARACTER', player: 1, uid: cand.uid });
    }
    applyStatusToChar(g0(e), def.active!, 'root', 2);
    e.state.activePlayer = 1;
    expect(e.legalActions(1).canRetreat).toBe(false);
    if (def.bench.length > 0) {
      const r = e.dispatch({ type: 'RETREAT', player: 1, benchUid: def.bench[0].uid });
      expect(r.ok).toBe(false);
      expect((r as { error?: string }).error).toBe('cannot_retreat');
    }
    // troca FORÇADA por efeito ignora root (root impede a iniciativa do dono,
    // não o jogo): registrado via carta-fixture com forceEnemySwitch
    const switcher: ActionDef = {
      id: 'test-force-switch', kind: 'ACTION', name: 'Troca Forçada (fixture)', faction: 'neutro', rarity: 'common',
      tags: ['fixture'], art: { motif: 'tecnica', seed: 'fixture-1' },
      effects: [{ op: 'forceEnemySwitch' }], text: 'Fixture de teste.'
    };
    registry.registerCard(switcher);
    type Inst = ReturnType<typeof player>['hand'][number];
    const template = player(e.state, 0).hand.find((c) => c.kind === 'ACTION') ?? player(e.state, 0).hand[0];
    const inst = { ...(template as Inst), defId: 'test-force-switch', kind: 'ACTION' as const, uid: 'fixture-force-switch-1' } as Inst;
    player(e.state, 0).hand.push(inst);
    e.state.activePlayer = 0;
    const r2 = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: inst.uid });
    expect(r2.ok).toBe(true); // troca forçada acontece mesmo com root
  });
});
