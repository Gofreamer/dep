import type { CardInstance, CharacterDef, LegalActions, MatchState, PlayerId } from './types';
import {
  abilitiesBlocked, cannotRetreat, charDef, charactersInPlay, costSatisfied, defOf, equipmentSlots, findCard,
  grantedAttacks, player, retreatCostOf
} from './queries';
import { registry } from './registry';
import { evalCondition } from './effects/core';

/** Checks whether card `to` can upgrade character instance `host` (pure check). */
export function canUpgradeTo(state: MatchState, host: CardInstance, to: CardInstance): boolean {
  const fromDef = charDef(host);
  const toDef = defOf(to);
  if (toDef.kind !== 'CHARACTER') return false;
  const td = toDef as CharacterDef;
  const cfg = state.config.progression;
  const sameFamily = td.family !== undefined && td.family === fromDef.family;
  const explicitPath = (fromDef.upgradesTo ?? []).includes(td.id);
  if (!sameFamily && !explicitPath) return false;
  const gap = td.stage - fromDef.stage;
  if (gap < 1) return false;
  if (gap > 1 && !cfg.canSkipStages && !explicitPath) return false;
  return true;
}

function attachLimit(state: MatchState, pIdx: PlayerId): number {
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

function actionRestrictionOk(state: MatchState, pIdx: PlayerId, def: any): boolean {
  const p = player(state, pIdx);
  const opp = player(state, pIdx === 0 ? 1 : 0);
  for (const r of def.restrictions ?? []) {
    switch (r.type) {
      case 'oncePerTurn': if (p.actionsPlayedTurn.includes(def.id)) return false; break;
      case 'whileLosing': if (p.victoryPoints >= opp.victoryPoints) return false; break;
      case 'factionInPlay': if (!charactersInPlay(state, pIdx).some((c) => charDef(c).faction === r.faction)) return false; break;
      case 'turnAtLeast': if (state.turn < (r.turn ?? 1)) return false; break;
      case 'characterCondition':
        if (!charactersInPlay(state, pIdx).some((c) => {
          // simple structural check without full condition eval
          void c;
          return true;
        })) return false;
        break;
    }
  }
  return true;
}

/** Computes every legal action for a player — the UI renders from this and never decides legality itself. */
export function computeLegalActions(state: MatchState, pIdx: PlayerId, version: number): LegalActions {
  const p = player(state, pIdx);
  const opp = player(state, pIdx === 0 ? 1 : 0);
  const out: LegalActions = {
    version,
    hand: {},
    deployable: [],
    upgradable: [],
    attacks: [],
    abilities: [],
    canRetreat: false,
    retreatTargets: [],
    playableActions: [],
    playableEquipment: [],
    playableFields: [],
    setupActive: [],
    setupBench: [],
    setupDone: false
  };

  if (state.phase === 'gameOver') return out;

  if (state.phase === 'setup') {
    for (const c of p.hand) {
      if (c.kind === 'CHARACTER' && charDef(c).stage === 0) {
        out.setupActive.push(c.uid);
        if (p.bench.length < state.config.board.benchSize) out.setupBench.push(c.uid);
      }
    }
    out.setupDone = !!p.active;
    return out;
  }

  const myTurn = state.activePlayer === pIdx && state.phase === 'main';

  if (!myTurn) return out;

  const myChars = charactersInPlay(state, pIdx);
  const attachOk = p.attachedThisTurn < attachLimit(state, pIdx);

  for (const card of p.hand) {
    const entry = { playable: false, reason: undefined as string | undefined, targetMode: 'none' as 'none' | 'ally' | 'enemy' | 'any' };
    switch (card.kind) {
      case 'CHARACTER': {
        if (p.bench.length < state.config.board.benchSize) {
          entry.playable = true;
          out.deployable.push(card.uid);
        } else entry.reason = 'bench_full';
        break;
      }
      case 'RESOURCE': {
        if (!attachOk) { entry.reason = 'attach_limit'; break; }
        if (myChars.length === 0) { entry.reason = 'no_valid_target'; break; }
        entry.playable = true;
        entry.targetMode = 'ally';
        break;
      }
      case 'ACTION': {
        if (actionRestrictionOk(state, pIdx, defOf(card))) {
          entry.playable = true;
          entry.targetMode = 'any';
          out.playableActions.push(card.uid);
        } else entry.reason = 'restriction';
        break;
      }
      case 'EQUIPMENT': {
        const targets = myChars.filter((c) => c.attached.filter((a) => a.kind === 'EQUIPMENT').length < equipmentSlots(state, c));
        if (targets.length > 0) {
          entry.playable = true;
          entry.targetMode = 'ally';
          out.playableEquipment.push({ uid: card.uid, targets: targets.map((t) => t.uid) });
        } else entry.reason = 'no_slots';
        break;
      }
      case 'FIELD': {
        entry.playable = true;
        out.playableFields.push(card.uid);
        break;
      }
    }
    out.hand[card.uid] = entry;
  }

  // Upgrades: hand character cards onto own characters
  for (const card of p.hand) {
    if (card.kind !== 'CHARACTER') continue;
    for (const c of myChars) {
      if (canUpgradeTo(state, c, card)) out.upgradable.push({ from: c.uid, to: card.uid });
    }
  }

  // Attacks from the active character
  const active = p.active;
  if (active) {
    const atkCheck = engineCanAttack(state, active);
    for (const atk of grantedAttacks(state, active)) {
      if (!atkCheck.ok) {
        out.attacks.push({ attackId: atk.id, playable: false, reason: atkCheck.reason });
        continue;
      }
      const reduce = attackCostReduce(state, active);
      if (!costSatisfied(active, atk.cost, reduce)) {
        out.attacks.push({ attackId: atk.id, playable: false, reason: 'not_enough_resources' });
        continue;
      }
      out.attacks.push({ attackId: atk.id, playable: true });
    }

    // Retreat
    const retreatBlocked = cannotRetreat(state, active) || state.fieldOverrides.some((o) => o.blockSwitching || o.blockRetreat);
    const enough = active.attached.filter((a) => a.kind === 'RESOURCE').length >= retreatCostOf(state, active);
    out.canRetreat = p.retreatedThisTurn < state.config.turn.retreatsPerTurn && !retreatBlocked && p.bench.length > 0;
    out.retreatTargets = out.canRetreat && enough ? p.bench.map((c) => c.uid) : [];
  }

  // Activated abilities
  for (const c of myChars) {
    if (abilitiesBlocked(state, c)) continue;
    for (const ab of charDef(c).abilities) {
      if (ab.trigger !== 'activated') continue;
      const isActive = p.active?.uid === c.uid;
      if (ab.zone === 'active' && !isActive) { out.abilities.push({ charUid: c.uid, abilityId: ab.id, playable: false, reason: 'ability_zone' }); continue; }
      if (ab.zone === 'bench' && isActive) { out.abilities.push({ charUid: c.uid, abilityId: ab.id, playable: false, reason: 'ability_zone' }); continue; }
      if (ab.oncePerTurn && c.usedTurn.includes(`ability:${ab.id}`)) { out.abilities.push({ charUid: c.uid, abilityId: ab.id, playable: false, reason: 'already_used_turn' }); continue; }
      if (ab.oncePerMatch && c.usedMatch.includes(`ability:${ab.id}`)) { out.abilities.push({ charUid: c.uid, abilityId: ab.id, playable: false, reason: 'already_used_match' }); continue; }
      if (ab.cost && ab.cost.some((x) => x.amount > 0) && !costSatisfied(c, ab.cost, Math.max(0, attackCostReduce(state, c)))) {
        out.abilities.push({ charUid: c.uid, abilityId: ab.id, playable: false, reason: 'not_enough_resources' });
        continue;
      }
      out.abilities.push({ charUid: c.uid, abilityId: ab.id, playable: true });
    }
  }

  return out;
}

function attackCostReduce(state: MatchState, inst: CardInstance): number {
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

function engineCanAttack(state: MatchState, inst: CardInstance): { ok: boolean; reason?: string } {
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
  return { ok: true };
}

void findCard;
