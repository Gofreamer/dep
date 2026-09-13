import type { CardInstance, ChoiceRequest, Command, MatchState, PlayerId } from '../types';
import {
  abilitiesBlocked, aggregateMods, cannotRetreat, charDef, charactersInPlay, costSatisfied, currentHp, defOf,
  grantedAttacks, isDefeated, maxHp, opponentOf, player, retreatCostOf
} from '../queries';
import { canUpgradeTo } from '../rules';
import { computeLegalActions } from '../validation';
import { registry } from '../registry';
import { evalCondition, rand } from '../effects/core';
import { DEFAULT_PROFILE, profileForLevel, type AiProfile } from './profile';

/**
 * Heuristic AI com níveis de habilidade reais (AiProfile). Não é aleatória:
 * pontua TODA opção legal (lethal, curva de recurso, ameaças, recuo, valor de
 * carta) e escolhe a melhor — com lookahead determinístico (searchDepth 1–2,
 * beam) para perfis fortes. NUNCA trapaceia: só lê estado público.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

interface Scored { cmd: Command; score: number }

export function aiNextCommand(
  engine: { state: MatchState; canAttackNow(i: CardInstance): { ok: boolean; reason?: string }; cloneForSimulation?: (c?: (req: ChoiceRequest) => string[]) => any },
  pIdx: PlayerId,
  profile?: AiProfile
): Command {
  const state = engine.state;
  const p = player(state, pIdx);
  const opp = opponentOf(state, pIdx);
  const prof = profile ?? profileForLevel(p.aiLevel);
  const legal = computeLegalActions(state, pIdx, 0);

  // --- setup phase -------------------------------------------------------
  if (state.phase === 'setup') {
    if (!p.active) {
      const best = bestBy(legal.setupActive, (uid) => {
        const c = p.hand.find((x) => x.uid === uid)!;
        const d = charDef(c);
        return d.maxHp + d.attacks.reduce((s, a) => s + (a.damage ?? 0), 0) * 2 + d.victoryValue * 5;
      });
      return { type: 'SETUP_SET_ACTIVE', player: pIdx, uid: best! };
    }
    // bench: deploy one good basic per call
    const candidates = legal.setupBench.filter((uid) => !p.active || uid !== p.active.uid);
    if (candidates.length > 0 && p.bench.length < 2) {
      const best = bestBy(candidates, (uid) => {
        const c = p.hand.find((x) => x.uid === uid)!;
        const d = charDef(c);
        return d.maxHp * 0.5 + (d.family ? 8 : 0);
      });
      return { type: 'SETUP_BENCH', player: pIdx, uid: best };
    }
    return { type: 'SETUP_DONE', player: pIdx };
  }

  const options: Scored[] = [];
  const noise = noiseFor(prof);
  const nz = () => (rand(state) - 0.5) * 2 * noise;

  // --- 1. deploy characters ---------------------------------------------
  if (p.bench.length < state.config.board.benchSize) {
    for (const uid of legal.deployable) {
      const card = p.hand.find((c) => c.uid === uid)!;
      const d = charDef(card);
      let score = 6 + d.maxHp / 40 + d.attacks.length * 1.5;
      score *= (0.5 + prof.boardWeight);
      if (d.stage > 0) score -= 10; // don't waste bench space on stage>1 without base (validated anyway)
      if (d.abilities.some((a) => a.trigger === 'whileBench')) score += 3;
      if (opp.active) score += threatBonus(state, card, opp.active) * 0.3;
      options.push({ cmd: { type: 'DEPLOY_CHARACTER', player: pIdx, uid }, score: score + nz() });
    }
  }

  // --- 2. attach resources ----------------------------------------------
  if (p.attachedThisTurn < state.config.turn.attachPerTurn + attachExtra(state, pIdx)) {
    for (const card of p.hand) {
      if (card.kind !== 'RESOURCE') continue;
      const best = bestResourceTarget(state, pIdx, card);
      if (best) options.push({ cmd: { type: 'ATTACH_RESOURCE', player: pIdx, uid: card.uid, targetUid: best.uid }, score: resourceScore(state, pIdx, card, best, prof) + nz() });
    }
  }

  // --- 3. upgrades --------------------------------------------------------
  for (const up of legal.upgradable) {
    const host = findChar(state, pIdx, up.from);
    const card = p.hand.find((c) => c.uid === up.to)!;
    if (!host) continue;
    const cd = charDef(host);
    const nd = charDef(card);
    let score = 10 + (nd.maxHp - cd.maxHp) / 10 + (nd.attacks.reduce((s, a) => s + (a.damage ?? 0), 0) - cd.attacks.reduce((s, a) => s + (a.damage ?? 0), 0)) / 12;
    if (isThreatened(state, host, opp)) score += 3;
    options.push({ cmd: { type: 'UPGRADE', player: pIdx, uid: up.to, targetUid: up.from }, score: score + nz() });
  }

  // --- 4. abilities ---------------------------------------------------------
  for (const ab of legal.abilities) {
    if (!ab.playable) continue;
    const host = findChar(state, pIdx, ab.charUid);
    if (!host) continue;
    const cd = charDef(host).abilities.find((a) => a.id === ab.abilityId);
    if (!cd) continue;
    let score = 5;
    if (cd.effects?.some((e) => e.op === 'drawCards')) score += 2.5;
    if (cd.effects?.some((e) => e.op === 'heal')) score += host.damage > 0 ? 3 : 0;
    if (cd.effects?.some((e) => e.op === 'dealDamage')) score += 3 * prof.aggression;
    if (cd.effects?.some((e) => e.op === 'searchDeck' || e.op === 'retrieveFromDiscard')) score += 2;
    if (cd.effects?.some((e) => e.op === 'attachResource')) score += 3.5;
    if (cd.effects?.some((e) => e.op === 'upgradeCharacter')) score += 4;
    options.push({ cmd: { type: 'USE_ABILITY', player: pIdx, charUid: ab.charUid, abilityId: ab.abilityId }, score: score + nz() });
  }

  // --- 5. equipment --------------------------------------------------------
  for (const eq of legal.playableEquipment) {
    const card = p.hand.find((c) => c.uid === eq.uid)!;
    const ed = defOf(card) as any;
    let bestScore = -1;
    let bestTarget: string | null = null;
    for (const t of eq.targets) {
      const host = findChar(state, pIdx, t);
      if (!host) continue;
      let s = 5;
      if (ed.mods?.damageDealtFlat && host.uid === p.active?.uid) s += 3 * prof.aggression;
      if (ed.mods?.damageTakenFlat && isThreatened(state, host, opp)) s += 3.5;
      if (ed.grantsAttacks?.length && host.uid !== p.active?.uid) s += 1;
      if (s > bestScore) { bestScore = s; bestTarget = t; }
    }
    if (bestTarget) options.push({ cmd: { type: 'PLAY_EQUIPMENT', player: pIdx, uid: eq.uid, targetUid: bestTarget }, score: bestScore + nz() });
  }

  // --- 6. field ------------------------------------------------------------
  for (const uid of legal.playableFields) {
    const card = p.hand.find((c) => c.uid === uid)!;
    const fd = defOf(card) as any;
    let score = 4;
    if (fd.mods?.damageDealtFlat) score += 2.5 * prof.aggression;
    if (fd.mods?.attachExtra || fd.override?.attachExtra) score += 3.5 * prof.futurePlanning;
    if (fd.mods?.drawExtra) score += 2 * prof.futurePlanning;
    if (fd.mods?.healFlat) score += 2 * (1 - prof.aggression);
    if (state.fields.length > 0) score -= 2; // replacing own field
    options.push({ cmd: { type: 'PLAY_FIELD', player: pIdx, uid }, score: score + nz() });
  }

  // --- 7. action cards -------------------------------------------------------
  for (const uid of legal.playableActions) {
    const card = p.hand.find((c) => c.uid === uid)!;
    options.push({ cmd: { type: 'PLAY_ACTION', player: pIdx, uid }, score: actionScore(state, pIdx, card, prof) + nz() });
  }

  // --- 8. retreat ------------------------------------------------------------
  if (legal.canRetreat) {
    const active = p.active!;
    const retreatScore = retreatDesirability(state, pIdx, active, prof);
    if (retreatScore > 0 && legal.retreatTargets.length > 0) {
      const bestBench = bestBy(legal.retreatTargets, (uid) => {
        const c = findChar(state, pIdx, uid)!;
        const d = charDef(c);
        let s = d.maxHp / 20;
        for (const a of grantedAttacks(state, c)) {
          const reduce = 0;
          if (costSatisfied(c, a.cost, reduce)) s += (a.damage ?? 0) / 15;
        }
        return s;
      });
      const cost = retreatCostOf(state, active);
      options.push({ cmd: { type: 'RETREAT', player: pIdx, benchUid: bestBench }, score: retreatScore - cost * 1.2 + nz() });
    }
  }

  // --- 8b. Supremas (uma vez por partida, condicionais — sempre alto valor) ----
  for (const ult of legal.ultimates ?? []) {
    if (!ult.playable) continue;
    const host = charactersInPlay(state, pIdx).find((c) => c.uid === ult.charUid);
    if (!host) continue;
    const udef = charDef(host).ultimate;
    if (!udef) continue;
    const urgency = player(state, pIdx === 0 ? 1 : 0).victoryPoints >= state.config.victory.targetPoints - 1 ? 6 : 3;
    options.push({ cmd: { type: 'USE_ULTIMATE', player: pIdx, charUid: ult.charUid, ultimateId: ult.ultimateId }, score: 5 + urgency + nz() });
  }

  // --- 9. attack ---------------------------------------------------------------
  const active = p.active;
  if (active) {
    for (const atk of legal.attacks) {
      if (!atk.playable) continue;
      const def = grantedAttacks(state, active).find((a) => a.id === atk.attackId)!;
      options.push({ cmd: { type: 'ATTACK', player: pIdx, attackId: atk.attackId }, score: attackScore(engine, state, pIdx, active, def, prof) + nz() * 0.4 });
    }
  }

  // --- lookahead determinístico (depth/beam) -------------------------------
  if (prof.searchDepth >= 1 && options.length > 0 && typeof engine.cloneForSimulation === 'function') {
    options.sort((a, b) => b.score - a.score);
    const beam = options.slice(0, Math.max(1, prof.beamWidth));
    for (const o of beam) {
      const bonus = lookaheadScore(engine as any, pIdx, o.cmd, prof);
      o.score += bonus;
    }
  }

  // --- pick ------------------------------------------------------------------
  options.sort((a, b) => b.score - a.score);

  // blunder: chance seeded de escolher uma jogada subótima (legal) — nunca ilegal
  if (prof.blunderRate > 0 && options.length > 0 && rand(state) < prof.blunderRate) {
    const subpool = options.filter((o) => o.score > 0.2);
    if (subpool.length > 1) {
      return subpool[Math.floor(rand(state) * subpool.length)].cmd;
    }
  }

  const bestThreshold = prof.searchDepth >= 1 ? 0 : prof.blunderRate > 0.1 ? 0.8 : 2.2;
  const pool = options.filter((o) => o.score >= options[0]?.score - bestThreshold && o.score > 0.2);
  if (pool.length > 0) {
    const pick = prof.blunderRate > 0.15 ? pool[Math.floor(rand(state) * pool.length)] : pool[0];
    return pick.cmd;
  }

  // nothing worth doing — but if we haven't attacked and can, do it anyway to progress
  const anyAttack = legal.attacks.find((a: { playable: boolean; attackId: string }) => a.playable);
  if (anyAttack) return { type: 'ATTACK', player: pIdx, attackId: anyAttack.attackId };
  return { type: 'END_TURN', player: pIdx };
}

/** Resolves a mid-effect choice for the AI (deck search, targets, options). */
export function aiSmartChoice(state: MatchState, pIdx: PlayerId, req: ChoiceRequest): string[] {
  const p = player(state, pIdx);
  const opp = opponentOf(state, pIdx);
  const scoreCard = (uid: string): number => {
    const found = [...p.hand, ...p.deck, ...p.discard, ...p.bench, ...(p.active ? [p.active] : []), ...opp.bench, ...(opp.active ? [opp.active] : []), ...opp.discard, ...opp.deck]
      .find((c) => c.uid === uid);
    if (!found) return 0;
    const d = defOf(found);
    let s = 1;
    if (d.kind === 'CHARACTER') {
      const cd = d as any;
      s = 3 + (cd.maxHp ?? 0) / 40 + (cd.stage ?? 0) * 2;
      if (cd.family) s += 1.5;
    }
    if (d.kind === 'RESOURCE') s = 2.5;
    if (d.kind === 'EQUIPMENT') s = 2.2;
    if (d.kind === 'ACTION') s = 2;
    return s;
  };
  if (req.kind === 'option') return [req.candidates[0]];
  const sorted = [...req.candidates].sort((a, b) => scoreCard(b) - scoreCard(a));
  const maxN = req.max;
  const want = Math.max(req.min, Math.min(maxN, sorted.length));
  return sorted.slice(0, want);
}

// ---------------------------------------------------------------------------
// Lookahead determinístico (state clone → dispatch → board eval)
// ---------------------------------------------------------------------------

function noiseFor(prof: AiProfile): number {
  if (prof.blunderRate >= 0.2) return 6;
  if (prof.blunderRate >= 0.05) return 2.5;
  if (prof.blunderRate > 0) return 0.8;
  return 0.2;
}

/** Avaliação de board (estado PÚBLICO) da perspectiva de pIdx. */
function boardEval(state: MatchState, pIdx: PlayerId, prof: AiProfile): number {
  const me = player(state, pIdx);
  const opp = opponentOf(state, pIdx);
  let score = 0;
  score += (me.victoryPoints - opp.victoryPoints) * 30;
  const hp = (pl: typeof me) => charactersInPlay(state, pl.index).reduce((s, c) => s + currentHp(state, c), 0);
  score += (hp(me) - hp(opp)) * 0.4;
  if (me.active && opp.active) {
    const myDmg = bestDamageOnto(state, me.active, opp.active);
    const oppDmg = bestDamageOnto(state, opp.active, me.active);
    if (myDmg >= currentHp(state, opp.active)) score += 60 * prof.lethalWeight + charDef(opp.active).victoryValue * 15;
    if (oppDmg >= currentHp(state, me.active)) score -= 60 * prof.lethalWeight;
    score += myDmg * 0.6 * prof.aggression;
    score -= oppDmg * 0.6 * (1 - prof.aggression) * prof.tempoWeight;
  }
  const res = (pl: typeof me) => charactersInPlay(state, pl.index).reduce((s, c) => s + c.attached.filter((a) => a.kind === 'RESOURCE').length, 0);
  score += (res(me) - res(opp)) * 4 * (0.3 + prof.resourcePreservation);
  score += me.bench.length * 3 * prof.boardWeight;
  score -= opp.bench.length * 2 * prof.boardWeight;
  return score;
}

function lookaheadScore(engine: any, pIdx: PlayerId, cmd: Command, prof: AiProfile): number {
  let clone: any;
  try {
    clone = engine.cloneForSimulation((req: ChoiceRequest) => aiSmartChoice(clone.state, req.player, req));
  } catch {
    return 0;
  }
  const resolveAll = () => {
    for (let i = 0; i < 8; i++) {
      const pend = clone.getPending();
      if (!pend) return;
      clone.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(clone.state, pend.player, pend) });
    }
  };
  const r = clone.dispatch(cmd);
  if (!r.ok) return -40;
  resolveAll();
  if (clone.state.phase === 'gameOver') {
    return clone.state.winner === pIdx ? 500 * prof.lethalWeight : -500 * prof.lethalWeight;
  }
  let score = boardEval(clone.state, pIdx, prof);
  // depth 2: resposta gananciosa do oponente (determinística)
  if (prof.searchDepth >= 2) {
    const oppIdx = (pIdx === 0 ? 1 : 0) as PlayerId;
    const oppCmd = aiNextCommand(clone, oppIdx, { ...prof, searchDepth: 0 });
    const r2 = clone.dispatch(oppCmd);
    if (r2.ok) {
      resolveAll();
      if (clone.state.phase === 'gameOver') {
        score += clone.state.winner === pIdx ? 250 : -250;
      } else {
        score -= boardEval(clone.state, oppIdx, prof) * 0.4;
      }
    }
  }
  return score;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function findChar(state: MatchState, pIdx: PlayerId, uid: string): CardInstance | null {
  const p = player(state, pIdx);
  if (p.active?.uid === uid) return p.active;
  return p.bench.find((c) => c.uid === uid) ?? null;
}

function bestBy(uids: string[], score: (uid: string) => number): string {
  let best = uids[0];
  let bestScore = -Infinity;
  for (const uid of uids) {
    const s = score(uid);
    if (s > bestScore) { bestScore = s; best = uid; }
  }
  return best;
}

function attachExtra(state: MatchState, pIdx: PlayerId): number {
  let extra = 0;
  for (const f of state.fields) {
    const fd = defOf(f) as any;
    if (fd.scope === 'owner' && f.owner !== pIdx) continue;
    extra += fd.mods?.attachExtra ?? 0;
  }
  for (const ov of state.fieldOverrides) extra += ov.attachExtra ?? 0;
  return extra;
}

/** Expected damage of `attacker`'s best affordable attack onto `defender`. */
function bestDamageOnto(state: MatchState, attacker: CardInstance, defender: CardInstance): number {
  let best = 0;
  for (const a of grantedAttacks(state, attacker)) {
    if (!costSatisfied(attacker, a.cost, 0)) continue;
    const base = a.damage ?? 0;
    const aff = a.affinity ?? charDef(attacker).affinity;
    const dealt = aggregateMods(state, { char: attacker, owner: attacker.owner, side: 'dealt', affinity: aff });
    const taken = aggregateMods(state, { char: defender, owner: defender.owner, side: 'taken', affinity: aff });
    let dmg = (base + dealt.dealt.flat) * dealt.dealt.mult;
    const tdef = charDef(defender);
    if (tdef.weakness && tdef.weakness.affinity === aff) dmg *= state.config.damage.weaknessMultiplier;
    if (tdef.resistance && tdef.resistance.affinity === aff) dmg -= tdef.resistance.reduce ?? state.config.damage.resistanceDefaultReduce;
    dmg = (dmg + taken.taken.flat) * taken.taken.mult;
    best = Math.max(best, Math.max(0, Math.floor(dmg)));
  }
  return best;
}

function threatBonus(state: MatchState, attackerCard: CardInstance, defender: CardInstance): number {
  void state; void attackerCard; void defender;
  return 1;
}

function isThreatened(state: MatchState, c: CardInstance, opp: PlayerStateLike): boolean {
  if (!opp.active) return false;
  const dmg = bestDamageOnto(state, opp.active, c);
  return dmg >= currentHp(state, c);
}

interface PlayerStateLike { active: CardInstance | null }

function bestResourceTarget(state: MatchState, pIdx: PlayerId, card: CardInstance): CardInstance | null {
  const p = player(state, pIdx);
  const rd = defOf(card) as any;
  const type = rd.resourceType;
  const chars = charactersInPlay(state, pIdx);
  let best: CardInstance | null = null;
  let bestScore = -Infinity;
  for (const c of chars) {
    if (c.attached.some((a) => a.kind === 'RESOURCE' && (defOf(a) as any).resourceId === card.defId)) continue;
    let score = 1;
    // does it enable a new attack or bring lethal closer?
    const sim = simulateAttach(c, type, rd.wild);
    for (const a of grantedAttacks(state, c)) {
      const before = costSatisfied(c, a.cost, 0);
      const after = costSatisfied(sim, a.cost, 0);
      if (!before && after) score += 4 + (a.damage ?? 0) / 20;
      if (before && after && (a.damage ?? 0) > 0) score += 0.5;
    }
    if (state.players[pIdx].active?.uid === c.uid) score += 1.5;
    if (isDefeated(state, c)) score = -1;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function simulateAttach(host: CardInstance, type: string, wild: boolean | undefined): CardInstance {
  const fakeDefId = simResourceDefId(type, wild);
  if (!fakeDefId) return host; // nenhum recurso registrado: sem simulação
  return {
    ...host,
    attached: [...host.attached, { uid: 'sim', defId: fakeDefId, owner: host.owner, kind: 'RESOURCE', damage: 0, stageLevel: 0, statuses: [], counters: {}, attached: [], progression: [], usedTurn: [], usedMatch: [], deployedOnTurn: 0 }]
  };
}

/** Id de um RECURSO REGISTRADO compatível (sem hardcode de pack — JET/qualquer um). */
function simResourceDefId(type: string, wild: boolean | undefined): string | null {
  const resources = registry.allCards().filter((d) => d.kind === 'RESOURCE');
  const exact = resources.find((d) => (wild ? !!(d as { wild?: boolean }).wild : (d as { resourceType?: string }).resourceType === type));
  return exact?.id ?? resources[0]?.id ?? null;
}

function resourceScore(state: MatchState, pIdx: PlayerId, card: CardInstance, target: CardInstance, prof: AiProfile): number {
  void state; void pIdx; void card; void target;
  return 5.5 * (0.4 + prof.resourcePreservation) + (prof.futurePlanning - 0.5) * 2;
}

function actionScore(state: MatchState, pIdx: PlayerId, card: CardInstance, prof: AiProfile): number {
  const d = defOf(card) as any;
  let score = 3.2;
  for (const e of d.effects ?? []) {
    if (e.op === 'drawCards') score += 1.5 + (e.amount ?? 1) * 0.7;
    if (e.op === 'dealDamage') score += (1.8 + (e.amount ?? 0) / 15) * prof.aggression;
    if (e.op === 'heal') score += player(state, pIdx).active && player(state, pIdx).active!.damage > 20 ? 2.5 : 0.5;
    if (e.op === 'searchDeck') score += 2.2;
    if (e.op === 'retrieveFromDiscard') score += 1.8;
    if (e.op === 'upgradeCharacter') score += 3.5;
    if (e.op === 'applyStatus') score += 2 * (e.status === 'marked' ? prof.aggression : 1);
    if (e.op === 'attachResource') score += 3 * prof.futurePlanning;
    if (e.op === 'detachResource') score += 2.5 * (1 - prof.aggression + prof.matchupKnowledge * 0.5);
  }
  return score;
}

function retreatDesirability(state: MatchState, pIdx: PlayerId, active: CardInstance, prof: AiProfile): number {
  const opp = opponentOf(state, pIdx);
  let score = 0;
  if (opp.active) {
    const incoming = bestDamageOnto(state, opp.active, active);
    if (incoming >= currentHp(state, active)) score += 7; // would be KO'd
    else if (incoming > 0) score += incoming / 25;
  }
  if (active.damage > maxHp(state, active) * 0.7) score += 2.5;
  if (active.statuses.some((s) => s.tokens > 0 && (s.id === 'confusion' || s.id === 'sleep'))) score += 2;
  // is there a better attacker on the bench?
  for (const b of player(state, pIdx).bench) {
    if (opp.active && bestDamageOnto(state, b, opp.active) > 0) score += 1.5;
    if (canUpgradeTo(state, b, b)) score += 0.5;
  }
  score *= (0.4 + prof.tempoWeight);
  void abilitiesBlocked; void evalCondition; void isDefeated; void cannotRetreat;
  return score;
}

function attackScore(engine: { state: MatchState }, state: MatchState, pIdx: PlayerId, active: CardInstance, def: any, prof: AiProfile): number {
  const opp = opponentOf(state, pIdx);
  if (!opp.active) return -1;
  const base = def.damage ?? 0;
  const scale = def.scaling?.reduce((s: number, sc: any) => s + (sc.amount ?? 0) * 4, 0) ?? 0;
  const aff = def.affinity ?? charDef(active).affinity;
  const dealt = aggregateMods(state, { char: active, owner: pIdx, side: 'dealt', affinity: aff });
  const taken = aggregateMods(state, { char: opp.active, owner: opp.active.owner, side: 'taken', affinity: aff });
  let dmg = (base + scale + dealt.dealt.flat) * dealt.dealt.mult;
  const tdef = charDef(opp.active);
  if (tdef.weakness && tdef.weakness.affinity === aff) dmg *= state.config.damage.weaknessMultiplier;
  if (tdef.resistance && tdef.resistance.affinity === aff) dmg -= tdef.resistance.reduce ?? state.config.damage.resistanceDefaultReduce;
  dmg = (dmg + taken.taken.flat) * taken.taken.mult;
  dmg = Math.max(0, Math.floor(dmg));

  const hp = currentHp(state, opp.active);
  let score = (dmg / 8) * (0.5 + prof.aggression);
  if (dmg >= hp) {
    score += (8 + charDef(opp.active).victoryValue * 3) * prof.lethalWeight; // lethal!
    if (prof.searchDepth >= 1) score += 2;
  }
  // discourage suicidal self-damage (riskTolerance modula)
  if (def.selfDamage) {
    const after = currentHp(state, active) - def.selfDamage;
    const riskPenalty = 12 * (1 - prof.riskTolerance);
    if (after <= 0 && dmg < hp) score -= riskPenalty;
    else if (after <= 0) score -= 2;
    else score -= def.selfDamage / 20;
  }
  // strong AI: account for retaliation next turn
  if (prof.searchDepth >= 1 && dmg < hp && opp.active) {
    const retal = bestDamageOnto(state, opp.active, active);
    if (retal >= currentHp(state, active)) score -= 4 * (1 - prof.riskTolerance);
  }
  if (def.effects?.some((e: any) => e.op === 'applyStatus')) score += 1;
  if (def.effects?.some((e: any) => e.op === 'heal')) score += active.damage > 0 ? 1.5 : 0;
  if (def.effects?.some((e: any) => e.op === 'drawCards')) score += 1.2;
  return score;
}

void DEFAULT_PROFILE;
