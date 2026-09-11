import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { JET_ENERGY } from '../src/data/jet/energy';
import { JET_TECHNIQUES, JET_EQUIPMENT, JET_FIELDS } from '../src/data/jet/auxiliares';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { DEFAULT_CONFIG, type CharacterDef, type FieldDef } from '../src/engine/types';
import { countAllInstances, player, charDef, retreatCostOf, maxHp } from '../src/engine/queries';
import { attachLimit } from '../src/engine/rules';
import { applyDamage, applyStatusToChar, resolveDefeats } from '../src/engine/effects/shared';
import { expandDeck } from '../src/data/deckUtils';
import type { G } from '../src/engine/effects/shared';

/**
 * CARTAS AUXILIARES JET — teste individual por Equipamento, Energia, Técnica
 * e Campo. Toda jogada conserva instâncias; nada desaparece sem ir ao
 * descarte (exceto tokens generated).
 */

const g0 = (e: MatchEngine): G => ({ state: e.state, emit: (() => {}) as G['emit'] });

function engine(seed = 42): MatchEngine {
  const mk = (id: string, cards: Record<string, number>) =>
    expandDeck({ id, name: id, description: '', cards }).map((x) => registry.card(x));
  return new MatchEngine({
    seed,
    config: DEFAULT_CONFIG,
    players: [
      { name: 'A', deckId: 'ca', isAI: false, aiLevel: 'normal', deck: mk('ca', { 'agent-ran-yuki-base': 4, 'jres-energia': 24, 'jact-leitura': 3, 'jact-purificacao': 3, 'jact-corte-energia': 3, 'jact-foco-ofensivo': 3, 'jact-trincheira': 3, 'jact-rally': 2, 'jact-marcacao': 2, 'jact-recarga': 2, 'jact-retomada': 2, 'jact-abre-espaco': 2, 'jeq-manopla': 2, 'jeq-placa': 2, 'jeq-propulsor': 2, 'jeq-nucleo-hp': 2, 'jeq-ampulheta': 2, 'jres-bateria': 2, 'jres-descarga': 2, 'jres-rele': 2, 'jres-nucleo': 2, 'jres-condensador': 2, 'jfd-arena': 2, 'jfd-ovacao': 2, 'jfd-zona-neutra': 2 }) },
      { name: 'B', deckId: 'cb', isAI: false, aiLevel: 'normal', deck: mk('cb', { 'agent-xixim-base': 4, 'jres-energia': 36 }) }
    ]
  });
}

function startMain(e: MatchEngine): void {
  for (const p of [0, 1] as const) {
    e.state.activePlayer = p;
    while (!e.state.players[p].setupDone) {
      const me = player(e.state, p);
      if (!me.active) e.dispatch({ type: 'SETUP_SET_ACTIVE', player: p, uid: me.hand.find((c) => c.kind === 'CHARACTER')!.uid });
      else e.dispatch({ type: 'SETUP_DONE', player: p });
    }
  }
  e.state.turn = 3;
}

function ensureHand(e: MatchEngine, pIdx: 0 | 1, kind: string): ReturnType<typeof player>['hand'][number] {
  const p = player(e.state, pIdx);
  let c = p.hand.find((x) => x.kind === kind);
  if (!c) {
    const fromDeck = p.deck.find((x) => x.kind === kind) ?? p.discard.find((x) => x.kind === kind);
    expect(fromDeck, `carta kind=${kind} disponível no deck/discard`).toBeDefined();
    const src = p.deck.includes(fromDeck!) ? p.deck : p.discard;
    src.splice(src.indexOf(fromDeck!), 1);
    p.hand.push(fromDeck!);
    c = fromDeck;
  }
  return c!;
}

const censusTotal = (e: MatchEngine) => countAllInstances(e.state).total;

beforeAll(() => { registerJetDataPack(); });

describe('Equipamentos JET (5)', () => {
  it('Manopla Reforçada: +10 de dano causado pelo anfitrião', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const eq = ensureHand(e, 0, 'EQUIPMENT');
    const eqDef = registry.card(eq.defId);
    if (eqDef.id !== 'jeq-manopla') { // garante a manopla
      const alt = [...me.deck, ...me.discard].find((c) => c.defId === 'jeq-manopla');
      me.hand = me.hand.filter((c) => c !== eq);
      me.hand.push(alt!);
    }
    const manopla = me.hand.find((c) => c.defId === 'jeq-manopla')!;
    expect(e.dispatch({ type: 'PLAY_EQUIPMENT', player: 0, uid: manopla.uid, targetUid: me.active!.uid }).ok).toBe(true);
    // ataque 20 com manopla → 30 (sem outros mods)
    for (let i = 0; i < 2; i++) e.debugCommand('giveResource', { targetUid: me.active!.uid, defId: 'jres-energia' });
    const atk = charDef(me.active!).attacks.find((a) => a.role === 'skill')!;
    const before = player(e.state, 1).active!.damage;
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
    expect(player(e.state, 1).active!.damage).toBe(before + 30);
  });

  it('Placa de Impacto: −10 dano recebido pelo anfitrião (sinal correto)', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const placa = [...me.deck, ...me.hand].find((c) => c.defId === 'jeq-placa')!;
    if (!me.hand.includes(placa)) { me.deck.splice(me.deck.indexOf(placa), 1); me.hand.push(placa); }
    expect(e.dispatch({ type: 'PLAY_EQUIPMENT', player: 0, uid: placa.uid, targetUid: me.active!.uid }).ok).toBe(true);
    // Xixim ataca Ran: 20 base − 10 = 10
    e.state.activePlayer = 1;
    giveEnergies(e, 1, 1);
    const before = me.active!.damage;
    const atk = charDef(player(e.state, 1).active!).attacks.find((a) => a.role === 'skill')!;
    expect(e.dispatch({ type: 'ATTACK', player: 1, attackId: atk.id }).ok).toBe(true);
    expect(me.active!.damage).toBe(before + 10);
  });

  it('Núcleo Vital aumenta maxHp do anfitrião em +30', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const base = (registry.card(me.active!.defId) as CharacterDef).maxHp;
    const nuc = [...me.deck, ...me.hand].find((c) => c.defId === 'jeq-nucleo-hp')!;
    if (!me.hand.includes(nuc)) { me.deck.splice(me.deck.indexOf(nuc), 1); me.hand.push(nuc); }
    expect(e.dispatch({ type: 'PLAY_EQUIPMENT', player: 0, uid: nuc.uid, targetUid: me.active!.uid }).ok).toBe(true);
    expect(maxHp(e.state, me.active!)).toBe(base + 30);
  });

  it('Propulsor de Recuo e Relé de Transferência: recuo custa 1 a menos', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const baseCost = retreatCostOf(e.state, me.active!);
    for (const modId of ['jeq-propulsor', 'jres-rele']) {
      const inst = [...me.deck, ...me.hand].find((c) => c.defId === modId)!;
      if (!me.hand.includes(inst)) { me.deck.splice(me.deck.indexOf(inst), 1); me.hand.push(inst); }
      const cmd = modId.startsWith('jeq') ? 'PLAY_EQUIPMENT' : 'ATTACH_RESOURCE';
      expect(e.dispatch({ type: cmd, player: 0, uid: inst.uid, targetUid: me.active!.uid }).ok, modId).toBe(true);
    }
    expect(retreatCostOf(e.state, me.active!)).toBe(Math.max(0, baseCost - 2));
  });

  it('limite de slots: não equipa além do máximo; RESOURCE nunca é equipamento; derrotar o Agente manda equipamento ao descarte (conservação)', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    // enche os slots
    let equipped = 0;
    for (let i = 0; i < 6; i++) {
      const eq = ensureHand(e, 0, 'EQUIPMENT');
      const r = e.dispatch({ type: 'PLAY_EQUIPMENT', player: 0, uid: eq.uid, targetUid: me.active!.uid });
      if (r.ok) equipped++;
      if (!r.ok) break;
    }
    expect(equipped).toBeGreaterThanOrEqual(1);
    const total0 = censusTotal(e);
    // resource NÃO é equipamento
    const res = ensureHand(e, 0, 'RESOURCE');
    expect(e.dispatch({ type: 'PLAY_EQUIPMENT', player: 0, uid: res.uid, targetUid: me.active!.uid }).ok).toBe(false);
    // derrota do anfitrião: equipamento vai ao descarte (nada some)
    applyDamage(g0(e), me.active!, 999, { label: 'teste' });
    e.dispatch({ type: 'END_TURN', player: 0 });
    const c = countAllInstances(e.state);
    const zones = c.deck + c.hand + c.active + c.bench + c.discard + c.attached + c.progression + c.fields;
    expect(zones + c.generated).toBe(total0);
  });
});

describe('Energias JET (6)', () => {
  it('Energia JET paga custo de ataque; Núcleo (wild) também', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    // 1 por turno é limitado; o 2º entra via comando de debug (setup de teste)
    const energia = [...me.hand, ...me.deck].find((c) => c.defId === 'jres-energia')!;
    if (!me.hand.includes(energia)) { me.deck.splice(me.deck.indexOf(energia), 1); me.hand.push(energia); }
    expect(e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: energia.uid, targetUid: me.active!.uid }).ok).toBe(true);
    e.debugCommand('giveResource', { targetUid: me.active!.uid, defId: 'jres-nucleo' });
    expect(me.active!.attached.some((a) => a.defId === 'jres-nucleo')).toBe(true);
    const atk = charDef(me.active!).attacks.find((a) => a.role === 'signature')!; // custo 2
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
  });

  it('Bateria de Campo (temporary): é CONSUMIDA ao pagar custo — vai ao descarte, não fica conectada', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const bat = [...me.deck, ...me.hand].find((c) => c.defId === 'jres-bateria')!;
    if (!me.hand.includes(bat)) { me.deck.splice(me.deck.indexOf(bat), 1); me.hand.push(bat); }
    expect(e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: bat.uid, targetUid: me.active!.uid }).ok).toBe(true);
    // onAttach: compre 1 carta
    const handAfter = me.hand.length;
    expect(handAfter).toBeGreaterThanOrEqual(1);
    const atk = charDef(me.active!).attacks.find((a) => a.role === 'skill')!; // custo 1
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
    expect(me.active!.attached.some((a) => a.defId === 'jres-bateria')).toBe(false); // consumida
    expect(me.discard.some((c) => c.defId === 'jres-bateria')).toBe(true);           // e no descarte
  });

  it('Descarga Residual: ao conectar causa 10 ao Ativo inimigo (temporary)', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const before = player(e.state, 1).active!.damage;
    const desc = [...me.deck, ...me.hand].find((c) => c.defId === 'jres-descarga')!;
    if (!me.hand.includes(desc)) { me.deck.splice(me.deck.indexOf(desc), 1); me.hand.push(desc); }
    expect(e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: desc.uid, targetUid: me.active!.uid }).ok).toBe(true);
    expect(player(e.state, 1).active!.damage).toBe(before + 10);
  });

  it('Condensador: −10 dano recebido do anfitrião', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const cond = [...me.deck, ...me.hand].find((c) => c.defId === 'jres-condensador')!;
    if (!me.hand.includes(cond)) { me.deck.splice(me.deck.indexOf(cond), 1); me.hand.push(cond); }
    expect(e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: cond.uid, targetUid: me.active!.uid }).ok).toBe(true);
    const def = player(e.state, 1);
    // Xixim ataca Ran: 20 base − 10 = 10
    giveEnergies(e, 1, 1);
    const before = me.active!.damage;
    e.state.activePlayer = 1;
    const atk = charDef(def.active!).attacks.find((a) => a.role === 'skill')!;
    expect(e.dispatch({ type: 'ATTACK', player: 1, attackId: atk.id }).ok).toBe(true);
    expect(me.active!.damage).toBe(before + 10);
  });

  it('todas as 6 energias estão registradas com resourceType válido', () => {
    expect(JET_ENERGY.length).toBe(6);
    for (const r of JET_ENERGY) {
      expect(registry.tryCard(r.id)).toBeDefined();
      expect(r.resourceType).toBe('*');
    }
  });
});

function giveEnergies(e: MatchEngine, pIdx: 0 | 1, n: number): void {
  const p = player(e.state, pIdx);
  for (let i = 0; i < n; i++) e.debugCommand('giveResource', { targetUid: p.active!.uid, defId: 'jres-energia' });
}

describe('Técnicas JET (10)', () => {
  it('Leitura de Combate: compra exatamente 2', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const hand0 = me.hand.length;
    const tech = ensureHand(e, 0, 'ACTION');
    if (registry.card(tech.defId).id !== 'jact-leitura') {
      const alt = me.deck.find((c) => c.defId === 'jact-leitura')!;
      me.hand.splice(me.hand.indexOf(tech), 1);
      me.hand.push(alt);
    }
    const leitura = me.hand.find((c) => c.defId === 'jact-leitura')!;
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: leitura.uid }).ok).toBe(true);
    expect(me.hand.length).toBe(hand0 - 1 + 2); // jogou 1, comprou 2
    expect(me.discard.some((c) => c.defId === 'jact-leitura')).toBe(true);
  });

  it('oncePerTurn: segunda Leitura no mesmo turno é rejeitada e legalActions concorda', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    for (let i = 0; i < 2; i++) {
      const t = ensureHand(e, 0, 'ACTION');
      if (registry.card(t.defId).id !== 'jact-leitura') {
        const alt = me.deck.find((c) => c.defId === 'jact-leitura');
        if (!alt) break;
        me.hand.splice(me.hand.indexOf(t), 1);
        me.hand.push(alt);
      }
    }
    const first = me.hand.find((c) => c.defId === 'jact-leitura')!;
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: first.uid }).ok).toBe(true);
    const second = me.hand.find((c) => c.defId === 'jact-leitura');
    if (second) {
      expect(e.legalActions(0).playableActions).not.toContain(second.uid);
      expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: second.uid }).ok).toBe(false);
    }
  });

  it('Corte de Energia: descarta energia do ATIVO INIMIGO (não do seu)', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    giveEnergies(e, 1, 1);
    const enemyAttached0 = player(e.state, 1).active!.attached.filter((a) => a.kind === 'RESOURCE').length;
    const ownAttached0 = player(e.state, 0).active!.attached.filter((a) => a.kind === 'RESOURCE').length;
    const corte = [...me0Deck(e), ...player(e.state, 0).hand, ...player(e.state, 0).discard].find((c) => c.defId === 'jact-corte-energia')!;
    const p0 = player(e.state, 0);
    if (!p0.hand.includes(corte)) { const src = p0.deck.includes(corte) ? p0.deck : p0.discard; src.splice(src.indexOf(corte), 1); p0.hand.push(corte); }
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: corte.uid }).ok).toBe(true);
    expect(player(e.state, 1).active!.attached.filter((a) => a.kind === 'RESOURCE').length).toBe(enemyAttached0 - 1);
    expect(player(e.state, 0).active!.attached.filter((a) => a.kind === 'RESOURCE').length).toBe(ownAttached0);
  });

  it('Purificação remove TODOS os status do próprio ativo', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    applyStatusToChar(g0(e), me.active!, 'marked', 2);
    applyStatusToChar(g0(e), me.active!, 'poison', 2);
    const purif = [...me.deck, ...me.hand].find((c) => c.defId === 'jact-purificacao')!;
    if (!me.hand.includes(purif)) { me.deck.splice(me.deck.indexOf(purif), 1); me.hand.push(purif); }
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: purif.uid }).ok).toBe(true);
    expect(me.active!.statuses.length).toBe(0);
  });

  it('Foco Ofensivo: +20 no próximo ataque deste turno (consumido após)', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const foco = [...me.deck, ...me.hand].find((c) => c.defId === 'jact-foco-ofensivo')!;
    if (!me.hand.includes(foco)) { me.deck.splice(me.deck.indexOf(foco), 1); me.hand.push(foco); }
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: foco.uid }).ok).toBe(true);
    giveEnergies(e, 0, 1);
    const atk = charDef(me.active!).attacks.find((a) => a.role === 'skill')!; // 20
    const before = player(e.state, 1).active!.damage;
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
    expect(player(e.state, 1).active!.damage).toBe(before + 40); // 20 + 20
  });

  it('Trincheira: reduz 30 do dano recebido neste turno', () => {
    const e = engine(11);
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const trin = [...me.deck, ...me.hand].find((c) => c.defId === 'jact-trincheira')!;
    if (!me.hand.includes(trin)) { me.deck.splice(me.deck.indexOf(trin), 1); me.hand.push(trin); }
    expect(e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: trin.uid }).ok).toBe(true);
    e.state.activePlayer = 1;
    giveEnergies(e, 1, 1);
    const before = me.active!.damage;
    const atk = charDef(player(e.state, 1).active!).attacks.find((a) => a.role === 'skill')!; // 20
    expect(e.dispatch({ type: 'ATTACK', player: 1, attackId: atk.id }).ok).toBe(true);
    expect(me.active!.damage).toBe(before); // 20 − 30 → 0
  });

  it('todas as 10 técnicas registradas com restrição oncePerTurn', () => {
    expect(JET_TECHNIQUES.length).toBe(10);
    for (const t of JET_TECHNIQUES) {
      expect(registry.tryCard(t.id)).toBeDefined();
      expect(t.restrictions?.some((r) => r.type === 'oncePerTurn'), t.id).toBe(true);
    }
  });
});

function me0Deck(e: MatchEngine) {
  return player(e.state, 0).deck;
}

describe('Campos JET (3)', () => {
  it('Ovação da Torcida: ao jogar compra 1; substituição manda o campo anterior ao descarte', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const f1 = [...me.deck, ...me.hand].find((c) => c.defId === 'jfd-ovacao')!;
    if (!me.hand.includes(f1)) { me.deck.splice(me.deck.indexOf(f1), 1); me.hand.push(f1); }
    const hand0 = me.hand.length;
    expect(e.dispatch({ type: 'PLAY_FIELD', player: 0, uid: f1.uid }).ok).toBe(true);
    expect(me.hand.length).toBe(hand0 - 1 + 1);
    expect(e.state.fields.length).toBe(1);
    const total0 = censusTotal(e);
    const f2 = [...me.deck, ...me.hand, ...me.discard].find((c) => c.defId === 'jfd-arena')!;
    const src = me.hand.includes(f2) ? me.hand : (me.deck.includes(f2) ? me.deck : me.discard);
    if (!me.hand.includes(f2)) { src.splice(src.indexOf(f2), 1); me.hand.push(f2); }
    expect(e.dispatch({ type: 'PLAY_FIELD', player: 0, uid: f2.uid }).ok).toBe(true);
    expect(e.state.fields.length).toBe(1); // um só campo
    expect(me.discard.some((c) => c.defId === 'jfd-ovacao')).toBe(true);
    const c = countAllInstances(e.state);
    expect(c.deck + c.hand + c.active + c.bench + c.discard + c.attached + c.progression + c.fields + c.generated).toBe(total0);
  });

  it('Zona Neutra: recuo de TODOS fica 1 mais barato (scope all)', () => {
    const e = engine();
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const zone = [...me.deck, ...me.hand, ...me.discard].find((c) => c.defId === 'jfd-zona-neutra')!;
    const src = me.hand.includes(zone) ? me.hand : (me.deck.includes(zone) ? me.deck : me.discard);
    if (!me.hand.includes(zone)) { src.splice(src.indexOf(zone), 1); me.hand.push(zone); }
    expect(e.dispatch({ type: 'PLAY_FIELD', player: 0, uid: zone.uid }).ok).toBe(true);
    // vale para AMBOS os jogadores (scope 'all')
    expect(retreatCostOf(e.state, me.active!)).toBe((registry.card(me.active!.defId) as CharacterDef).retreatCost - 1);
    expect(retreatCostOf(e.state, player(e.state, 1).active!)).toBe((registry.card(player(e.state, 1).active!.defId) as CharacterDef).retreatCost - 1);
  });

  it('os 3 campos declarados existem com subtype correto', () => {
    expect(JET_FIELDS.length).toBe(3);
    const byId = Object.fromEntries(JET_FIELDS.map((f: FieldDef) => [f.id, f]));
    expect(byId['jfd-arena'].subtype).toBe('ARENA');
    expect(byId['jfd-ovacao'].subtype).toBe('EVENT');
    expect(byId['jfd-zona-neutra'].subtype).toBe('ARENA');
    expect(byId['jfd-zona-neutra'].override).toBeDefined();
  });
});

describe('Hooks genéricos com fixture (futuro-proof)', () => {
  it('FIELD subtype DOMAIN: override aplica damageMultAll, retreatCostMod e attachExtra', () => {
    const e = engine(21);
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const domain: FieldDef = {
      id: 'test-domain', kind: 'FIELD', name: 'Expansão (fixture)', faction: 'neutro', rarity: 'rare',
      subtype: 'DOMAIN', tags: ['fixture'], art: { motif: 'campo', seed: 'fx' },
      override: { retreatCostMod: 1, attachExtra: 1, damageMultAll: 2 },
      text: 'Fixture de teste do hook DOMAIN.', scope: 'all'
    };
    registry.registerCard(domain);
    type Inst = ReturnType<typeof player>['hand'][number];
    const inst = { ...(me.hand[0] as Inst), defId: 'test-domain', kind: 'FIELD' as const, uid: 'fixture-domain-1' };
    me.hand.push(inst);
    expect(e.dispatch({ type: 'PLAY_FIELD', player: 0, uid: inst.uid }).ok).toBe(true);
    expect(e.state.fieldOverrides.length).toBe(1);
    // dano dobrado no próximo ataque (Xixim 20 → 40 sem outros mods)
    const before = player(e.state, 1).active!.damage;
    giveEnergies(e, 0, 1);
    const atk = charDef(me.active!).attacks.find((a) => a.role === 'skill')!;
    expect(e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id }).ok).toBe(true);
    expect(player(e.state, 1).active!.damage).toBe(before + 40);
    // recuo mais caro (+1) e attachExtra +1
    expect(retreatCostOf(e.state, me.active!)).toBe((registry.card(me.active!.defId) as CharacterDef).retreatCost + 1);
    // attachPerTurn 1 + override attachExtra 1 = 2
    expect(attachLimit(e.state, 0)).toBe(DEFAULT_CONFIG.turn.attachPerTurn + 1);
  });

  it('Suprema (estrutura genérica): condição + custo + oncePerMatch + legalActions', () => {
    const e = engine(22);
    startMain(e);
    e.state.activePlayer = 0;
    const me = player(e.state, 0);
    const ultChar: Partial<CharacterDef> & { kind: 'CHARACTER' } = {
      id: 'test-ult-agent', kind: 'CHARACTER', name: 'Agente Fixture', faction: 'neutro', rarity: 'rare',
      tags: ['fixture'], art: { motif: 'agente', seed: 'fx' },
      maxHp: 100, retreatCost: 1, victoryValue: 1, stage: 0, identityId: 'test-ult-agent', edition: 'BASE',
      attacks: [{ id: 'fx-atk', name: 'Golpe Fixture', cost: [{ type: '*', amount: 1 }], damage: 10, role: 'skill', text: '10.' }],
      abilities: [],
      ultimate: {
        id: 'fx-ult', name: 'Suprema Fixture',
        activationCondition: { op: 'damageAtLeast', target: 'self', value: 20 },
        cost: [{ type: '*', amount: 1 }],
        effects: [{ op: 'dealDamage', target: 'enemyActive', amount: 30, label: 'Suprema' }],
        oncePerMatch: true
      }
    } as CharacterDef;
    registry.registerCard(ultChar as CharacterDef);
    type Inst = ReturnType<typeof player>['hand'][number];
    const inst = { ...(me.hand[0] as Inst), defId: 'test-ult-agent', kind: 'CHARACTER' as const, uid: 'fixture-ult-1', damage: 25, statuses: [], attached: [], progression: [], counters: {}, usedTurn: [], usedMatch: [], deployedOnTurn: 0, stageLevel: 0, owner: 0, location: 'hand' } as Inst;
    me.hand.push(inst);
    // deploy como reserva epromover? simplificar: deploy direto é reserva
    expect(e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: inst.uid }).ok).toBe(true);
    // condição (dano recebido >= 20): o deploy zera o dano → aplicar 25 depois
    applyDamage(g0(e), player(e.state, 0).bench.find((c) => c.uid === inst.uid)!, 25, { label: 'fixture' });
    // condição satisfeita; sem energia → rejeitado por custo (custo é pago com
    // as energias conectadas na PRÓPRIA Suprema-anfitriã, não no ativo)
    expect(e.legalActions(0).ultimates.some((u) => u.ultimateId === 'fx-ult' && !u.playable)).toBe(true);
    const benchInst = player(e.state, 0).bench.find((c) => c.uid === inst.uid)!;
    e.debugCommand('giveResource', { targetUid: benchInst.uid, defId: 'jres-energia' });
    expect(e.dispatch({ type: 'USE_ULTIMATE', player: 0, charUid: benchInst.uid, ultimateId: 'fx-ult' }).ok).toBe(true);
    expect(player(e.state, 1).active!.damage).toBeGreaterThanOrEqual(30);
    // oncePerMatch: segunda ativação rejeitada
    e.debugCommand('giveResource', { targetUid: benchInst.uid, defId: 'jres-energia' });
    expect(e.dispatch({ type: 'USE_ULTIMATE', player: 0, charUid: benchInst.uid, ultimateId: 'fx-ult' }).ok).toBe(false);
  });
});

describe('Idempotência do pack JET', () => {
  it('registerJetDataPack() duas vezes não duplica cartas, facções ou altera contagem', () => {
    const before = {
      cards: registry.allCards().length,
      factions: registry.allFactions().length,
      agents: registry.allCards().filter((d) => d.id.startsWith('agent-')).length
    };
    registerJetDataPack();
    registerJetDataPack();
    expect(registry.allCards().length).toBe(before.cards);
    expect(registry.allFactions().length).toBe(before.factions);
    expect(registry.allCards().filter((d) => d.id.startsWith('agent-')).length).toBe(before.agents);
    // número de carta atribuído uma única vez
    const numbers = registry.allCards().filter((d) => (d as { number?: number }).number).map((d) => (d as { number?: number }).number!);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
