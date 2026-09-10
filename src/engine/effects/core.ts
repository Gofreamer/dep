import type { CardInstance, CharacterDef, ConditionSpec, MatchState, PlayerId, SelectorId, TargetSpec, TargetFilterSpec } from '../types';
import { registry } from '../registry';
import { charDef, defOf, charactersInPlay, findCard, getCounter, getStatus, maxHp, opponentOf, player } from '../queries';

/** Execution context threaded through effects. */
export interface EffectCtx {
  sourceUid: string;
  sourcePlayer: PlayerId;
  /** The attack being resolved, when effects run inside an attack. */
  attackId?: string;
  /** Bound targets (e.g. from a previous chooseTarget step). */
  bound: Record<string, string>;
  /** The character hosting the source card (equipment/attached contexts). */
  hostUid?: string;
  depth: number;
}

export function resolveChar(state: MatchState, ctx: EffectCtx, selector: SelectorId | undefined): CardInstance | null {
  const sel = selector ?? 'self';
  const me = player(state, ctx.sourcePlayer);
  const opp = opponentOf(state, ctx.sourcePlayer);
  const host = ctx.hostUid ? findCard(state, ctx.hostUid)?.card : null;
  const source = findCard(state, ctx.sourceUid)?.card ?? null;
  switch (sel) {
    case 'self': return (host ?? source) as CardInstance | null;
    case 'activeAlly': return me.active;
    case 'enemyActive': return opp.active;
    case 'attacker': return ctx.bound['attacker'] ? findCard(state, ctx.bound['attacker'])?.card ?? null : null;
    case 'defender': return ctx.bound['defender'] ? findCard(state, ctx.bound['defender'])?.card ?? null : null;
    case 'lastTarget': return ctx.bound['lastTarget'] ? findCard(state, ctx.bound['lastTarget'])?.card ?? null : null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

export function filterMatches(state: MatchState, inst: CardInstance, filter: TargetFilterSpec | undefined): boolean {
  if (!filter) return true;
  const def = defOf(inst);
  if (filter.kinds && !filter.kinds.includes(def.kind)) return false;
  if (filter.factions && !filter.factions.includes(def.faction)) return false;
  if (filter.affinities && !filter.affinities.includes(def.affinity ?? def.faction)) return false;
  if (filter.families && !(def.kind === 'CHARACTER' && filter.families.includes((def as any).family ?? ''))) return false;
  if (filter.tags && !filter.tags.every((t) => def.tags.includes(t))) return false;
  if (def.kind === 'CHARACTER') {
    if (filter.maxHpAtMost !== undefined && (def as CharacterDef).maxHp > filter.maxHpAtMost) return false;
    if (filter.damageAtLeast !== undefined && inst.damage < filter.damageAtLeast) return false;
    if (filter.stageLevel !== undefined && inst.stageLevel !== filter.stageLevel) return false;
  }
  if (filter.hasStatus && !getStatus(inst, filter.hasStatus)) return false;
  if (filter.lacksStatus && getStatus(inst, filter.lacksStatus)) return false;
  if (filter.hasCounter && getCounter(inst, filter.hasCounter) <= 0) return false;
  if (filter.hasAttachedType && !inst.attached.some((a) => a.kind === 'RESOURCE' && (defOf(a) as any).resourceType === filter.hasAttachedType)) return false;
  if (filter.isUnique && !def.unique) return false;
  return true;
}

/** All candidate uids for a target spec (before count selection). */
export function targetCandidates(state: MatchState, ctx: EffectCtx, spec: TargetSpec): CardInstance[] {
  const me = player(state, ctx.sourcePlayer);
  const opp = opponentOf(state, ctx.sourcePlayer);
  const self = resolveChar(state, ctx, 'self');
  let list: CardInstance[];
  switch (spec.selector) {
    case 'self': list = self ? [self] : []; break;
    case 'activeAlly': list = me.active ? [me.active] : []; break;
    case 'benchAlly': list = [...me.bench]; break;
    case 'anyAlly': list = me.active ? [me.active, ...me.bench] : [...me.bench]; break;
    case 'enemyActive': list = opp.active ? [opp.active] : []; break;
    case 'enemyBench': list = [...opp.bench]; break;
    case 'anyEnemy': list = opp.active ? [opp.active, ...opp.bench] : [...opp.bench]; break;
    case 'anyCharacter': list = [...(me.active ? [me.active] : []), ...me.bench, ...(opp.active ? [opp.active] : []), ...opp.bench]; break;
    case 'allAllies': list = me.active ? [me.active, ...me.bench] : [...me.bench]; break;
    case 'allEnemies': list = opp.active ? [opp.active, ...opp.bench] : [...opp.bench]; break;
    case 'allCharacters': list = [...(me.active ? [me.active] : []), ...me.bench, ...(opp.active ? [opp.active] : []), ...opp.bench]; break;
    case 'lastTarget': list = ctx.bound['lastTarget'] ? [findCard(state, ctx.bound['lastTarget'])?.card].filter(Boolean) as CardInstance[] : []; break;
    case 'attacker': list = ctx.bound['attacker'] ? [findCard(state, ctx.bound['attacker'])?.card].filter(Boolean) as CardInstance[] : []; break;
    case 'defender': list = ctx.bound['defender'] ? [findCard(state, ctx.bound['defender'])?.card].filter(Boolean) as CardInstance[] : []; break;
    default: list = [];
  }
  if (spec.filter?.notSource && self) list = list.filter((c) => c.uid !== self.uid);
  return list.filter((c) => filterMatches(state, c, spec.filter));
}

export function isAllSelector(spec: TargetSpec): boolean {
  return ['allAllies', 'allEnemies', 'allCharacters'].includes(spec.selector) || spec.count === 'all';
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export function evalCondition(state: MatchState, ctx: EffectCtx, cond: ConditionSpec | undefined): boolean {
  if (!cond) return true;
  const me = player(state, ctx.sourcePlayer);
  const opp = opponentOf(state, ctx.sourcePlayer);
  const sideState = (side: 'source' | 'opponent' | undefined) => (side === 'opponent' ? opp : me);
  switch (cond.op) {
    case 'always': return true;
    case 'never': return false;
    case 'coinFlip': return rand(state) < cond.chance;
    case 'hasStatus': { const t = resolveChar(state, ctx, cond.target); return !!t && !!getStatus(t, cond.status); }
    case 'damageAtLeast': { const t = resolveChar(state, ctx, cond.target); return !!t && t.damage >= cond.value; }
    case 'counterAtLeast': { const t = resolveChar(state, ctx, cond.target); return !!t && getCounter(t, cond.counter) >= cond.value; }
    case 'discardAtLeast': return sideState(cond.side).discard.length >= cond.count;
    case 'benchAtLeast': return sideState(cond.side).bench.length >= cond.value;
    case 'benchAtMost': return sideState(cond.side).bench.length <= cond.value;
    case 'deckAtLeast': return sideState(cond.side).deck.length >= cond.count;
    case 'turnAtLeast': return state.turn >= cond.turn;
    case 'vpCompare': {
      const a = me.victoryPoints, b = opp.victoryPoints;
      if (cond.compare === 'more') return a > b;
      if (cond.compare === 'less') return a < b;
      return a === b;
    }
    case 'factionInPlay': {
      const scope = cond.side ?? 'any';
      const pools = scope === 'any' ? [me, opp] : [sideState(scope as 'source' | 'opponent')];
      return pools.some((p) => charactersInPlay(state, p.index).some((c) => charDef(c).faction === cond.faction));
    }
    case 'attachedType': { const t = resolveChar(state, ctx, cond.target); return !!t && t.attached.some((a) => a.kind === 'RESOURCE' && (defOf(a) as any).resourceType === cond.resourceType); }
    case 'enemyActiveHasCostAtLeast': {
      if (!opp.active) return false;
      const atk = charDef(opp.active).attacks[0];
      if (!atk) return false;
      return atk.cost.reduce((s, c) => s + c.amount, 0) >= cond.amount;
    }
    case 'and': return cond.of.every((c) => evalCondition(state, ctx, c));
    case 'or': return cond.of.some((c) => evalCondition(state, ctx, c));
    case 'not': return !evalCondition(state, ctx, cond.of);
    default: return true;
  }
}

/** Seeded random shared by conditions and effects. */
export function rand(state: MatchState): number {
  let t = (state.rngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(state: MatchState, maxExclusive: number): number {
  return Math.floor(rand(state) * maxExclusive);
}

export function shuffleWithState<T>(state: MatchState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function factionColor(faction: string): string {
  return registry.faction(faction)?.color ?? '#888';
}
