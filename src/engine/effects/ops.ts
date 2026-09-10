import type { CardInstance, ChoiceRequest, EffectStep, MatchState, PlayerId, SelectorId, TargetSpec, CharacterDef, ScalingSpec } from '../types';
import { registry } from '../registry';
import {
  charDef, charactersInPlay, costSatisfied, defOf, findCard, matchCost, maxHp, opponentOf, player
} from '../queries';
import type { EffectCtx } from './core';
import { evalCondition, randInt, rand, resolveChar, shuffleWithState, targetCandidates } from './core';
import {
  applyDamage, applyStatusToChar, attachToChar, computeAttackDamage, detachFromChar, drawCards, G, healChar,
  performGeneratedUpgrade, promoteToActive, removeStatusFromChar, retreatActive, shuffleDeck, toBench, toDeckTop, toDiscard,
  toHand, victoryValueOf
} from './shared';

// ---------------------------------------------------------------------------
// Op framework
// ---------------------------------------------------------------------------

export type Params = Record<string, any>;
export type ChoiceYield = ChoiceRequest;
export type OpFn = (g: G, ctx: EffectCtx, p: Params) => Generator<ChoiceYield, void, string[]>;

const ops: Record<string, OpFn> = {};

export function getOp(name: string): OpFn {
  const fn = ops[name];
  if (!fn) throw new Error(`Efeito desconhecido: ${name}`);
  return fn;
}

export function* runSteps(g: G, ctx: EffectCtx, steps: EffectStep[] | undefined): Generator<ChoiceYield, void, string[]> {
  if (!steps) return;
  for (const step of steps) {
    if (ctx.depth > 24) return; // recursion guard
    const fn = getOp(step.op);
    yield* fn(g, ctx, step);
  }
}

// ---------------------------------------------------------------------------
// Shared selection helpers
// ---------------------------------------------------------------------------

function side(g: G, ctx: EffectCtx, p: Params): PlayerId {
  const s = p.player ?? p.side ?? 'source';
  if (s === 'opponent') return ctx.sourcePlayer === 0 ? 1 : 0;
  if (s === 'source') return ctx.sourcePlayer;
  return s as PlayerId;
}

function chooseLabels(cards: CardInstance[]): Record<string, string> {
  return Object.fromEntries(cards.map((c) => [c.uid, defOf(c).name]));
}

/** Picks up to `count` cards from a pool: auto when unambiguous, otherwise yields a request. */
function* pickCards(g: G, ctx: EffectCtx, pool: CardInstance[], count: number, optional: boolean, prompt: string): Generator<ChoiceYield, CardInstance[], string[]> {
  if (pool.length === 0) return [];
  if (pool.length <= count && !optional) return [...pool];
  const request: ChoiceYield = {
    kind: 'cards', player: ctx.sourcePlayer, prompt,
    candidates: pool.map((c) => c.uid), min: optional ? 0 : Math.min(1, count), max: count, optional,
    labels: chooseLabels(pool)
  };
  const answer = yield request;
  const chosen = (answer ?? []).map((uid) => pool.find((c) => c.uid === uid)).filter(Boolean) as CardInstance[];
  return chosen.slice(0, count);
}

function computeScaling(g: G, ctx: EffectCtx, host: CardInstance, scalings: ScalingSpec[] | undefined): number {
  if (!scalings) return 0;
  let bonus = 0;
  for (const sc of scalings) {
    let n = 0;
    switch (sc.per) {
      case 'attachedResource': n = host.attached.filter((a) => a.kind === 'RESOURCE').length; break;
      case 'attachedResourceType': n = host.attached.filter((a) => a.kind === 'RESOURCE' && (defOf(a) as any).resourceType === sc.type).length; break;
      case 'selfDamage': n = host.damage; break;
      case 'counter': n = host.counters[sc.counter ?? ''] ?? 0; break;
      case 'discardCount': n = player(g.state, host.owner).discard.length; break;
      case 'benchCount': n = player(g.state, host.owner).bench.length; break;
      case 'turnNumber': n = g.state.turn; break;
      case 'resourcesInPlay': n = charactersInPlay(g.state, 0).concat(charactersInPlay(g.state, 1)).reduce((s, c) => s + c.attached.filter((a) => a.kind === 'RESOURCE').length, 0); break;
    }
    bonus += n * sc.amount;
  }
  void ctx;
  return bonus;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

ops['dealDamage'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'enemyActive') as SelectorId, count: p.count ?? 1, optional: p.optional ?? false, filter: p.filter };
  let targets: CardInstance[];
  const cands = targetCandidates(g.state, ctx, spec);
  if (['allEnemies', 'allAllies', 'allCharacters'].includes(spec.selector) || spec.count === 'all') {
    targets = cands;
  } else {
    if (cands.length === 0) return;
    if (cands.length === 1) targets = cands;
    else targets = yield* pickCards(g, ctx, cands, 1, false, (p.prompt as string) ?? 'Escolha um alvo');
  }
  for (const t of targets) {
    if (!t || t.damage >= maxHp(g.state, t)) continue;
    applyDamage(g, t, p.amount as number, { label: (p.label as string) ?? 'efeito', attackerUid: ctx.hostUid ?? ctx.sourceUid });
  }
};

ops['heal'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'self') as SelectorId, count: p.count ?? 1, filter: p.filter };
  const cands = targetCandidates(g.state, ctx, spec);
  let targets: CardInstance[];
  if (spec.count === 'all' || ['allAllies', 'allEnemies', 'allCharacters'].includes(spec.selector)) targets = cands;
  else {
    if (cands.length === 0) return;
    targets = cands.length === 1 ? cands : yield* pickCards(g, ctx, cands, 1, false, 'Escolha um alvo para curar');
  }
  for (const t of targets) healChar(g, t, p.amount as number);
};

ops['drawCards'] = function* (g, ctx, p) {
  const amount = (p.amount ?? 1) as number;
  const who = side(g, ctx, p);
  drawCards(g, who, amount);
};

ops['searchDeck'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const deck = player(g.state, who).deck;
  const filter = p.filter ?? {};
  const matches = deck.filter((c) => {
    const def = defOf(c);
    if (filter.kinds && !filter.kinds.includes(def.kind)) return false;
    if (filter.families && !(def.kind === 'CHARACTER' && filter.families.includes((def as CharacterDef).family ?? ''))) return false;
    if (filter.factions && !filter.factions.includes(def.faction)) return false;
    if (filter.ids && !filter.ids.includes(def.id)) return false;
    if (filter.tags && !filter.tags.every((t: string) => def.tags.includes(t))) return false;
    if (filter.resourceType && (def as any).resourceType !== filter.resourceType) return false;
    if (filter.stage !== undefined && !(def.kind === 'CHARACTER' && (def as CharacterDef).stage === filter.stage)) return false;
    if (filter.stageMin !== undefined && !(def.kind === 'CHARACTER' && (def as CharacterDef).stage >= filter.stageMin)) return false;
    return true;
  });
  if (matches.length === 0) return;
  const count = Math.min(p.amount ?? 1, matches.length);
  const chosen = yield* pickCards(g, ctx, matches, count, p.optional ?? false, (p.prompt as string) ?? 'Escolha uma carta do baralho');
  for (const c of chosen) {
    const dest = (p.to ?? 'hand') as 'hand' | 'discard' | 'bench';
    if (dest === 'hand') toHand(g, c, who);
    else if (dest === 'discard') toDiscard(g, c, who);
    else toBench(g, c, who);
    if (dest === 'bench' && c.kind === 'CHARACTER') {
      g.state.triggerQueue.push({ event: 'onAllyEnter', sourceUid: c.uid, player: who });
    }
  }
  shuffleDeck(g, who);
};

ops['discardCards'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const amount = (p.amount ?? 1) as number;
  const from = (p.from ?? 'hand') as 'hand' | 'deck';
  const ps = player(g.state, who);
  if (from === 'deck') {
    for (let i = 0; i < amount && ps.deck.length > 0; i++) {
      const c = ps.deck.pop()!;
      ps.discard.push(c);
      g.emit('CARD_DISCARDED', who, { uid: c.uid, from: 'deck' });
    }
    return;
  }
  let pool = [...ps.hand];
  if (p.filter?.kinds) pool = pool.filter((c) => p.filter.kinds.includes(c.kind));
  const chosen = yield* pickCards(g, ctx, pool, amount, p.optional ?? false, (p.prompt as string) ?? 'Descarte cartas da mão');
  for (const c of chosen) toDiscard(g, c, who);
};

ops['returnToHand'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const ps = player(g.state, who);
  const from = (p.from ?? 'discard') as 'discard' | 'bench';
  const pool = from === 'discard' ? [...ps.discard] : [...ps.bench];
  let filtered = pool;
  if (p.filter?.kinds) filtered = filtered.filter((c) => p.filter.kinds.includes(c.kind));
  if (p.filter?.families) filtered = filtered.filter((c) => p.filter.families.includes((defOf(c) as CharacterDef).family ?? ''));
  if (p.filter?.ids) filtered = filtered.filter((c) => p.filter.ids.includes(c.defId));
  if (p.filter?.stage !== undefined) filtered = filtered.filter((c) => c.stageLevel === p.filter.stage);
  if (filtered.length === 0) return;
  const count = Math.min(p.amount ?? 1, filtered.length);
  const chosen = yield* pickCards(g, ctx, filtered, count, p.optional ?? false, 'Escolha cartas para recuperar');
  for (const c of chosen) {
    toHand(g, c, who);
  }
};

ops['moveCard'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const ps = player(g.state, who);
  const from = (p.from ?? 'deck-top') as 'deck-top' | 'discard' | 'hand';
  const to = (p.to ?? 'discard') as 'hand' | 'discard' | 'deck' | 'bench';
  const amount = (p.amount ?? 1) as number;
  let pool: CardInstance[];
  if (from === 'deck-top') pool = ps.deck.slice(-amount);
  else if (from === 'discard') pool = [...ps.discard];
  else pool = [...ps.hand];
  if (p.filter?.kinds) pool = pool.filter((c) => p.filter.kinds.includes(c.kind));
  const chosen = from === 'deck-top' ? pool : yield* pickCards(g, ctx, pool, Math.min(amount, pool.length), p.optional ?? false, 'Mover cartas');
  for (const c of chosen) {
    if (to === 'hand') toHand(g, c, who);
    else if (to === 'deck') toDeckTop(g, c, who);
    else if (to === 'bench') toBench(g, c, who);
    else toDiscard(g, c, who);
  }
};

ops['attachResource'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const ps = player(g.state, who);
  const amount = (p.amount ?? 1) as number;
  const from = (p.from ?? 'hand') as 'hand' | 'discard' | 'deck';
  let pool: CardInstance[];
  if (from === 'hand') pool = ps.hand.filter((c) => c.kind === 'RESOURCE');
  else if (from === 'discard') pool = ps.discard.filter((c) => c.kind === 'RESOURCE');
  else pool = ps.deck.filter((c) => c.kind === 'RESOURCE');
  if (p.resourceType) pool = pool.filter((c) => (defOf(c) as any).resourceType === p.resourceType);
  if (pool.length === 0) return;

  // choose host
  const hostSpec: TargetSpec = { selector: (p.target ?? 'anyAlly') as SelectorId, filter: p.hostFilter };
  let hosts = targetCandidates(g.state, ctx, hostSpec).filter((c) => c.kind === 'CHARACTER');
  if (p.target === 'activeAlly') hosts = hosts.filter((c) => ps.active?.uid === c.uid);
  if (hosts.length === 0) return;
  let host = hosts[0];
  if (hosts.length > 1) {
    const picked = yield* pickCards(g, ctx, hosts, 1, false, 'Escolha o personagem que receberá o recurso');
    if (!picked[0]) return;
    host = picked[0];
  }

  const resources = yield* pickCards(g, ctx, pool, amount, false, 'Escolha os recursos');
  for (const r of resources) {
    attachToChar(g, r, host);
    g.state.triggerQueue.push({ event: 'onResourceAttached', sourceUid: host.uid, player: who, payload: { resourceUid: r.uid } });
    g.state.triggerQueue.push({ event: '__runOnAttach', sourceUid: r.uid, hostUid: host.uid, player: who });
    if (from === 'deck') shuffleDeck(g, who);
  }
};

ops['detachResource'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'enemyActive') as SelectorId, filter: p.filter };
  const cands = targetCandidates(g.state, ctx, spec);
  if (cands.length === 0) return;
  const targets = cands.length === 1 ? cands : yield* pickCards(g, ctx, cands, 1, false, 'Escolha o personagem');
  const amount = (p.amount ?? 1) as number;
  const to = (p.to ?? 'discard') as 'discard' | 'hand';
  for (const t of targets) {
    let pool = t.attached.filter((a) => a.kind === 'RESOURCE');
    if (p.resourceType) pool = pool.filter((a) => (defOf(a) as any).resourceType === p.resourceType);
    for (let i = 0; i < amount && pool.length > 0; i++) {
      detachFromChar(g, pool.shift()!, to);
    }
  }
};

ops['detachEquipment'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'enemyActive') as SelectorId, filter: p.filter };
  const cands = targetCandidates(g.state, ctx, spec);
  if (cands.length === 0) return;
  const targets = cands.length === 1 ? cands : yield* pickCards(g, ctx, cands, 1, false, 'Escolha o personagem');
  const amount = (p.amount ?? 1) as number;
  for (const t of targets) {
    const pool = t.attached.filter((a) => a.kind === 'EQUIPMENT');
    for (let i = 0; i < amount && pool.length > 0; i++) {
      detachFromChar(g, pool.shift()!, 'discard');
    }
  }
};

ops['transferResource'] = function* (g, ctx, p) {
  const fromSpec: TargetSpec = { selector: (p.from ?? 'activeAlly') as SelectorId, filter: p.filter };
  const fromCands = targetCandidates(g.state, ctx, fromSpec);
  if (fromCands.length === 0) return;
  const from = fromCands[0];
  let pool = from.attached.filter((a) => a.kind === 'RESOURCE');
  if (p.resourceType) pool = pool.filter((a) => (defOf(a) as any).resourceType === p.resourceType);
  if (pool.length === 0) return;

  const toSpec: TargetSpec = { selector: (p.toTarget ?? 'benchAlly') as SelectorId, filter: p.toFilter };
  const toCands = targetCandidates(g.state, ctx, toSpec).filter((c) => c.uid !== from.uid);
  if (toCands.length === 0) return;
  let dest = toCands[0];
  if (toCands.length > 1) {
    const picked = yield* pickCards(g, ctx, toCands, 1, false, 'Escolha o destino do recurso');
    if (!picked[0]) return;
    dest = picked[0];
  }
  const amount = (p.amount ?? 1) as number;
  for (let i = 0; i < amount && pool.length > 0; i++) {
    const r = pool.shift()!;
    detachFromChar(g, r, 'hand');
    attachToChar(g, r, dest);
  }
};

ops['applyStatus'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'enemyActive') as SelectorId, count: p.count ?? 1, filter: p.filter, optional: p.optional ?? false };
  let targets: CardInstance[];
  const cands = targetCandidates(g.state, ctx, spec);
  if (['allEnemies', 'allAllies', 'allCharacters'].includes(spec.selector) || spec.count === 'all') targets = cands;
  else {
    if (cands.length === 0) return;
    targets = cands.length === 1 ? cands : yield* pickCards(g, ctx, cands, 1, false, 'Escolha o alvo do status');
  }
  for (const t of targets) {
    applyStatusToChar(g, t, p.status as string, (p.tokens ?? 2) as number, (p.stacks ?? 1) as number);
  }
};

ops['removeStatus'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'self') as SelectorId, count: p.count === 'all' ? 'all' : (p.count ?? 1), filter: p.filter };
  const cands = targetCandidates(g.state, ctx, spec);
  let targets: CardInstance[];
  if (spec.count === 'all' || ['allAllies', 'allEnemies', 'allCharacters'].includes(spec.selector)) targets = cands;
  else {
    if (cands.length === 0) return;
    targets = cands.length === 1 ? cands : yield* pickCards(g, ctx, cands, 1, false, 'Escolha o alvo');
  }
  for (const t of targets) {
    if (p.status === 'all') [...t.statuses].forEach((s) => removeStatusFromChar(g, t, s.id));
    else removeStatusFromChar(g, t, p.status as string);
  }
};

ops['tempMod'] = function* (g, ctx, p) {
  const spec: TargetSpec | null = p.target ? { selector: p.target as SelectorId, count: 1 } : null;
  let target: CardInstance | undefined;
  if (spec) {
    const cands = targetCandidates(g.state, ctx, spec);
    target = cands.length === 1 ? cands[0] : (yield* pickCards(g, ctx, cands, 1, false, 'Escolha o alvo'))[0];
  }
  g.state.nextUid++;
  g.state.tempMods.push({
    id: `tm${g.state.nextUid}`,
    sourceUid: ctx.sourceUid,
    owner: ctx.sourcePlayer,
    mods: (p.mods ?? {}) as any,
    scope: (p.scope ?? 'nextAttack') as any,
    targetUid: target?.uid,
    label: p.label as string | undefined
  });
};

ops['increaseDamage'] = function* (g, ctx, p) {
  yield* ops['tempMod'](g, ctx, { ...p, mods: { damageDealtFlat: p.amount ?? 0 } });
};

ops['reduceDamage'] = function* (g, ctx, p) {
  yield* ops['tempMod'](g, ctx, { ...p, mods: { damageTakenFlat: -(p.amount ?? 0) } });
};

ops['modifyCost'] = function* (g, ctx, p) {
  const mods = (p.kind === 'retreat') ? { retreatCostMod: p.amount ?? 0 } : { attackCostReduce: p.amount ?? 0 };
  yield* ops['tempMod'](g, ctx, { ...p, mods, scope: p.scope ?? 'thisTurn' });
};

ops['createTemporaryEffect'] = function* (g, ctx, p) {
  yield* ops['tempMod'](g, ctx, { ...p, scope: p.scope ?? 'permanent' });
};

ops['disableAbility'] = function* (g, ctx, p) {
  yield* ops['tempMod'](g, ctx, { ...p, mods: { abilitiesDisabled: true } as any, scope: p.scope ?? 'nextTurn' });
};

ops['modifyStat'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'self') as SelectorId, count: 1 };
  const cands = targetCandidates(g.state, ctx, spec);
  if (cands.length === 0) return;
  const t = cands.length === 1 ? cands[0] : (yield* pickCards(g, ctx, cands, 1, false, 'Escolha o alvo'))[0];
  if (!t) return;
  t.counters['hpBonus'] = (t.counters['hpBonus'] ?? 0) + ((p.amount ?? 0) as number);
};

ops['switchActive'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const ps = player(g.state, who);
  if (!ps.active || ps.bench.length === 0) return;
  if (g.state.fieldOverrides.some((o) => o.blockSwitching)) return;
  const chosen = yield* pickCards(g, ctx, [...ps.bench], 1, false, 'Escolha o novo personagem ativo');
  const pick = chosen[0];
  if (pick) retreatActive(g, pick);
};

ops['forceEnemySwitch'] = function* (g, ctx, p) {
  yield* ops['switchActive'](g, ctx, { ...p, player: 'opponent' });
};

ops['deployCharacter'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const ps = player(g.state, who);
  const cfg = g.state.config;
  if (ps.bench.length >= cfg.board.benchSize) return;
  // Explicit effect: allowed to deploy higher stages (the one sanctioned bypass).
  let pool = ps.hand.filter((c) => c.kind === 'CHARACTER');
  if (p.filter?.families) pool = pool.filter((c) => p.filter.families.includes((defOf(c) as CharacterDef).family ?? ''));
  if (p.filter?.factions) pool = pool.filter((c) => p.filter.factions.includes(defOf(c).faction));
  if (p.filter?.maxHp !== undefined) pool = pool.filter((c) => (defOf(c) as CharacterDef).maxHp <= p.filter.maxHp);
  if (pool.length === 0) return;
  const chosen = yield* pickCards(g, ctx, pool, 1, p.optional ?? false, (p.prompt as string) ?? 'Escolha um personagem para colocar em jogo');
  const c = chosen[0];
  if (!c) return;
  toBench(g, c, who);
  g.emit('CHARACTER_DEPLOYED', who, { uid: c.uid, defId: c.defId });
  g.state.triggerQueue.push({ event: 'onPlay', sourceUid: c.uid, player: who });
  g.state.triggerQueue.push({ event: 'onAllyEnter', sourceUid: c.uid, player: who });
};

ops['retrieveFromDiscard'] = function* (g, ctx, p) {
  yield* ops['returnToHand'](g, ctx, { ...p, from: 'discard' });
};

ops['shuffleIntoDeck'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const ps = player(g.state, who);
  const from = (p.from ?? 'hand') as 'hand' | 'discard' | 'all';
  const zones: CardInstance[] = [];
  if (from === 'hand' || from === 'all') zones.push(...ps.hand);
  if (from === 'discard' || from === 'all') zones.push(...ps.discard);
  let pool = zones;
  if (p.filter?.kinds) pool = pool.filter((c) => p.filter.kinds.includes(c.kind));
  for (const c of pool) toDeckTop(g, c, who);
  shuffleDeck(g, who);
};

ops['copyAttack'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'enemyActive') as SelectorId, count: 1 };
  const cands = targetCandidates(g.state, ctx, spec);
  if (cands.length === 0) return;
  const t = cands[0];
  ctx.bound['__copyAttackFrom'] = t.uid;
};

ops['coinFlip'] = function* (g, ctx, p) {
  const chance = (p.chance ?? 0.5) as number;
  const success = rand(g.state) < chance;
  g.emit('COIN_FLIPPED', ctx.sourcePlayer, { chance, success, label: p.label ?? '' });
  if (success) yield* runSteps(g, ctx, p.then as EffectStep[]);
  else if (p.else) yield* runSteps(g, ctx, p.else as EffectStep[]);
};

ops['chooseTarget'] = function* (g, ctx, p) {
  const spec: TargetSpec = {
    selector: (p.selector ?? 'anyEnemy') as SelectorId,
    count: (p.count ?? 1) as any,
    optional: (p.optional ?? false) as boolean,
    filter: p.filter
  };
  const cands = targetCandidates(g.state, ctx, spec);
  if (cands.length === 0) return;
  const count = spec.count === 'all' ? cands.length : Math.min(spec.count as number, cands.length);
  const chosen = yield* pickCards(g, ctx, cands, count, spec.optional ?? false, (p.prompt as string) ?? 'Escolha um alvo');
  if (chosen[0]) ctx.bound['lastTarget'] = chosen[0].uid;
};

ops['randomTarget'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.selector ?? 'anyEnemy') as SelectorId, filter: p.filter };
  const cands = targetCandidates(g.state, ctx, spec);
  if (cands.length === 0) return;
  const pick = cands[randInt(g.state, cands.length)];
  ctx.bound['lastTarget'] = pick.uid;
};

ops['conditionalEffect'] = function* (g, ctx, p) {
  const cond = p.condition as any;
  if (evalCondition(g.state, ctx, cond)) yield* runSteps(g, ctx, p.then as EffectStep[]);
  else if (p.else) yield* runSteps(g, ctx, p.else as EffectStep[]);
};

ops['repeatEffect'] = function* (g, ctx, p) {
  let times = 1;
  if (p.times !== undefined) times = p.times as number;
  else if (p.timesScaling) times = Math.max(0, computeScaling(g, ctx, resolveChar(g.state, ctx, 'self')!, p.timesScaling as ScalingSpec[]));
  for (let i = 0; i < times; i++) yield* runSteps(g, ctx, p.steps as EffectStep[]);
};

ops['reviveCharacter'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const ps = player(g.state, who);
  let pool = ps.discard.filter((c) => c.kind === 'CHARACTER');
  if (p.filter?.families) pool = pool.filter((c) => p.filter.families.includes((defOf(c) as CharacterDef).family ?? ''));
  if (pool.length === 0) return;
  const chosen = yield* pickCards(g, ctx, pool, 1, p.optional ?? false, 'Escolha um personagem para reviver');
  const c = chosen[0];
  if (!c) return;
  const hp = (p.hp ?? 30) as number;
  const dest = (p.position ?? 'bench') as 'bench' | 'active';
  toBench(g, c, who);
  c.damage = Math.max(0, maxHp(g.state, c) - hp);
  if (dest === 'active' && !ps.active) promoteToActive(g, c);
};

ops['upgradeCharacter'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'self') as SelectorId, count: 1 };
  const cands = targetCandidates(g.state, ctx, spec).filter((c) => c.kind === 'CHARACTER');
  if (cands.length === 0) return;
  const t = cands.length === 1 ? cands[0] : (yield* pickCards(g, ctx, cands, 1, false, 'Escolha quem evolui'))[0];
  if (!t) return;
  const cd = charDef(t);
  let toDefId = p.to as string | undefined;
  if (!toDefId) {
    const options = (cd.upgradesTo ?? []).map((id) => registry.tryCard(id)).filter(Boolean) as CharacterDef[];
    if (options.length === 0) return;
    toDefId = options[0].id;
  }
  try {
    // Effect-driven transformation: no real hand card is consumed, so the new
    // stack entry is an explicit generated token (tracked separately from
    // real cards by the conservation census).
    performGeneratedUpgrade(g, t, toDefId, { bonusHp: p.bonusHp as number | undefined, cause: 'effect' });
  } catch { /* invalid upgrade — no-op */ }
};

ops['modifyVictoryPoints'] = function* (g, ctx, p) {
  const who = side(g, ctx, p);
  const amount = (p.amount ?? 0) as number;
  const ps = player(g.state, who);
  ps.victoryPoints = Math.max(0, ps.victoryPoints + amount);
  g.emit('VICTORY_POINTS_CHANGED', who, { amount, total: ps.victoryPoints, cause: 'effect' });
};

ops['addCounter'] = function* (g, ctx, p) {
  const spec: TargetSpec = { selector: (p.target ?? 'self') as SelectorId, count: 1 };
  const cands = targetCandidates(g.state, ctx, spec);
  if (cands.length === 0) return;
  const t = cands[0];
  const amount = (p.amount ?? 1) as number;
  t.counters[p.counter as string] = (t.counters[p.counter as string] ?? 0) + amount;
  g.emit('COUNTER_ADDED', t.owner, { uid: t.uid, counter: p.counter, amount: t.counters[p.counter as string] });
};

ops['shuffleDeck'] = function* (g, ctx, p) {
  shuffleDeck(g, side(g, ctx, p));
};

ops['mill'] = function* (g, ctx, p) {
  yield* ops['discardCards'](g, ctx, { ...p, from: 'deck', amount: p.amount ?? 1 });
};

ops['chooseOption'] = function* (g, ctx, p) {
  const options = (p.options ?? []) as { id: string; label: string }[];
  if (options.length === 0) return;
  const answer = yield {
    kind: 'option', player: ctx.sourcePlayer, prompt: (p.prompt as string) ?? 'Escolha uma opção',
    candidates: options.map((o) => o.id), min: 1, max: 1, optional: false,
    labels: Object.fromEntries(options.map((o) => [o.id, o.label]))
  };
  const pick = answer?.[0] ?? options[0].id;
  const branch = (p.branches as Record<string, EffectStep[]>)?.[pick];
  if (branch) yield* runSteps(g, ctx, branch);
};

// attack-internal helper ops ------------------------------------------------

/** Computes the attack damage for the bound attacker→defender pair. */
export function scalingDamageFor(g: G, attacker: CardInstance, attack: { damage?: number; scaling?: ScalingSpec[] }, base?: number): number {
  const raw = base ?? attack.damage ?? 0;
  return raw + computeScaling(g, { sourceUid: attacker.uid, sourcePlayer: attacker.owner, bound: {}, depth: 0 }, attacker, attack.scaling);
}

export function resolveAttackTargetGen(g: G, ctx: EffectCtx, attack: { target?: TargetSpec }): Generator<ChoiceYield, CardInstance | null, string[]> {
  const spec: TargetSpec = attack.target ?? { selector: 'enemyActive' };
  const cands = targetCandidates(g.state, ctx, spec).filter((c) => c.kind === 'CHARACTER');
  const fixed = (v: CardInstance | null) => (function* () { return v; })();
  if (cands.length === 0) return fixed(null);
  if (spec.selector === 'enemyActive' || spec.selector === 'activeAlly') return fixed(cands[0]);
  if (cands.length === 1) return fixed(cands[0]);
  return pickCards(g, ctx, cands, 1, spec.optional ?? false, 'Escolha o alvo do ataque') as any;
}

export function attackDamageTotal(g: G, attacker: CardInstance, defender: CardInstance, attack: { damage?: number; scaling?: ScalingSpec[]; affinity?: string }, opts: { isAttack: boolean }): { total: number; notes: string[] } {
  const base = scalingDamageFor(g, attacker, attack);
  return computeAttackDamage(g, attacker, defender, base, {
    isAttack: opts.isAttack,
    affinity: attack.affinity,
    ignoreWeakness: (attack as any).ignoreWeakness,
    ignoreResistance: (attack as any).ignoreResistance
  });
}

export function payAttackCost(g: G, attacker: CardInstance, cost: Parameters<typeof matchCost>[1], costReduce: number): boolean {
  const used = matchCost(attacker, cost, costReduce);
  if (!used) return false;
  // Temporary resources are consumed when paying
  for (const u of used) {
    const rd = defOf(u.inst) as any;
    if (rd.temporary) detachFromChar(g, u.inst, 'discard');
  }
  return true;
}

export function canPayAttackCost(attacker: CardInstance, cost: Parameters<typeof matchCost>[1], costReduce = 0): boolean {
  return costSatisfied(attacker, cost, costReduce);
}

void victoryValueOf;
void findCard;
void opponentOf;
