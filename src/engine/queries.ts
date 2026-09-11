import type {
  CardInstance, CharacterDef, MatchState, Mods, PlayerId, PlayerState, ResourceCost, StatusInstance, AbilityDef, CardDef, AttackDef
} from './types';
import { registry } from './registry';

// ---------------------------------------------------------------------------
// Zone / card lookup helpers
// ---------------------------------------------------------------------------

export function player(state: MatchState, i: PlayerId): PlayerState {
  return state.players[i];
}

export function opponentOf(state: MatchState, i: PlayerId): PlayerState {
  return state.players[i === 0 ? 1 : 0];
}

export function defOf(inst: CardInstance): CardDef {
  return registry.card(inst.defId);
}

/** Top of the real progression stack — the currently active definition. */
export function stackTop(inst: CardInstance): CardInstance {
  const stack = inst.progression ?? [];
  return stack.length > 0 ? stack[stack.length - 1] : inst;
}

/** Base definition (bottom of the stack). */
export function baseCharDef(inst: CardInstance): CharacterDef {
  return registry.card(inst.defId) as CharacterDef;
}

/**
 * Effective character definition = top of the progression stack.
 * Every stat/attack/ability read must go through this so upgrades apply
 * without ever duplicating card instances.
 */
export function charDef(inst: CardInstance): CharacterDef {
  const top = stackTop(inst);
  return registry.card(top.defId) as CharacterDef;
}

// ---------------------------------------------------------------------------
// Card conservation (dev assertion / tests)
// ---------------------------------------------------------------------------

export interface InstanceCensus {
  deck: number; hand: number; active: number; bench: number; discard: number;
  attached: number; progression: number; fields: number; total: number;
  generated: number;
}

/**
 * Counts every real CardInstance in the match. After any normal sequence the
 * total must be conserved — only `generated: true` tokens may appear/vanish
 * (they are tracked separately and never enter the discard pile).
 */
export function countAllInstances(state: MatchState): InstanceCensus {
  const c: InstanceCensus = { deck: 0, hand: 0, active: 0, bench: 0, discard: 0, attached: 0, progression: 0, fields: 0, total: 0, generated: 0 };
  const bump = (inst: CardInstance, where: keyof Omit<InstanceCensus, 'total' | 'generated'>): void => {
    if (inst.generated) { c.generated++; return; }
    c[where]++;
  };
  for (const p of state.players) {
    for (const card of p.deck) bump(card, 'deck');
    for (const card of p.hand) bump(card, 'hand');
    if (p.active) bump(p.active, 'active');
    for (const card of p.bench) bump(card, 'bench');
    for (const card of p.discard) bump(card, 'discard');
    for (const host of [...(p.active ? [p.active] : []), ...p.bench]) {
      for (const att of host.attached) bump(att, 'attached');
      for (const up of host.progression ?? []) bump(up, 'progression');
    }
  }
  for (const f of state.fields) bump(f, 'fields');
  c.total = c.deck + c.hand + c.active + c.bench + c.discard + c.attached + c.progression + c.fields;
  return c;
}

export function findCard(state: MatchState, uid: string): { card: CardInstance; owner: PlayerState; location: 'deck' | 'hand' | 'active' | 'bench' | 'discard' | 'attached' | 'progression'; hostUid?: string } | null {
  for (const p of state.players) {
    if (p.active?.uid === uid) return { card: p.active, owner: p, location: 'active' };
    const inBench = p.bench.find((c) => c.uid === uid);
    if (inBench) return { card: inBench, owner: p, location: 'bench' };
    const inHand = p.hand.find((c) => c.uid === uid);
    if (inHand) return { card: inHand, owner: p, location: 'hand' };
    const inDeck = p.deck.find((c) => c.uid === uid);
    if (inDeck) return { card: inDeck, owner: p, location: 'deck' };
    const inDiscard = p.discard.find((c) => c.uid === uid);
    if (inDiscard) return { card: inDiscard, owner: p, location: 'discard' };
    for (const c of [...p.bench, ...(p.active ? [p.active] : [])]) {
      const att = c.attached.find((a) => a.uid === uid);
      if (att) return { card: att, owner: p, location: 'attached', hostUid: c.uid };
      const up = (c.progression ?? []).find((a) => a.uid === uid);
      if (up) return { card: up, owner: p, location: 'progression', hostUid: c.uid };
    }
  }
  const field = state.fields.find((c) => c.uid === uid);
  if (field) return { card: field, owner: player(state, field.owner), location: 'discard' };
  return null;
}

export function charactersInPlay(state: MatchState, owner: PlayerId): CardInstance[] {
  const p = player(state, owner);
  return p.active ? [p.active, ...p.bench] : [...p.bench];
}

export function isCharacterInPlay(state: MatchState, uid: string): CardInstance | null {
  const found = findCard(state, uid);
  if (!found) return null;
  if (found.location === 'active' || found.location === 'bench') return found.card;
  return null;
}

// ---------------------------------------------------------------------------
// Statuses / counters
// ---------------------------------------------------------------------------

export function getStatus(inst: CardInstance, statusId: string): StatusInstance | undefined {
  return inst.statuses.find((s) => s.id === statusId);
}

export function hasStatus(inst: CardInstance, statusId: string): boolean {
  return inst.statuses.some((s) => s.id === statusId);
}

export function getCounter(inst: CardInstance, name: string): number {
  return inst.counters[name] ?? 0;
}

// ---------------------------------------------------------------------------
// Modifier aggregation (equipment, fields, passive auras, statuses, temp mods)
// ---------------------------------------------------------------------------

export interface AggregatedMods { flat: number; mult: number }

function emptyMods(): AggregatedMods { return { flat: 0, mult: 1 }; }

function collectAbilityMods(out: { dealt: AggregatedMods; taken: AggregatedMods; other: Mods[] }, mods: Mods | undefined, forChar: CardInstance, side: 'dealt' | 'taken'): void {
  if (!mods) return;
  if (side === 'dealt') {
    if (mods.damageDealtFlat) out.dealt.flat += mods.damageDealtFlat;
    if (mods.damageDealtMult) out.dealt.mult *= mods.damageDealtMult;
    if (mods.damageDealtVsAffinity) { /* handled by caller with affinity */ }
  } else {
    // CONVENÇÃO ÚNICA (igual a StatusDef): damageTakenFlat > 0 = REDUZ o dano
    // recebido (ex.: Placa de Impacto 10, aura do Henry 10). Era somado aqui —
    // equipamentos defensivos AUMENTAVAM o dano sofrido (bug de sinal).
    if (mods.damageTakenFlat) out.taken.flat -= mods.damageTakenFlat;
    if (mods.damageTakenMult) out.taken.mult *= mods.damageTakenMult;
  }
  out.other.push(mods);
}

export interface ModContext {
  /** The character whose perspective we aggregate (attacker or defender). */
  char: CardInstance;
  owner: PlayerId;
  side: 'dealt' | 'taken';
  /** Affinity of the incoming/outgoing attack, for affinity-specific mods. */
  affinity?: string;
}

export interface AggregatedResult {
  dealt: AggregatedMods;
  taken: AggregatedMods;
  other: Mods[];
}

/** Aggregates every modifier that applies to a character in a given context. */
export function aggregateMods(state: MatchState, mc: ModContext): AggregatedResult {
  const out: AggregatedResult = { dealt: emptyMods(), taken: emptyMods(), other: [] };
  const push = (mods: Mods | undefined, side: 'dealt' | 'taken') => collectAbilityMods(out, mods, mc.char, side);

  // NOTA: status NÃO contribuem aqui — damageTakenFlat/damageTakenBonusFlat de
  // status são aplicados exclusivamente em applyDamage (dano de qualquer fonte,
  // sem dupla contagem). Ver convenção em StatusDef (src/engine/types.ts).

  // Equipment attached to this character
  for (const eq of mc.char.attached) {
    if (eq.kind !== 'EQUIPMENT') continue;
    const edef = defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>;
    push(edef.mods, mc.side);
  }

  // Passive aura abilities — ONLY auras owned by the affected side count
  // (an enemy aura must never buff this side's damage or protection).
  for (const p of state.players) {
    if (p.index !== mc.owner) continue;
    for (const c of charactersInPlay(state, p.index)) {
      const cdef = charDef(c);
      for (const ab of cdef.abilities) {
        if (!ab.mods) continue;
        if (ab.trigger !== 'whileActive' && ab.trigger !== 'whileBench') continue;
        const isActive = state.players[c.owner].active?.uid === c.uid;
        if (ab.trigger === 'whileActive' && !isActive) continue;
        if (ab.trigger === 'whileBench' && isActive) continue;
        push(ab.mods, mc.side);
      }
      // Some resources grant mods to their host
      for (const res of c.attached) {
        if (res.kind !== 'RESOURCE') continue;
        const rdef = defOf(res) as Extract<CardDef, { kind: 'RESOURCE' }>;
        push(rdef.mods, mc.side);
      }
    }
  }

  // Fields
  for (const f of state.fields) {
    const fdef = defOf(f) as Extract<CardDef, { kind: 'FIELD' }>;
    if (fdef.scope === 'owner' && f.owner !== mc.owner) continue;
    push(fdef.mods, mc.side);
  }

  // Temporary modifiers
  for (const tm of state.tempMods) {
    if (tm.targetUid && tm.targetUid !== mc.char.uid) continue;
    if (!tm.targetUid && tm.owner !== mc.owner) continue;
    push(tm.mods, mc.side);
  }

  // Affinity-specific bonus for the relevant side
  if (mc.affinity) {
    const applyAffinity = (mods: Mods | undefined) => {
      if (!mods) return;
      const dv = mods.damageDealtVsAffinity;
      if (mc.side === 'dealt' && dv && dv.affinity === mc.affinity) {
        out.dealt.flat += dv.flat ?? 0;
        if (dv.mult) out.dealt.mult *= dv.mult;
      }
      const dt = mods.damageTakenFromAffinity;
      if (mc.side === 'taken' && dt && dt.affinity === mc.affinity) {
        out.taken.flat += dt.flat ?? 0;
        if (dt.mult) out.taken.mult *= dt.mult;
      }
    };
    for (const eq of mc.char.attached) {
      if (eq.kind !== 'EQUIPMENT') continue;
      applyAffinity((defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>).mods);
    }
    for (const f of state.fields) {
      const fdef = defOf(f) as Extract<CardDef, { kind: 'FIELD' }>;
      if (fdef.scope === 'owner' && f.owner !== mc.owner) continue;
      applyAffinity(fdef.mods);
    }
    for (const tm of state.tempMods) {
      if (tm.targetUid && tm.targetUid !== mc.char.uid) continue;
      if (!tm.targetUid && tm.owner !== mc.owner) continue;
      applyAffinity(tm.mods);
    }
  }

  return out;
}

export function sumMods(mods: Mods[], key: keyof Mods): number {
  return mods.reduce((acc, m) => acc + ((m[key] as number) ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Effective stats
// ---------------------------------------------------------------------------

export function maxHp(state: MatchState, inst: CardInstance): number {
  const def = charDef(inst);
  let hp = def.maxHp;
  for (const eq of inst.attached) {
    if (eq.kind === 'EQUIPMENT') hp += ((defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>).mods?.statBonusHp) ?? 0;
  }
  hp += getCounter(inst, 'hpBonus');
  for (const tm of state.tempMods) {
    if (tm.targetUid === inst.uid) hp += tm.mods.statBonusHp ?? 0;
  }
  return Math.max(1, hp);
}

export function currentHp(state: MatchState, inst: CardInstance): number {
  return Math.max(0, maxHp(state, inst) - inst.damage);
}

export function isDefeated(state: MatchState, inst: CardInstance): boolean {
  return inst.damage >= maxHp(state, inst);
}

export function retreatCostOf(state: MatchState, inst: CardInstance): number {
  const def = charDef(inst);
  let cost = def.retreatCost;
  // Equipamentos E recursos conectados podem modular o recuo (ex.: Relé de
  // Transferência — texto: 'recusta com 1 Energia a menos').
  for (const eq of inst.attached) {
    if (eq.kind === 'EQUIPMENT') cost += (defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>).mods?.retreatCostMod ?? 0;
    else if (eq.kind === 'RESOURCE') cost += (defOf(eq) as Extract<CardDef, { kind: 'RESOURCE' }>).mods?.retreatCostMod ?? 0;
  }
  for (const f of state.fields) {
    const fdef = defOf(f) as Extract<CardDef, { kind: 'FIELD' }>;
    if (fdef.scope === 'owner' && f.owner !== inst.owner) continue;
    cost += fdef.mods?.retreatCostMod ?? 0;
  }
  for (const ov of state.fieldOverrides) {
    if (ov.blockRetreat || ov.blockSwitching) continue;
    cost += ov.retreatCostMod ?? 0;
  }
  for (const tm of state.tempMods) {
    if (tm.targetUid === inst.uid) cost += tm.mods.retreatCostMod ?? 0;
  }
  return Math.max(0, cost);
}

export function cannotRetreat(state: MatchState, inst: CardInstance): boolean {
  for (const st of inst.statuses) {
    const sdef = registry.status(st.id);
    if (sdef?.blocksRetreat) return true;
  }
  for (const eq of inst.attached) {
    if (eq.kind === 'EQUIPMENT' && (defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>).mods?.cannotRetreat) return true;
  }
  for (const ov of state.fieldOverrides) {
    if (ov.blockSwitching || ov.blockRetreat) return true;
  }
  return false;
}

/** Can this character use abilities right now? */
export function abilitiesBlocked(state: MatchState, inst: CardInstance): boolean {
  for (const st of inst.statuses) {
    const sdef = registry.status(st.id);
    if (sdef?.blocksAbilities) return true;
  }
  for (const eq of inst.attached) {
    if (eq.kind === 'EQUIPMENT' && (defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>).mods?.abilitiesDisabled) return true;
  }
  for (const ov of state.fieldOverrides) {
    if (ov.disableAbilities && ov.owner !== inst.owner) return true;
  }
  const isActive = state.players[inst.owner].active?.uid === inst.uid;
  for (const c of charactersInPlay(state, inst.owner === 0 ? 1 : 0)) {
    for (const ab of charDef(c).abilities) {
      if (ab.mods?.abilitiesDisabled && ab.trigger === 'whileActive' && isActive) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Resource costs
// ---------------------------------------------------------------------------

export interface ResourcePoolEntry { inst: CardInstance; type: string; wild: boolean }

export function resourcePool(inst: CardInstance): ResourcePoolEntry[] {
  return inst.attached.filter((a) => a.kind === 'RESOURCE').map((r) => {
    const rd = defOf(r) as Extract<CardDef, { kind: 'RESOURCE' }>;
    return { inst: r, type: rd.resourceType, wild: !!rd.wild };
  });
}

/** Returns the concrete resource instances used to pay `cost`, or null. */
export function matchCost(inst: CardInstance, cost: ResourceCost, costReduce = 0): ResourcePoolEntry[] | null {
  const pool = resourcePool(inst);
  const used: ResourcePoolEntry[] = [];
  const take = (pred: (e: ResourcePoolEntry) => boolean): boolean => {
    // prefer temporary resources so persistent ones stay
    const idx = pool.findIndex((e) => !used.includes(e) && pred(e));
    if (idx === -1) return false;
    used.push(pool[idx]);
    return true;
  };
  let reduced = costReduce;
  for (const entry of cost) {
    for (let i = 0; i < entry.amount; i++) {
      if (reduced > 0) { reduced--; continue; }
      if (entry.type === '*') {
        if (!take(() => true)) return null;
      } else {
        if (!take((e) => e.wild || e.type === entry.type)) return null;
      }
    }
  }
  return used;
}

export function costSatisfied(inst: CardInstance, cost: ResourceCost, costReduce = 0): boolean {
  return matchCost(inst, cost, costReduce) !== null;
}

export function hasAbility(inst: CardInstance, abilityId: string): AbilityDef | undefined {
  return charDef(inst).abilities.find((a) => a.id === abilityId);
}

export function grantedAttacks(state: MatchState, inst: CardInstance): AttackDef[] {
  const out: AttackDef[] = [...charDef(inst).attacks];
  for (const eq of inst.attached) {
    if (eq.kind === 'EQUIPMENT') {
      out.push(...((defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>).grantsAttacks ?? []));
    }
  }
  return out;
}

export function equipmentSlots(state: MatchState, inst: CardInstance): number {
  const def = charDef(inst);
  return def.equipmentSlots ?? state.config.board.equipmentSlotsDefault;
}
