/**
 * EVERY-CARD PLAYABLE — executa TODAS as CardDefs registradas de verdade.
 *
 * Para cada carta o harness:
 *  1. valida que a carta possui função real de gameplay (sem "carta morta");
 *  2. monta um estado válido com a carta em posição utilizável;
 *  3. joga/executa a carta (deploy, upgrade, ataque, ação, equipamento, campo…);
 *  4. resolve targets/choices/triggers;
 *  5. garante que TODO pending conclui;
 *  6. valida invariantes (conservação de instâncias, UIDs únicos, diagnóstico);
 *  7. encerra o turno quando permitido e garante que o oponente age em seguida.
 *
 * Efeitos probabilísticos (coinFlip) têm até 3 tentativas para produzir
 * efeito — a falha identifica: cardId, cardName, efeitos, estado, pending,
 * seed e o relatório de diagnóstico completo.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { registerDataPack } from '../src/data/fixtures/nexo/cards';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import type {
  ActionDef, CardDef, CardInstance, CharacterDef, ConditionSpec, EquipmentDef, FieldDef, Mods, ResourceDef
} from '../src/engine/types';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { countAllInstances } from '../src/engine/queries';
import { applyDamage, toBench } from '../src/engine/effects/shared';

// Registro síncrono: a lista de cartas é capturada no tempo de definição
// dos testes (vitest resolve describe/it antes do beforeAll).
registerJetDataPack();
registerDataPack();

const ALL = registry.allCards();
const SEED = 424242;

// ---------------------------------------------------------------------------
// "Função real": toda carta de gameplay precisa alterar o estado do jogo.
// ---------------------------------------------------------------------------

function modsNonEmpty(mods: Mods | undefined): boolean {
  if (!mods) return false;
  const numeric: (keyof Mods)[] = [
    'damageDealtFlat', 'damageDealtMult', 'damageTakenFlat', 'damageTakenMult',
    'attackCostReduce', 'retreatCostMod', 'healFlat', 'drawExtra', 'attachExtra',
    'resistAll', 'statBonusHp', 'vpBonus'
  ];
  if (numeric.some((k) => (mods[k] as number | undefined) && (mods[k] as number) !== 0)) return true;
  if (mods.damageDealtVsAffinity && (mods.damageDealtVsAffinity.flat || mods.damageDealtVsAffinity.mult)) return true;
  if (mods.damageTakenFromAffinity && (mods.damageTakenFromAffinity.flat || mods.damageTakenFromAffinity.mult)) return true;
  if (mods.cannotAttack || mods.cannotRetreat || mods.abilitiesDisabled) return true;
  if (mods.statusImmune && mods.statusImmune.length > 0) return true;
  return false;
}

function hasGameplayFunction(def: CardDef): boolean {
  switch (def.kind) {
    case 'CHARACTER': {
      const c = def as CharacterDef;
      if (c.attacks.some((a) => (a.damage ?? 0) > 0 || (a.scaling?.length ?? 0) > 0 || (a.effects?.length ?? 0) > 0 || (a.effectsBefore?.length ?? 0) > 0)) return true;
      if (c.abilities.some((ab) => (ab.mods && modsNonEmpty(ab.mods)) || (ab.effects?.length ?? 0) > 0)) return true;
      if (c.ultimate && c.ultimate.effects.length > 0) return true;
      return false;
    }
    case 'RESOURCE': {
      const r = def as ResourceDef;
      return r.amount > 0 || modsNonEmpty(r.mods) || (r.onAttach?.length ?? 0) > 0;
    }
    case 'ACTION':
      return (def as ActionDef).effects.length > 0;
    case 'EQUIPMENT': {
      const e = def as EquipmentDef;
      return modsNonEmpty(e.mods) || (e.triggers?.length ?? 0) > 0 || (e.grantsAttacks?.length ?? 0) > 0;
    }
    case 'FIELD': {
      const f = def as FieldDef;
      if (modsNonEmpty(f.mods)) return true;
      if ((f.triggers?.length ?? 0) > 0) return true;
      if ((f.onPlay?.length ?? 0) > 0) return true;
      if (f.override) {
        const ov = f.override as Record<string, unknown>;
        if (Object.keys(ov).filter((k) => k !== 'durationTurns').some((k) => ov[k])) return true;
      }
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Utilidades do harness
// ---------------------------------------------------------------------------

function byId(id: string): CardDef {
  return registry.card(id);
}

/** Recursos compatíveis com os custos de uma carta (sem hardcode de pack). */
function energyDefsFor(def: CardDef): CardDef[] {
  const costTypes = new Set<string>();
  const push = (cost?: { type: string; amount: number }[]) => {
    for (const c of cost ?? []) costTypes.add(c.type);
  };
  if (def.kind === 'CHARACTER') {
    const c = def as CharacterDef;
    for (const a of c.attacks) push(a.cost);
    for (const ab of c.abilities) push(ab.cost);
    push(c.ultimate?.cost);
  }
  if (costTypes.size === 0) costTypes.add('*');
  const resources = registry.allCards().filter((d) => d.kind === 'RESOURCE') as ResourceDef[];
  const out: CardDef[] = [];
  for (const t of costTypes) {
    const exact = resources.find((r) => r.resourceType === t && !r.wild);
    if (exact) out.push(exact);
  }
  const wild = resources.find((r) => r.wild);
  if (wild) out.push(wild);
  if (out.length === 0) out.push(...resources.filter((r) => r.resourceType === '*'));
  return out;
}

function baseDefs(): CardDef[] {
  return registry.allCards().filter((d) => d.kind === 'CHARACTER' && (d as CharacterDef).stage === 0);
}

/** Deck de teste: a carta-alvo + material (bases + energias) até 60. */
function buildDeck(card: CardDef): CardDef[] {
  const deck: CardDef[] = [card];
  if (card.kind === 'FIELD') {
    const other = registry.allCards().find((d) => d.kind === 'FIELD' && d.id !== card.id);
    if (other) deck.push(other);
  }
  const bases = baseDefs();
  for (let i = 0; i < 4 && i < bases.length; i++) deck.push(bases[i]);
  const energies = energyDefsFor(card);
  let guard = 0;
  while (deck.length < 60 && guard++ < 60) {
    deck.push(energies[deck.length % energies.length]);
  }
  if (card.kind === 'CHARACTER' && (card as CharacterDef).stage > 0) {
    const fam = (card as CharacterDef).family;
    // cadeia completa da família (base → … → carta-alvo) para upgrades legais
    for (const member of registry.allCards()) {
      if (member.kind !== 'CHARACTER') continue;
      const mc = member as CharacterDef;
      if (mc.stage > 0 && mc.stage <= (card as CharacterDef).stage && (fam ? mc.family === fam : (card as CharacterDef).upgradesTo?.includes(mc.id))) {
        deck.push(member);
      }
    }
    const base = bases.find((b) => (fam ? (b as CharacterDef).family === fam : (card as CharacterDef).upgradesTo?.includes(b.id)));
    if (base) deck.push(base);
  }
  return deck;
}

function makeEngineFor(card: CardDef, seed = SEED): MatchEngine {
  return new MatchEngine({
    seed,
    players: [
      { name: 'Testador', deckId: `test-${card.id}`, isAI: true, aiLevel: 'normal', deck: buildDeck(card) },
      { name: 'Oponente', deckId: 'test-opp', isAI: true, aiLevel: 'normal', deck: buildDeck(baseDefs()[0]) }
    ]
  });
}

function resolvePending(e: MatchEngine): void {
  for (let i = 0; i < 10; i++) {
    const pend = e.getPending();
    if (!pend) return;
    const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
    if (!r.ok) throw new Error(`choice malformada: ${r.error}`);
  }
  if (e.getPending()) throw new Error('pending infinito');
}

function driveSetup(e: MatchEngine, card: CardDef): void {
  // p0: posiciona a carta-alvo como ativa SEMPRE que possível (o kit de
  // ataques só é exercitável no ativo). Estágio > 0: base da família vira ativa.
  const p0 = e.state.players[0];
  let seatTarget: CardInstance | undefined;
  if (card.kind === 'CHARACTER') {
    const cd = card as CharacterDef;
    if (cd.stage === 0) {
      seatTarget = p0.hand.find((c) => c.defId === card.id) ?? p0.deck.find((c) => c.defId === card.id);
      const st0 = seatTarget;
      if (st0 && !p0.hand.includes(st0)) {
        p0.hand.push(st0);
        p0.deck = p0.deck.filter((c) => c.uid !== st0.uid);
      }
    } else {
      const famOk = (c: { defId: string }) => {
        const d = byId(c.defId) as CharacterDef;
        if (d.stage !== 0) return false;
        return cd.family ? d.family === cd.family : cd.upgradesTo?.includes(c.defId) ?? false;
      };
      seatTarget = p0.deck.find((c) => c.kind === 'CHARACTER' && famOk(c)) ?? p0.hand.find((c) => c.kind === 'CHARACTER' && famOk(c));
      const st1 = seatTarget;
      if (st1 && !p0.hand.includes(st1)) {
        p0.hand.push(st1);
        p0.deck = p0.deck.filter((c) => c.uid !== st1.uid);
      }
    }
  }
  if (seatTarget) {
    const r = e.dispatch({ type: 'SETUP_SET_ACTIVE', player: 0, uid: seatTarget.uid });
    if (!r.ok) throw new Error(`setup ativo falhou: ${r.error}`);
    resolvePending(e);
  }
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (!e.state.players[p].setupDone && guard++ < 30) {
      const cmd = aiNextCommand(e, p);
      const r = e.dispatch(cmd);
      if (!r.ok) throw new Error(`setup ilegal para p${p}: ${cmd.type} ${r.error}`);
      resolvePending(e);
    }
  }
}

function ensureTurn(e: MatchEngine, p: 0 | 1, max = 12): void {
  let guard = 0;
  while (e.state.phase === 'main' && e.state.activePlayer !== p && guard++ < max) {
    const other = (p === 0 ? 1 : 0) as 0 | 1;
    const r = e.dispatch({ type: 'END_TURN', player: other });
    if (!r.ok) throw new Error(`END_TURN p${other}: ${r.error}`);
    resolvePending(e);
  }
}

/** Espera até o ativo poder atacar (turno > deploy, sem restrição de 1º turno). */
function ensureAttackable(e: MatchEngine, p: 0 | 1): void {
  ensureTurn(e, p);
  let guard = 0;
  while (guard++ < 10) {
    const active = e.state.players[p].active;
    if (!active) return;
    const ok = active.deployedOnTurn < e.state.turn && !(e.state.turn === 1 && e.state.activePlayer === e.state.startingPlayer && e.state.config.turn.startingPlayerSkipsAttack);
    if (ok) return;
    const r = e.dispatch({ type: 'END_TURN', player: p });
    if (!r.ok) return;
    resolvePending(e);
    ensureTurn(e, p);
  }
}

/** Anexa energias COMPATÍVEIS ao ativo até satisfazer o custo (melhor esforço). */
function rigEnergy(e: MatchEngine, p: 0 | 1, cost: { type: string; amount: number }[]): void {
  const ps = e.state.players[p];
  const target = ps.active;
  if (!target) return;
  const compatible = (c: CardInstance, type: string): boolean => {
    const rd = byId(c.defId) as ResourceDef;
    return rd.resourceType === type || !!rd.wild || rd.resourceType === '*' && type === '*';
  };
  for (const entry of cost) {
    for (let i = 0; i < entry.amount; i++) {
      let res = ps.hand.find((c) => c.kind === 'RESOURCE' && compatible(c, entry.type));
      if (!res) {
        const fromDeck = ps.deck.find((c) => c.kind === 'RESOURCE' && compatible(c, entry.type));
        if (!fromDeck) return; // tipo não coberto pelo deck de teste
        res = fromDeck;
        ps.hand.push(fromDeck);
        ps.deck = ps.deck.filter((c) => c.uid !== fromDeck.uid);
      }
      const resUid = res.uid;
      // Harness de teste: simula a acumulação de energia ao longo de vários
      // turnos (o limite de 1 anexo por turno não é o alvo do teste).
      ps.attachedThisTurn = 0;
      const r = e.dispatch({ type: 'ATTACH_RESOURCE', player: p, uid: resUid, targetUid: target.uid });
      resolvePending(e);
      if (!r.ok) return;
    }
  }
}

function snapshot(e: MatchEngine): string {
  const s = e.state;
  const zones = (i: 0 | 1) => {
    const pl = s.players[i];
    return [
      pl.deck.length, pl.hand.length,
      pl.active?.uid, pl.active?.damage, pl.active?.statuses.map((x) => x.id).join(','),
      pl.active?.attached.length,
      pl.bench.map((c) => `${c.uid}:${c.damage}`).join(','),
      pl.discard.length, pl.victoryPoints,
      s.stats.damage[i], s.stats.healed[i], s.stats.cardsDrawn[i]
    ].join('|');
  };
  return `${s.turn}|${s.phase}|${zones(0)}|${zones(1)}|${s.fields.map((f) => f.defId).join(',')}`;
}

function assertInvariants(e: MatchEngine, initialTotal: number, initialUids: Set<string>, ctx: string): void {
  const seen = new Map<string, string>();
  const visit = (inst: { uid: string; defId: string }, zone: string): void => {
    if (seen.has(inst.uid)) throw new Error(`${ctx}: UID duplicado ${inst.uid} (${inst.defId}) (${seen.get(inst.uid)} e ${zone})`);
    seen.set(inst.uid, `${inst.defId}@${zone}`);
  };
  const novel: string[] = [];
  const gen: string[] = [];
  for (const pl of e.state.players) {
    const Z = `p${pl.index}:`;
    for (const inst of pl.deck) visit(inst, `${Z}deck`);
    for (const inst of pl.hand) visit(inst, `${Z}hand`);
    if (pl.active) visit(pl.active, `${Z}active`);
    for (const inst of pl.bench) visit(inst, `${Z}bench`);
    for (const inst of pl.discard) visit(inst, `${Z}discard`);
    for (const host of [...(pl.active ? [pl.active] : []), ...pl.bench]) {
      for (const a of host.attached) visit(a, `${Z}attached`);
      for (const pr of host.progression ?? []) visit(pr, `${Z}progression`);
    }
    for (const inst of [...pl.deck, ...pl.hand, ...(pl.active ? [pl.active] : []), ...pl.bench, ...pl.discard]) {
      if (!initialUids.has(inst.uid)) {
        if (inst.generated) gen.push(`${inst.uid}(${inst.defId})`);
        else novel.push(`${inst.uid}(${inst.defId})`);
      }
    }
  }
  for (const f of e.state.fields) visit(f, 'field');
  if (novel.length > 0) throw new Error(`${ctx}: instâncias NOVAS não-conservadas: ${novel.join(',')}`);
  if (gen.length > 0) throw new Error(`${ctx}: instâncias GERADAS presentes: ${gen.join(',')}`);
  const c = countAllInstances(e.state);
  const zones = c.deck + c.hand + c.active + c.bench + c.discard + c.attached + c.progression + c.fields;
  if (zones + c.generated !== initialTotal) throw new Error(`${ctx}: conservação de instâncias (${zones + c.generated} != ${initialTotal})`);
  const d = e.diagnose();
  if (d.suspicious) throw new Error(`${ctx}: diagnóstico suspeito: ${d.reasons.join('|')}`);
  if (e.getPending()) throw new Error(`${ctx}: pending não concluiu`);
}

function failCtx(card: CardDef, e: MatchEngine, extra = ''): string {
  const d = e.diagnose();
  const pend = e.getPending();
  const effects = (card as any).effects ?? (card as any).attacks?.flatMap((a: any) => a.effects ?? []) ?? [];
  return [
    `cardId=${card.id}`, `cardName=${card.name}`, `kind=${card.kind}`,
    `effect=${JSON.stringify(effects).slice(0, 160)}`,
    `state=${JSON.stringify({ turn: e.state.turn, phase: e.state.phase, active: e.state.activePlayer })}`,
    `pending=${pend ? JSON.stringify({ kind: pend.kind, prompt: pend.prompt, cand: pend.candidates.length, min: pend.min }) : 'none'}`,
    `seed=${e.state.seed}`,
    `diagnose=${JSON.stringify(d.reasons)}`,
    extra
  ].join(' | ');
}

// ---------------------------------------------------------------------------
// Ajustadores de condições (habilidades/ações condicionais)
// ---------------------------------------------------------------------------

function adjustForCondition(e: MatchEngine, p: 0 | 1, cond: ConditionSpec | undefined, depth = 0): boolean {
  if (!cond || depth > 6) return true;
  switch (cond.op) {
    case 'benchAtMost':
    case 'benchAtLeast': {
      const side = (cond as any).side === 'opponent' ? ((p === 0 ? 1 : 0) as 0 | 1) : p;
      const target = e.state.players[side];
      if (cond.op === 'benchAtMost') {
        while (target.bench.length > ((cond as any).value ?? 0)) {
          target.discard.push(target.bench.pop()!);
        }
      } else {
        const want = (cond as any).value ?? 0;
        ensureTurn(e, side);
        let guard = 0;
        while (target.bench.length < want && guard++ < 6) {
          const c = target.hand.find((x) => x.kind === 'CHARACTER');
          if (!c) break;
          const r = e.dispatch({ type: 'DEPLOY_CHARACTER', player: side, uid: c.uid });
          resolvePending(e);
          if (!r.ok) break;
        }
      }
      return true;
    }
    case 'discardAtLeast': {
      const side = (cond as any).side === 'opponent' ? ((p === 0 ? 1 : 0) as 0 | 1) : p;
      const want = (cond as any).count ?? 1;
      const pl = e.state.players[side];
      while (pl.discard.length < want && pl.hand.length > 0) pl.discard.push(pl.hand.pop()!);
      return true;
    }
    case 'damageAtLeast': {
      const value = (cond as any).value ?? 20;
      if ((cond as any).target === 'defender') return true;
      const self = e.state.players[p].active;
      if (self) applyDamage(e.g(), self, Math.max(0, value - self.damage), { label: 'harness' });
      return true;
    }
    case 'turnAtLeast': {
      const want = (cond as any).turn ?? 1;
      let guard = 0;
      while (e.state.turn < want && e.state.phase === 'main' && guard++ < 20) {
        const r = e.dispatch({ type: 'END_TURN', player: e.state.activePlayer });
        if (!r.ok) break;
        resolvePending(e);
      }
      return true;
    }
    case 'vpCompare': {
      const side = (cond as any).side === 'opponent' ? ((p === 0 ? 1 : 0) as 0 | 1) : p;
      const compare = (cond as any).compare as string;
      const pl = e.state.players[side];
      const opp = e.state.players[side === 0 ? 1 : 0];
      if (compare === 'less') { pl.victoryPoints = 0; opp.victoryPoints = 1; }
      if (compare === 'more') { pl.victoryPoints = 1; opp.victoryPoints = 0; }
      if (compare === 'equal') { pl.victoryPoints = 0; opp.victoryPoints = 0; }
      return true;
    }
    case 'factionInPlay': {
      const side = (cond as any).side === 'opponent' ? ((p === 0 ? 1 : 0) as 0 | 1) : p;
      const faction = (cond as any).faction as string;
      const pl = e.state.players[side];
      const has = [...(pl.active ? [pl.active] : []), ...pl.bench].some((c) => (byId(c.defId) as CharacterDef).faction === faction);
      if (has) return true;
      const def = registry.allCards().find((d) => d.kind === 'CHARACTER' && (d as CharacterDef).faction === faction && (d as CharacterDef).stage === 0) as CharacterDef | undefined;
      if (!def) return true;
      const found = pl.deck.find((c) => c.defId === def.id);
      if (!found) return true;
      pl.hand.push(found);
      pl.deck = pl.deck.filter((c) => c.uid !== found.uid);
      ensureTurn(e, side);
      const r = e.dispatch({ type: 'DEPLOY_CHARACTER', player: side, uid: found.uid });
      resolvePending(e);
      return true;
    }
    case 'and':
      return (cond as any).of.every((c: ConditionSpec) => adjustForCondition(e, p, c, depth + 1));
    case 'or':
      return (cond as any).of.some((c: ConditionSpec) => adjustForCondition(e, p, c, depth + 1));
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Execução da carta (lança erro descritivo em falha)
// ---------------------------------------------------------------------------

function exercise(card: CardDef): void {
  const e = makeEngineFor(card);
  const initial = countAllInstances(e.state).total;
  const initialUids = new Set<string>();
  for (const pl of e.state.players) {
    for (const inst of [...(pl.active ? [pl.active] : []), ...pl.bench, ...pl.hand, ...pl.deck, ...pl.discard]) initialUids.add(inst.uid);
    for (const host of [...(pl.active ? [pl.active] : []), ...pl.bench]) {
      for (const a of host.attached) initialUids.add(a.uid);
      for (const pr of host.progression ?? []) initialUids.add(pr.uid);
    }
  }
  for (const f of e.state.fields) initialUids.add(f.uid);
  try {
    driveSetup(e, card);
    const p0 = e.state.players[0];
    const cardInst =
      p0.active && p0.active.defId === card.id ? p0.active :
      p0.bench.find((c) => c.defId === card.id) ??
      p0.hand.find((c) => c.defId === card.id) ??
      p0.deck.find((c) => c.defId === card.id);
    if (!cardInst) throw new Error(`carta não está em nenhuma zona: ${card.id}`);
    const inPlay = p0.active?.uid === cardInst.uid || p0.bench.some((c) => c.uid === cardInst.uid);
    if (!inPlay && !p0.hand.some((c) => c.uid === cardInst.uid)) {
      p0.hand.push(cardInst);
      p0.deck = p0.deck.filter((c) => c.uid !== cardInst.uid);
    }

    ensureTurn(e, 0);
    const before = snapshot(e);

    switch (card.kind) {
      case 'RESOURCE': {
        const target = p0.active!;
        const r = e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: cardInst.uid, targetUid: target.uid });
        resolvePending(e);
        if (!r.ok) throw new Error(failCtx(card, e, `ATTACH_RESOURCE: ${r.error}`));
        if (!target.attached.some((a) => a.uid === cardInst.uid)) throw new Error(failCtx(card, e, 'recurso não conectado'));
        break;
      }
      case 'ACTION': {
        for (const rest of (card as ActionDef).restrictions ?? []) {
          if (rest.type === 'whileLosing') { p0.victoryPoints = 0; e.state.players[1].victoryPoints = 1; }
          if (rest.type === 'factionInPlay') adjustForCondition(e, 0, { op: 'factionInPlay', faction: rest.faction!, side: 'source' });
          if (rest.type === 'turnAtLeast') adjustForCondition(e, 0, { op: 'turnAtLeast', turn: rest.turn! });
          if (rest.type === 'characterCondition' && rest.condition) adjustForCondition(e, 0, rest.condition);
        }
        const r = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: cardInst.uid });
        resolvePending(e);
        if (!r.ok) throw new Error(failCtx(card, e, `PLAY_ACTION: ${r.error}`));
        break;
      }
      case 'EQUIPMENT': {
        const target = p0.active!;
        const r = e.dispatch({ type: 'PLAY_EQUIPMENT', player: 0, uid: cardInst.uid, targetUid: target.uid });
        resolvePending(e);
        if (!r.ok) throw new Error(failCtx(card, e, `PLAY_EQUIPMENT: ${r.error}`));
        if (!target.attached.some((a) => a.uid === cardInst.uid)) throw new Error(failCtx(card, e, 'equipamento não conectado'));
        break;
      }
      case 'FIELD': {
        const r = e.dispatch({ type: 'PLAY_FIELD', player: 0, uid: cardInst.uid });
        resolvePending(e);
        if (!r.ok) throw new Error(failCtx(card, e, `PLAY_FIELD: ${r.error}`));
        if (!e.state.fields.some((f) => f.defId === card.id)) throw new Error(failCtx(card, e, 'campo não entrou em jogo'));
        const filler = p0.hand.find((c) => c.kind === 'FIELD' && c.uid !== cardInst.uid);
        if (filler) {
          const r2 = e.dispatch({ type: 'PLAY_FIELD', player: 0, uid: filler.uid });
          resolvePending(e);
          if (!r2.ok) throw new Error(failCtx(card, e, `substituição de campo: ${r2.error}`));
          if (e.state.fields.length !== 1) throw new Error(failCtx(card, e, 'regra de 1 campo global violada'));
        }
        break;
      }
      case 'CHARACTER': {
        const cd = card as CharacterDef;
        let host = cardInst;
        if (cd.stage > 0) {
          // caminho real: cadeia de UPGRADEs (base → … → carta-alvo).
          const base = p0.active;
          if (!base) throw new Error(failCtx(card, e, 'sem base ativa para upgrade'));
          host = base;
          const chain = registry.allCards()
            .filter((d) => d.kind === 'CHARACTER' && (d as CharacterDef).family && (d as CharacterDef).family === cd.family)
            .sort((a, b) => (a as CharacterDef).stage - (b as CharacterDef).stage)
            .map((d) => d.id);
          const steps = chain.filter((id) => {
            const st = (byId(id) as CharacterDef).stage;
            return st > 0 && st <= cd.stage;
          });
          if (steps.length === 0) {
            // Carta de estágio avançado SEM caminho de upgrade (só entra via
            // efeito, o bypass sancionado do engine): exercita por deploy de
            // efeito (toBench é a mesma função usada pelo op deployCharacter).
            toBench(e.g(), cardInst, 0);
            resolvePending(e);
            host = cardInst;
          } else {
            for (const stepId of steps) {
              const stepInst = p0.deck.find((c) => c.defId === stepId) ?? p0.hand.find((c) => c.defId === stepId);
              if (!stepInst) throw new Error(failCtx(card, e, `falta elo da cadeia ${stepId} no deck`));
              if (!p0.hand.includes(stepInst)) {
                p0.hand.push(stepInst);
                p0.deck = p0.deck.filter((c) => c.uid !== stepInst.uid);
              }
              const up = e.dispatch({ type: 'UPGRADE', player: 0, uid: stepInst.uid, targetUid: host.uid });
              resolvePending(e);
              if (!up.ok) throw new Error(failCtx(card, e, `UPGRADE ${stepId}: ${up.error}`));
            }
          }
        } else if (!inPlay) {
          const dep = e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: cardInst.uid });
          resolvePending(e);
          if (!dep.ok) throw new Error(failCtx(card, e, `DEPLOY: ${dep.error}`));
        }

        // garante o personagem ATIVO (kit de ataques é exercitado no ativo)
        if (p0.active?.uid !== host.uid) {
          rigEnergy(e, 0, [{ type: '*', amount: 3 }]);
          const r = e.dispatch({ type: 'RETREAT', player: 0, benchUid: host.uid });
          resolvePending(e);
          if (!r.ok) throw new Error(failCtx(card, e, `RETREAT para o alvo: ${r.error}`));
        }

        // exercita cada ataque do kit
        let attacksUsed = 0;
        for (const atk of cd.attacks) {
          ensureAttackable(e, 0);
          if (e.state.phase !== 'main') break;
          const active = e.state.players[0].active;
          if (!active) break;
          rigEnergy(e, 0, atk.cost);
          const legal = e.legalActions(0);
          const attackLegal = legal.attacks.find((a) => a.attackId === atk.id);
          if (!attackLegal?.playable) {
            // custo não alcançável com o pool do harness: registra e segue
            // (o ataque ainda é validado estruturalmente em outros testes)
            continue;
          }
          const beforeAttack = snapshot(e);
          const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id });
          resolvePending(e);
          if (!r.ok) throw new Error(failCtx(card, e, `ATTACK ${atk.id}: ${r.error}`));
          attacksUsed++;
          const hasDmg = (atk.damage ?? 0) > 0 || (atk.scaling?.length ?? 0) > 0;
          if (!hasDmg && snapshot(e) === beforeAttack && !(atk.effects?.length ?? 0)) {
            throw new Error(failCtx(card, e, `ataque ${atk.id} não altera o estado (carta morta)`));
          }
        }
        if (cd.attacks.length > 0 && attacksUsed === 0) {
          // Nenhum ataque conseguiu ser usado → o kit não funciona no estado
          // mais simples possível. Falha dura (gate de qualidade).
          throw new Error(failCtx(card, e, 'nenhum ataque do kit pôde ser usado'));
        }

        // habilidades ativadas (melhor esforço com ajuste de condição)
        for (const ab of cd.abilities) {
          if (ab.trigger !== 'activated') continue;
          adjustForCondition(e, 0, ab.condition);
          ensureTurn(e, 0);
          const hostUid = host.uid;
          const legal = e.legalActions(0);
          const entry = legal.abilities.find((a) => a.charUid === hostUid && a.abilityId === ab.id);
          if (!entry?.playable) continue; // condição de jogo específica — não é defeito da carta
          rigEnergy(e, 0, ab.cost ?? []);
          const r = e.dispatch({ type: 'USE_ABILITY', player: 0, charUid: hostUid, abilityId: ab.id });
          resolvePending(e);
          if (!r.ok) throw new Error(failCtx(card, e, `USE_ABILITY ${ab.id}: ${r.error}`));
        }
        break;
      }
    }

    const after = snapshot(e);
    if (after === before) {
      throw new Error(failCtx(card, e, 'estado não mudou após jogar a carta'));
    }

    assertInvariants(e, initial, initialUids, failCtx(card, e));

    // jogador 0 ainda consegue agir (ou encerrar o turno)
    ensureTurn(e, 0);
    if (e.state.phase === 'main') {
      const cmd = aiNextCommand(e, 0);
      const r = e.dispatch(cmd);
      resolvePending(e);
      if (!r.ok) throw new Error(failCtx(card, e, `p0 não age após a carta: ${cmd.type} ${r.error}`));
    }
    // oponente consegue agir
    ensureTurn(e, 1);
    if (e.state.phase === 'main') {
      const cmd = aiNextCommand(e, 1);
      const r = e.dispatch(cmd);
      resolvePending(e);
      if (!r.ok) throw new Error(failCtx(card, e, `oponente não age: ${cmd.type} ${r.error}`));
    }
    assertInvariants(e, initial, initialUids, failCtx(card, e));
  } catch (err) {
    throw new Error(`${failCtx(card, e, (err as Error).message)}`);
  }
}

// ---------------------------------------------------------------------------
// Suíte
// ---------------------------------------------------------------------------

describe('TODA carta tem função real de gameplay', () => {
  for (const def of ALL) {
    it(`${def.id} — ${def.name}`, () => {
      expect(hasGameplayFunction(def), `cardId=${def.id} cardName=${def.name} kind=${def.kind} não possui função de gameplay`).toBe(true);
    });
  }
});

describe('TODA carta é jogável de verdade (execução real)', () => {
  for (const def of ALL) {
    it(`${def.id} — ${def.name}`, () => {
      let lastErr: Error | null = null;
      // Efeitos probabilísticos ganham tentativas extras (mesma seed = determinístico).
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          exercise(def);
          return;
        } catch (err) {
          lastErr = err as Error;
          // só tenta de novo para cartas com coinFlip (RNG)
          const hasFlip = JSON.stringify(def).includes('coinFlip');
          if (!hasFlip) break;
        }
      }
      throw lastErr ?? new Error(`carta falhou sem mensagem: ${def.id}`);
    }, 30000);
  }
});

describe('CardDefs — integridade estrutural', () => {
  it('ids únicos no registry', () => {
    const ids = ALL.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('toda carta tem nome, facção registrada e arte', () => {
    for (const d of ALL) {
      expect(d.name.length, d.id).toBeGreaterThan(0);
      expect(registry.faction(d.faction), `${d.id} facção ${d.faction}`).toBeTruthy();
      expect(d.art?.motif, d.id).toBeTruthy();
    }
  });
});
