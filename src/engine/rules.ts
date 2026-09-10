/**
 * Shared rule predicates — THE single source of truth for gameplay legality.
 *
 * `engine.dispatch` and `computeLegalActions` MUST both go through these
 * functions so the UI never offers an action the engine would reject (and
 * never hides one it would accept). No duplicated implementations.
 */

import type { CardInstance, CharacterDef, MatchState, PlayerId } from './types';
import { registry } from './registry';
import {
  abilitiesBlocked, cannotRetreat, charDef, charactersInPlay, costSatisfied, defOf, equipmentSlots,
  grantedAttacks, player, retreatCostOf
} from './queries';
import { evalCondition } from './effects/core';

export type RuleCheck = { ok: boolean; reason?: string };

const OK: RuleCheck = { ok: true };

// ---------------------------------------------------------------------------
// Deployment (hand → bench) — only Base/stage-0 characters may be deployed
// directly. Higher stages REQUIRE an Upgrade; only explicit rules/effects can
// bypass (effect-driven deployCharacter op validates separately).
// ---------------------------------------------------------------------------

export function isDirectlyDeployable(card: CardInstance): boolean {
  if (card.kind !== 'CHARACTER') return false;
  if (card.progression && card.progression.length > 0) return false; // stacked card re-entering play
  return charDef(card).stage === 0;
}

export function canDeployCharacter(state: MatchState, pIdx: PlayerId, card: CardInstance): RuleCheck {
  const p = player(state, pIdx);
  if (card.kind !== 'CHARACTER') return { ok: false, reason: 'not_a_character' };
  if (!isDirectlyDeployable(card)) return { ok: false, reason: 'must_upgrade_not_deploy' };
  if (p.bench.length >= state.config.board.benchSize) return { ok: false, reason: 'bench_full' };
  return OK;
}

/** Setup seats (active/bench) follow the same Base-only rule. */
export function canSeatAtSetup(state: MatchState, pIdx: PlayerId, card: CardInstance): RuleCheck {
  if (state.phase !== 'setup') return { ok: false, reason: 'not_setup' };
  if (!isDirectlyDeployable(card)) return { ok: false, reason: 'must_start_with_base' };
  if (state.config.setup.benchAtSetup === false) return { ok: false, reason: 'setup_bench_disabled' };
  const p = player(state, pIdx);
  if (p.bench.length >= state.config.board.benchSize) return { ok: false, reason: 'bench_full' };
  return OK;
}

// ---------------------------------------------------------------------------
// Upgrade — shared validation between engine command and legalActions.
// ---------------------------------------------------------------------------

export function canUpgradeTo(state: MatchState, host: CardInstance, upgradeCard: CardInstance): RuleCheck {
  if (upgradeCard.kind !== 'CHARACTER') return { ok: false, reason: 'not_a_character' };
  const fromDef = charDef(host);
  const toDef = defOf(upgradeCard) as CharacterDef;
  const cfg = state.config.progression;
  const sameFamily = toDef.family !== undefined && toDef.family === fromDef.family;
  const explicitPath = (fromDef.upgradesTo ?? []).includes(toDef.id);
  if (!sameFamily && !explicitPath) return { ok: false, reason: 'invalid_upgrade' };
  const gap = toDef.stage - fromDef.stage;
  if (gap < 1) return { ok: false, reason: 'invalid_upgrade' };
  if (gap > 1 && !cfg.canSkipStages && !explicitPath) return { ok: false, reason: 'cannot_skip_stages' };
  return OK;
}

// ---------------------------------------------------------------------------
// Attach limit & cost reduction (previously duplicated in engine/validation)
// ---------------------------------------------------------------------------

export function attachLimit(state: MatchState, pIdx: PlayerId): number {
  let limit = state.config.turn.attachPerTurn;
  for (const f of state.fields) {
    const fd = defOf(f) as any;
    if (fd.scope === 'owner' && f.owner !== pIdx) continue;
    limit += fd.mods?.attachExtra ?? 0;
  }
  for (const ov of state.fieldOverrides) limit += ov.attachExtra ?? 0;
  for (const tm of state.tempMods) {
    if (!tm.targetUid && tm.owner === pIdx) limit += tm.mods.attachExtra ?? 0;
  }
  return limit;
}

export function attackCostReduce(state: MatchState, inst: CardInstance): number {
  let reduce = 0;
  for (const eq of inst.attached) {
    if (eq.kind === 'EQUIPMENT') reduce += (defOf(eq) as any).mods?.attackCostReduce ?? 0;
  }
  for (const f of state.fields) {
    const fd = defOf(f) as any;
    if (fd.scope === 'owner' && f.owner !== inst.owner) continue;
    reduce += fd.mods?.attackCostReduce ?? 0;
  }
  for (const tm of state.tempMods) {
    if (tm.targetUid === inst.uid) reduce += tm.mods.attackCostReduce ?? 0;
  }
  for (const ov of state.fieldOverrides) reduce += ov.attackCostMod ?? 0;
  return reduce;
}

// ---------------------------------------------------------------------------
// Attack eligibility (was duplicated: engine.canAttackNow + validation copy)
// ---------------------------------------------------------------------------

export function canAttack(state: MatchState, inst: CardInstance): RuleCheck {
  const st = state;
  if (st.phase !== 'main' || st.activePlayer !== inst.owner) return { ok: false, reason: 'not_your_turn' };
  if (st.players[inst.owner].active?.uid !== inst.uid) return { ok: false, reason: 'not_active' };
  for (const s of inst.statuses) {
    const sd = registry.status(s.id);
    if (sd?.blocksAttack) return { ok: false, reason: 'status_blocks_attack' };
  }
  for (const eq of inst.attached) {
    if (eq.kind === 'EQUIPMENT' && (defOf(eq) as any).mods?.cannotAttack) return { ok: false, reason: 'cannot_attack' };
  }
  for (const tm of st.tempMods) {
    if (tm.targetUid === inst.uid && tm.mods.cannotAttack) return { ok: false, reason: 'cannot_attack' };
  }
  if (inst.deployedOnTurn === st.turn) return { ok: false, reason: 'just_deployed' };
  if (st.turn === 1 && st.activePlayer === st.startingPlayer && st.config.turn.startingPlayerSkipsAttack) {
    return { ok: false, reason: 'first_turn_no_attack' };
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Retreat
// ---------------------------------------------------------------------------

export function retreatCheck(state: MatchState, pIdx: PlayerId): RuleCheck {
  const p = player(state, pIdx);
  if (!p.active) return { ok: false, reason: 'no_active' };
  if (p.retreatedThisTurn >= state.config.turn.retreatsPerTurn) return { ok: false, reason: 'retreat_limit' };
  if (cannotRetreat(state, p.active)) return { ok: false, reason: 'cannot_retreat' };
  if (state.fieldOverrides.some((o) => o.blockSwitching || o.blockRetreat)) return { ok: false, reason: 'switching_blocked' };
  return OK;
}

export function canPayRetreat(state: MatchState, pIdx: PlayerId): boolean {
  const p = player(state, pIdx);
  if (!p.active) return false;
  return p.active.attached.filter((a) => a.kind === 'RESOURCE').length >= retreatCostOf(state, p.active);
}

// ---------------------------------------------------------------------------
// Action-card restrictions — the REAL logic, shared by dispatch & legalActions.
// `characterCondition` evaluates the actual ConditionSpec on every in-play
// character of the player (same evalCondition used by effects).
// ---------------------------------------------------------------------------

export function checkRestrictions(state: MatchState, pIdx: PlayerId, def: { id: string; restrictions?: any[] }): RuleCheck {
  const p = player(state, pIdx);
  const opp = player(state, pIdx === 0 ? 1 : 0);
  for (const r of def.restrictions ?? []) {
    switch (r.type) {
      case 'oncePerTurn':
        if (p.actionsPlayedTurn.includes(def.id)) return { ok: false, reason: 'restriction_once_per_turn' };
        break;
      case 'whileLosing':
        if (p.victoryPoints >= opp.victoryPoints) return { ok: false, reason: 'restriction_losing' };
        break;
      case 'factionInPlay': {
        const mine = charactersInPlay(state, pIdx).some((c) => charDef(c).faction === r.faction);
        if (!mine) return { ok: false, reason: 'restriction_faction' };
        break;
      }
      case 'turnAtLeast':
        if (state.turn < (r.turn ?? 1)) return { ok: false, reason: 'restriction_turn' };
        break;
      case 'characterCondition': {
        const anyOk = charactersInPlay(state, pIdx).some((c) =>
          evalCondition(state, { sourceUid: c.uid, sourcePlayer: pIdx, bound: {}, depth: 0 }, r.condition));
        if (!anyOk) return { ok: false, reason: 'restriction_condition' };
        break;
      }
    }
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Equipment targets & activated abilities & ultimates
// ---------------------------------------------------------------------------

export function equipmentTargets(state: MatchState, pIdx: PlayerId): CardInstance[] {
  return charactersInPlay(state, pIdx).filter(
    (c) => c.attached.filter((a) => a.kind === 'EQUIPMENT').length < equipmentSlots(state, c)
  );
}

export function abilityCheck(state: MatchState, pIdx: PlayerId, inst: CardInstance, ability: any): RuleCheck {
  const p = player(state, pIdx);
  const isActive = p.active?.uid === inst.uid;
  if (ability.zone === 'active' && !isActive) return { ok: false, reason: 'ability_zone' };
  if (ability.zone === 'bench' && isActive) return { ok: false, reason: 'ability_zone' };
  if (abilitiesBlocked(state, inst)) return { ok: false, reason: 'abilities_blocked' };
  if (ability.oncePerTurn && inst.usedTurn.includes(`ability:${ability.id}`)) return { ok: false, reason: 'already_used_turn' };
  if (ability.oncePerMatch && inst.usedMatch.includes(`ability:${ability.id}`)) return { ok: false, reason: 'already_used_match' };
  if (ability.cost && ability.cost.some((x: any) => x.amount > 0) && !costSatisfied(inst, ability.cost, Math.max(0, attackCostReduce(state, inst)))) {
    return { ok: false, reason: 'not_enough_resources' };
  }
  if (ability.condition && !evalCondition(state, { sourceUid: inst.uid, sourcePlayer: pIdx, bound: {}, depth: 0 }, ability.condition)) {
    return { ok: false, reason: 'condition_not_met' };
  }
  return OK;
}

export function ultimateCheck(state: MatchState, pIdx: PlayerId, inst: CardInstance, ult: any): RuleCheck {
  if (inst.usedMatch.includes(`ultimate:${ult.id}`)) return { ok: false, reason: 'already_used_match' };
  if (ult.cost && ult.cost.some((x: any) => x.amount > 0) && !costSatisfied(inst, ult.cost, Math.max(0, attackCostReduce(state, inst)))) {
    return { ok: false, reason: 'not_enough_resources' };
  }
  if (ult.activationCondition && !evalCondition(state, { sourceUid: inst.uid, sourcePlayer: pIdx, bound: {}, depth: 0 }, ult.activationCondition)) {
    return { ok: false, reason: 'condition_not_met' };
  }
  return OK;
}
