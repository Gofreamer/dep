/**
 * legalActions — computed EXCLUSIVELY from the shared predicates in
 * `rules.ts` (the same ones dispatch validates with). The UI renders from
 * this snapshot and never decides legality itself.
 */

import type { CardInstance, LegalActions, MatchState, PlayerId } from './types';
import { charDef, charactersInPlay, defOf, grantedAttacks, player } from './queries';
import {
  abilityCheck, attachLimit, canAttack, canDeployCharacter, canPayRetreat, canSeatAtSetup,
  canUpgradeTo, checkRestrictions, equipmentTargets, retreatCheck, effectiveAttackCostReduce, ultimateCheck
} from './rules';
import { costSatisfied } from './queries';

export function computeLegalActions(state: MatchState, pIdx: PlayerId, version: number): LegalActions {
  const p = player(state, pIdx);
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
    setupDone: false,
    ultimates: [],
    mulliganChoice: null
  };

  if (state.phase === 'gameOver') return out;

  if (state.phase === 'setup') {
    for (const c of p.hand) {
      const seat = canSeatAtSetup(state, pIdx, c);
      if (seat.ok) {
        out.setupActive.push(c.uid);
        out.setupBench.push(c.uid);
      }
    }
    out.setupDone = !!p.active || !state.config.setup.requireBasic;
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
        const dep = canDeployCharacter(state, pIdx, card);
        if (dep.ok) {
          entry.playable = true;
          entry.targetMode = 'none';
          out.deployable.push(card.uid);
        } else {
          entry.reason = dep.reason;
        }
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
        const r = checkRestrictions(state, pIdx, defOf(card) as any);
        if (r.ok) {
          entry.playable = true;
          entry.targetMode = 'any';
          out.playableActions.push(card.uid);
        } else entry.reason = r.reason ?? 'restriction';
        break;
      }
      case 'EQUIPMENT': {
        const targets = equipmentTargets(state, pIdx);
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

  // Upgrades: hand character cards onto own characters (shared predicate).
  for (const card of p.hand) {
    if (card.kind !== 'CHARACTER') continue;
    if (out.deployable.includes(card.uid)) continue; // showing both would be confusing; deploy wins in UI
    for (const c of myChars) {
      if (canUpgradeTo(state, c, card).ok) out.upgradable.push({ from: c.uid, to: card.uid });
    }
  }

  // Attacks from the active character — shared predicate.
  const active = p.active;
  if (active) {
    const atkCheck = canAttack(state, active);
    for (const atk of grantedAttacks(state, active)) {
      if (!atkCheck.ok) {
        out.attacks.push({ attackId: atk.id, playable: false, reason: atkCheck.reason });
        continue;
      }
      if (!costSatisfied(active, atk.cost, effectiveAttackCostReduce(state, active, atk.cost, atk))) {
        out.attacks.push({ attackId: atk.id, playable: false, reason: 'not_enough_resources' });
        continue;
      }
      out.attacks.push({ attackId: atk.id, playable: true });
    }

    // Retreat — shared predicates.
    const r = retreatCheck(state, pIdx);
    out.canRetreat = r.ok && p.bench.length > 0;
    out.retreatTargets = out.canRetreat && canPayRetreat(state, pIdx) ? p.bench.map((c) => c.uid) : [];
  }

  // Activated abilities — shared predicate.
  for (const c of myChars) {
    for (const ab of charDef(c).abilities) {
      if (ab.trigger !== 'activated') continue;
      const chk = abilityCheck(state, pIdx, c, ab);
      out.abilities.push({ charUid: c.uid, abilityId: ab.id, playable: chk.ok, reason: chk.reason });
    }
    // Supremas — shared predicate.
    const ult = charDef(c).ultimate;
    if (ult) {
      const chk = ultimateCheck(state, pIdx, c, ult);
      out.ultimates.push({ charUid: c.uid, ultimateId: ult.id, playable: chk.ok, reason: chk.reason });
    }
  }

  return out;
}
