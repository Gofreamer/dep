import type {
  CardInstance, CardDef, CharacterDef, ChoiceRequest, GameEventType, MatchState, Mods, PlayerId, PlayerState, StatusDef
} from '../types';
import { registry } from '../registry';
import {
  aggregateMods, charDef, charactersInPlay, defOf, findCard, isDefeated, maxHp, player
} from '../queries';
import { emit } from '../events';
import type { EffectCtx } from './core';
import { evalCondition, randInt, rand, shuffleWithState } from './core';

/** I/O surface the engine provides to shared gameplay code. */
export interface G {
  state: MatchState;
  emit: (type: GameEventType, player: PlayerId | null, payload?: Record<string, unknown>) => void;
}

export type YieldedChoice = ChoiceRequest;

// ---------------------------------------------------------------------------
// Card instances & zone movement
// ---------------------------------------------------------------------------

export function newCardInstance(g: G, def: CardDef, owner: PlayerId): CardInstance {
  g.state.nextUid = (g.state.nextUid ?? 1) + 1;
  return {
    uid: `c${g.state.nextUid}`,
    defId: def.id,
    owner,
    kind: def.kind,
    damage: 0,
    stageLevel: def.kind === 'CHARACTER' ? (def as CharacterDef).stage : 0,
    statuses: [],
    counters: {},
    attached: [],
    usedTurn: [],
    usedMatch: [],
    deployedOnTurn: g.state.turn
  };
}

function removeFromOwnerZones(g: G, inst: CardInstance): void {
  for (const p of g.state.players) {
    p.deck = p.deck.filter((c) => c.uid !== inst.uid);
    p.hand = p.hand.filter((c) => c.uid !== inst.uid);
    p.bench = p.bench.filter((c) => c.uid !== inst.uid);
    p.discard = p.discard.filter((c) => c.uid !== inst.uid);
    if (p.active?.uid === inst.uid) p.active = null;
    for (const c of [...p.bench, ...(p.active ? [p.active] : [])]) {
      c.attached = c.attached.filter((a) => a.uid !== inst.uid);
    }
  }
  g.state.fields = g.state.fields.filter((c) => c.uid !== inst.uid);
}

/** Enter-play reset for characters. */
function resetForPlay(g: G, inst: CardInstance): void {
  inst.damage = 0;
  inst.statuses = [];
  inst.usedTurn = [];
  inst.usedMatch = [];
  inst.counters = {};
  inst.deployedOnTurn = g.state.turn;
  inst.stageLevel = defOf(inst).kind === 'CHARACTER' ? (defOf(inst) as CharacterDef).stage : 0;
}

export function toBench(g: G, inst: CardInstance, ownerId: PlayerId): void {
  removeFromOwnerZones(g, inst);
  resetForPlay(g, inst);
  player(g.state, ownerId).bench.push(inst);
  g.emit('CARD_MOVED', ownerId, { uid: inst.uid, to: 'bench' });
}

export function toDiscard(g: G, inst: CardInstance, ownerId: PlayerId): void {
  removeFromOwnerZones(g, inst);
  if (inst.kind === 'CHARACTER') { inst.statuses = []; }
  player(g.state, ownerId).discard.push(inst);
  g.emit('CARD_MOVED', ownerId, { uid: inst.uid, to: 'discard' });
}

export function toHand(g: G, inst: CardInstance, ownerId: PlayerId): void {
  removeFromOwnerZones(g, inst);
  player(g.state, ownerId).hand.push(inst);
  g.emit('CARD_MOVED', ownerId, { uid: inst.uid, to: 'hand' });
}

export function toDeckTop(g: G, inst: CardInstance, ownerId: PlayerId): void {
  removeFromOwnerZones(g, inst);
  player(g.state, ownerId).deck.push(inst);
  g.emit('CARD_MOVED', ownerId, { uid: inst.uid, to: 'deck' });
}

export function shuffleDeck(g: G, ownerId: PlayerId): void {
  shuffleWithState(g.state, player(g.state, ownerId).deck);
}

export function drawCards(g: G, ownerId: PlayerId, amount: number): number {
  const p = player(g.state, ownerId);
  let drawn = 0;
  for (let i = 0; i < amount; i++) {
    if (p.deck.length === 0) {
      if (g.state.config.victory.deckOutLoses && g.state.winner === null) {
        g.state.winner = (ownerId === 0 ? 1 : 0) as PlayerId;
        g.state.endReason = 'deck_out';
        g.state.phase = 'gameOver';
        g.emit('MATCH_ENDED', g.state.winner, { reason: 'deck_out' });
      }
      break;
    }
    const card = p.deck.pop()!;
    p.hand.push(card);
    drawn++;
    g.emit('CARD_DRAWN', ownerId, { uid: card.uid, defId: card.defId });
  }
  g.state.stats.cardsDrawn[ownerId] += drawn;
  return drawn;
}

export function attachToChar(g: G, inst: CardInstance, host: CardInstance): void {
  removeFromOwnerZones(g, inst);
  host.attached.push(inst);
  const kind = inst.kind === 'RESOURCE' ? 'RESOURCE_ATTACHED' : 'EQUIPMENT_PLAYED';
  g.emit(kind, inst.owner, { uid: inst.uid, hostUid: host.uid, defId: inst.defId });
}

export function detachFromChar(g: G, inst: CardInstance, to: 'discard' | 'hand'): void {
  const found = findCard(g.state, inst.uid);
  if (!found || found.location !== 'attached' || !found.hostUid) return;
  const host = findCard(g.state, found.hostUid)!.card;
  host.attached = host.attached.filter((a) => a.uid !== inst.uid);
  if (to === 'hand') toHand(g, inst, inst.owner); else toDiscard(g, inst, inst.owner);
  g.emit('RESOURCE_DETACHED', inst.owner, { uid: inst.uid, to });
}

// ---------------------------------------------------------------------------
// Damage pipeline
// ---------------------------------------------------------------------------

export interface DamageOpts {
  isAttack?: boolean;
  affinity?: string;
  ignoreWeakness?: boolean;
  ignoreResistance?: boolean;
  attackerUid?: string;
  label?: string;
}

export function computeAttackDamage(g: G, attacker: CardInstance, target: CardInstance, base: number, opts: DamageOpts): { total: number; notes: string[] } {
  const notes: string[] = [];
  const cfg = g.state.config.damage;
  const atkAffinity = opts.affinity ?? charDef(attacker).affinity ?? charDef(attacker).faction;

  // Attacker-side mods
  const atk = aggregateMods(g.state, { char: attacker, owner: attacker.owner, side: 'dealt', affinity: atkAffinity });
  let dmg = base + atk.dealt.flat;
  dmg *= atk.dealt.mult;
  if (atk.dealt.flat !== 0) notes.push(atk.dealt.flat > 0 ? `+${atk.dealt.flat} bônus` : `${atk.dealt.flat}`);
  if (atk.dealt.mult !== 1) notes.push(`×${atk.dealt.mult}`);

  // Field global multiplier (battlefield override)
  for (const ov of g.state.fieldOverrides) {
    if (ov.damageMultAll) { dmg *= ov.damageMultAll; notes.push(`×${ov.damageMultAll} campo`); }
  }

  // Weakness / resistance
  const tdef = charDef(target);
  if (opts.isAttack && !opts.ignoreWeakness && tdef.weakness && tdef.weakness.affinity === atkAffinity) {
    dmg *= cfg.weaknessMultiplier;
    notes.push('fraqueza ×' + cfg.weaknessMultiplier);
  }
  if (opts.isAttack && !opts.ignoreResistance && tdef.resistance && tdef.resistance.affinity === atkAffinity) {
    dmg -= tdef.resistance.reduce ?? cfg.resistanceDefaultReduce;
    notes.push('resistência');
  }

  // Defender-side mods
  const def = aggregateMods(g.state, { char: target, owner: target.owner, side: 'taken', affinity: atkAffinity });
  dmg += def.taken.flat;
  dmg *= def.taken.mult;
  if (def.taken.flat !== 0) notes.push(def.taken.flat > 0 ? `+${def.taken.flat}` : `${def.taken.flat} redução`);
  if (def.taken.mult !== 1) notes.push(`×${def.taken.mult}`);

  return { total: Math.max(0, Math.floor(dmg)), notes };
}

export function applyDamage(g: G, target: CardInstance, amount: number, opts: DamageOpts = {}): number {
  if (amount <= 0 || g.state.phase === 'gameOver') return 0;
  const dealt = Math.min(amount, maxHp(g.state, target) === 0 ? amount : amount);
  target.damage += dealt;
  g.state.stats.damage[target.owner] += dealt;
  g.emit('DAMAGE_DEALT', target.owner, {
    uid: target.uid, amount: dealt, hpAfter: Math.max(0, maxHp(g.state, target) - target.damage),
    isAttack: !!opts.isAttack, label: opts.label, attackerUid: opts.attackerUid
  });
  queueHostTriggers(g, target, 'onDamaged', { amount: dealt });
  return dealt;
}

// ---------------------------------------------------------------------------
// Healing & statuses
// ---------------------------------------------------------------------------

export function healChar(g: G, target: CardInstance, amount: number): number {
  const cap = maxHp(g.state, target);
  const healed = Math.min(amount, target.damage);
  if (healed <= 0) return 0;
  target.damage -= healed;
  g.state.stats.healed[target.owner] += healed;
  g.emit('HEALED', target.owner, { uid: target.uid, amount: healed, hpAfter: cap - target.damage });
  queueHostTriggers(g, target, 'onHealed', { amount: healed });
  return healed;
}

export function statusDef(id: string): StatusDef | undefined {
  return registry.status(id);
}

export function applyStatusToChar(g: G, target: CardInstance, statusId: string, tokens = 2, stacks = 1): boolean {
  const sdef = registry.status(statusId);
  if (!sdef) return false;
  // Immunities
  for (const eq of target.attached) {
    if (eq.kind === 'EQUIPMENT') {
      const imm = (defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>).mods?.statusImmune;
      if (imm?.includes(statusId)) return false;
    }
  }
  if (target.statuses.some((s) => s.id === 'shield' && statusId !== 'shield' && sdef.kind === 'debuff' && registry.status('shield'))) {
    // shield status blocks new debuffs only if configured with tokens>=3
    const shield = target.statuses.find((s) => s.id === 'shield')!;
    if (shield.tokens >= 3) { shield.tokens -= 1; g.emit('STATUS_TICKED', target.owner, { uid: target.uid, status: 'shield', blocked: statusId }); return false; }
  }
  const existing = target.statuses.find((s) => s.id === statusId);
  if (existing) {
    if (sdef.stacking === 'stack') { existing.stacks += stacks; existing.tokens = Math.max(existing.tokens, tokens); }
    else if (sdef.stacking === 'refresh') { existing.tokens = Math.max(existing.tokens, tokens); }
    else return false;
  } else {
    target.statuses.push({ id: statusId, tokens, stacks, sinceTurn: g.state.turn });
  }
  g.emit('STATUS_APPLIED', target.owner, { uid: target.uid, status: statusId, tokens });
  return true;
}

export function removeStatusFromChar(g: G, target: CardInstance, statusId: string): boolean {
  const before = target.statuses.length;
  target.statuses = target.statuses.filter((s) => s.id !== statusId);
  if (target.statuses.length !== before) {
    g.emit('STATUS_REMOVED', target.owner, { uid: target.uid, status: statusId });
    return true;
  }
  return false;
}

/** Applies status timing (damage/heal ticks, token consumption) for one owner. */
export function tickStatuses(g: G, ownerId: PlayerId, timing: 'turnEndOwner' | 'turnStartOwner'): void {
  const p = player(g.state, ownerId);
  for (const c of charactersInPlay(g.state, ownerId)) {
    for (const s of [...c.statuses]) {
      const sdef = registry.status(s.id);
      if (!sdef || sdef.timing !== timing) continue;
      if (sdef.damagePerTick) applyDamage(g, c, sdef.damagePerTick * (s.stacks || 1), { label: s.id });
      if (sdef.healPerTick) healChar(g, c, sdef.healPerTick);
      g.emit('STATUS_TICKED', ownerId, { uid: c.uid, status: s.id });
      s.tokens -= 1;
      if (s.tokens <= 0) {
        if (sdef.shedChance !== undefined && rand(g.state) >= sdef.shedChance && s.tokens <= 0) {
          s.tokens = 1; // survives one extra tick with a chance-based shed
        } else {
          removeStatusFromChar(g, c, s.id);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Triggers queue (serializable; drained by the engine)
// ---------------------------------------------------------------------------

export function queueHostTriggers(g: G, host: CardInstance, event: string, payload?: Record<string, unknown>): void {
  g.state.triggerQueue.push({ event, sourceUid: host.uid, player: host.owner, payload });
}

export function queueGlobalTriggers(g: G, event: string, payload?: Record<string, unknown>): void {
  for (const p of g.state.players) {
    for (const c of charactersInPlay(g.state, p.index)) {
      g.state.triggerQueue.push({ event, sourceUid: c.uid, player: p.index, payload });
    }
    for (const f of g.state.fields) {
      g.state.triggerQueue.push({ event, sourceUid: f.uid, player: f.owner, payload });
    }
  }
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export interface UpgradeOpts { keepDamage?: boolean; keepAttached?: boolean; bonusHp?: number; cause?: string }

/** Validates and performs a character upgrade. Throws Error with reason on failure. */
export function performUpgrade(g: G, inst: CardInstance, toDefId: string, opts: UpgradeOpts = {}): void {
  const fromDef = charDef(inst);
  const toDef = registry.tryCard(toDefId) as CharacterDef | undefined;
  if (!toDef || toDef.kind !== 'CHARACTER') throw new Error('Destino de evolução inválido');
  const cfg = g.state.config.progression;
  const sameFamily = toDef.family !== undefined && toDef.family === fromDef.family;
  const explicitPath = (fromDef.upgradesTo ?? []).includes(toDefId);
  if (!sameFamily && !explicitPath) throw new Error('Esta carta não evolui para esse personagem');
  const stageGap = toDef.stage - fromDef.stage;
  if (stageGap < 1) throw new Error('Estágio de destino inválido');
  if (stageGap > 1 && !cfg.canSkipStages && !explicitPath) throw new Error('Não é possível pular estágios');

  const keepDamage = opts.keepDamage ?? cfg.damageCarriesOver;
  const keepAttached = opts.keepAttached ?? cfg.keepAttachedOnUpgrade;
  const oldDamage = inst.damage;
  const oldAttached = keepAttached ? inst.attached : [];
  const oldCounters = { ...inst.counters };

  inst.defId = toDefId;
  inst.stageLevel = toDef.stage;
  inst.statuses = [];
  if (!keepDamage) inst.damage = 0;
  if (!keepAttached) inst.attached = [];
  inst.counters = oldCounters;
  if (opts.bonusHp) inst.counters['hpBonus'] = (inst.counters['hpBonus'] ?? 0) + opts.bonusHp;
  void oldAttached; void oldDamage;

  g.emit('CHARACTER_UPGRADED', inst.owner, { uid: inst.uid, from: fromDef.id, to: toDefId, keptDamage: keepDamage });
  g.state.triggerQueue.push({ event: 'onUpgrade', sourceUid: inst.uid, player: inst.owner });
}

// ---------------------------------------------------------------------------
// Defeat resolution & victory (generator: may request replacement choices)
// ---------------------------------------------------------------------------

export function victoryValueOf(g: G, inst: CardInstance): number {
  const def = charDef(inst);
  let vp = def.victoryValue;
  // Equipment / field vpBonus
  for (const eq of inst.attached) {
    if (eq.kind === 'EQUIPMENT') vp += (defOf(eq) as Extract<CardDef, { kind: 'EQUIPMENT' }>).mods?.vpBonus ?? 0;
  }
  for (const f of g.state.fields) {
    const fdef = defOf(f) as Extract<CardDef, { kind: 'FIELD' }>;
    if (fdef.scope === 'owner' && f.owner !== inst.owner) continue;
    vp += fdef.mods?.vpBonus ?? 0;
  }
  return Math.max(0, vp);
}

function awardVictoryPoints(g: G, p: PlayerId, amount: number, cause: string): void {
  if (amount === 0) return;
  player(g.state, p).victoryPoints += amount;
  g.emit('VICTORY_POINTS_CHANGED', p, { amount, total: player(g.state, p).victoryPoints, cause });
}

export function checkMatchEnd(g: G): void {
  if (g.state.winner !== null) return;
  const target = g.state.config.victory.targetPoints;
  for (const p of g.state.players) {
    if (target > 0 && p.victoryPoints >= target) {
      g.state.winner = p.index;
      g.state.phase = 'gameOver';
      g.state.endReason = 'victory_points';
      g.emit('MATCH_ENDED', p.index, { reason: 'victory_points' });
      return;
    }
  }
}

/** Processes every defeated character: triggers, VP, zones, replacement. */
export function* resolveDefeats(g: G): Generator<YieldedChoice, void, string[]> {
  for (let guard = 0; guard < 32; guard++) {
    const defeated: { inst: CardInstance; wasActive: boolean }[] = [];
    for (const p of g.state.players) {
      for (const c of charactersInPlay(g.state, p.index)) {
        if (isDefeated(g.state, c)) defeated.push({ inst: c, wasActive: p.active?.uid === c.uid });
      }
    }
    if (defeated.length === 0) break;

    for (const { inst, wasActive } of defeated) {
      if (g.state.winner !== null) return;
      const owner = inst.owner;
      const enemy: PlayerId = owner === 0 ? 1 : 0;
      const def = charDef(inst);

      g.emit('CHARACTER_DEFEATED', owner, { uid: inst.uid, defId: inst.defId, wasActive, victoryValue: victoryValueOf(g, inst) });

      // Defeat triggers (before moving zones)
      g.state.triggerQueue.push({ event: 'onLeavePlay', sourceUid: inst.uid, player: owner });
      g.state.triggerQueue.push({ event: 'onAllyDefeated', sourceUid: inst.uid, player: owner });
      g.state.triggerQueue.push({ event: 'onEnemyDefeated', sourceUid: inst.uid, player: enemy });

      awardVictoryPoints(g, enemy, victoryValueOf(g, inst), 'defeat');

      // Move attached cards, then the character
      for (const att of [...inst.attached]) toDiscard(g, att, att.owner);
      inst.attached = [];
      toDiscard(g, inst, owner);

      // Replacement
      const p = player(g.state, owner);
      if (wasActive && g.state.winner === null) {
        if (p.bench.length === 0) {
          if (g.state.config.victory.noActiveLoses) {
            g.state.winner = enemy;
            g.state.endReason = 'no_active';
            g.state.phase = 'gameOver';
            g.emit('MATCH_ENDED', enemy, { reason: 'no_active' });
            return;
          }
        } else {
          const chosen = yield {
            kind: 'target',
            player: owner,
            prompt: 'Escolha um novo personagem ativo',
            candidates: p.bench.map((c) => c.uid),
            min: 1,
            max: 1,
            optional: false,
            labels: Object.fromEntries(p.bench.map((c) => [c.uid, defOf(c).name]))
          };
          const pick = p.bench.find((c) => c.uid === chosen[0]) ?? p.bench[0];
          promoteToActive(g, pick);
        }
      }
    }
    checkMatchEnd(g);
  }
}

export function promoteToActive(g: G, inst: CardInstance): void {
  const p = player(g.state, inst.owner);
  p.bench = p.bench.filter((c) => c.uid !== inst.uid);
  if (p.active) toBench(g, p.active, inst.owner);
  p.active = inst;
  inst.deployedOnTurn = Math.min(inst.deployedOnTurn, g.state.turn);
  g.emit('ACTIVE_SWITCHED', inst.owner, { uid: inst.uid, defId: inst.defId });
}

/** Retires the active character to the bench and promotes the chosen one. */
export function retreatActive(g: G, benchInst: CardInstance): void {
  const p = player(g.state, benchInst.owner);
  const old = p.active;
  p.bench = p.bench.filter((c) => c.uid !== benchInst.uid);
  p.active = benchInst;
  if (old) {
    p.bench.push(old);
    g.emit('ACTIVE_SWITCHED', benchInst.owner, { uid: benchInst.uid, defId: benchInst.defId, benched: old.uid });
  } else {
    g.emit('ACTIVE_SWITCHED', benchInst.owner, { uid: benchInst.uid, defId: benchInst.defId });
  }
}

// keep unused import references alive for type checking convenience
void findCard;
void evalCondition;
void randInt;
void aggregateMods;
