/**
 * Heuristic AI com níveis de habilidade reais (AiProfile). Não é aleatória:
 * pontua TODA opção legal usando o modelo de valor de efeitos (`eval.ts`) —
 * dano, cura, negação de recurso, status, sinergia condicional, setup futuro —
 * e escolhe a melhor, com lookahead determinístico (searchDepth 1–2, beam)
 * para os perfis fortes.
 *
 * Nunca trapaceia: só lê estado público + a PRÓPRIA mão, nunca vê o deck do
 * oponente, não controla RNG, não ganha recurso nem ignora custo. A legalidade é
 * sempre a de `rules.ts`; aqui só se escolhe entre jogadas já legais.
 */
import type { CardInstance, ChoiceRequest, Command, MatchState, PlayerId } from '../types';
import {
  abilitiesBlocked, charDef, charactersInPlay, costSatisfied, currentHp, defOf, grantedAttacks,
  isDefeated, maxHp, opponentOf, player, retreatCostOf
} from '../queries';
import { canUpgradeTo, effectiveAttackCostReduce } from '../rules';
import { computeLegalActions } from '../validation';
import { registry } from '../registry';
import { DEFAULT_PROFILE, profileForLevel, type AiProfile } from './profile';
import { createAiNoise } from './noise';
import { attackValue, bestDamageOnto, effectsValue, emptyPlan, prepareCtx, type EvalCtx } from './eval';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Scored { cmd: Command; score: number }

type EngineLike = {
  state: MatchState;
  canAttackNow(i: CardInstance): { ok: boolean; reason?: string };
  cloneForSimulation?: (c?: (req: ChoiceRequest) => string[]) => any;
};

export function aiNextCommand(engine: EngineLike, pIdx: PlayerId, profile?: AiProfile): Command {
  const state = engine.state;
  const p = player(state, pIdx);
  const opp = opponentOf(state, pIdx);
  const prof = profile ?? profileForLevel(p.aiLevel);
  const legal = computeLegalActions(state, pIdx, 0);
  const ctx: EvalCtx = prepareCtx({ state, me: pIdx, prof });

  // --- setup phase -------------------------------------------------------
  if (state.phase === 'setup') {
    if (!p.active) {
      const best = bestBy(legal.setupActive, (uid) => {
        const c = p.hand.find((x) => x.uid === uid)!;
        const d = charDef(c);
        // ativo ideal: tanque + pressão + PV alto (não é isca de KO grátis)
        return d.maxHp + d.attacks.reduce((s, a) => s + (a.damage ?? 0), 0) * 2 + d.victoryValue * 5;
      });
      return { type: 'SETUP_SET_ACTIVE', player: pIdx, uid: best! };
    }
    // Reserva: banco é seguro de vida — `noActiveLoses` termina a partida com a
    // reserva vazia. O 2.0 parava em 2; a IA agora preenche até o limite real.
    const candidates = legal.setupBench.filter((uid) => !p.active || uid !== p.active.uid);
    if (candidates.length > 0 && p.bench.length < state.config.board.benchSize) {
      const best = bestBy(candidates, (uid) => {
        const c = p.hand.find((x) => x.uid === uid)!;
        const d = charDef(c);
        return d.maxHp * 0.5 + (d.family ? 8 : 0) + d.attacks.length * 2;
      });
      return { type: 'SETUP_BENCH', player: pIdx, uid: best };
    }
    return { type: 'SETUP_DONE', player: pIdx };
  }

  const options: Scored[] = [];
  const noiseScale = noiseFor(prof);
  // Ruído da IA vem de `createAiNoise` (função pura do estado público) e NÃO
  // do `rand(state)`: deixar a IA consumir o RNG da partida deslocava moedas
  // e o sorteio de quem abre, o que polui medição de meta e é acoplamento
  // indevido entre avaliador e regras.
  const noise = createAiNoise({ seed: state.seed, turn: state.turn, commandCount: state.eventSeq, player: pIdx });
  const nz = () => noise.jitter(noiseScale);

  // --- 1. deploy characters (desenvolvimento de reserva) -----------------
  if (p.bench.length < state.config.board.benchSize) {
    for (const uid of legal.deployable) {
      const card = p.hand.find((c) => c.uid === uid)!;
      const d = charDef(card);
      let score = 6 + d.maxHp / 40 + d.attacks.length * 1.5;
      score *= (0.5 + prof.boardWeight);
      if (d.stage > 0) score -= 10; // não gasta banco com forma sem base (validado à parte)
      if (d.abilities.some((a) => a.trigger === 'whileBench')) score += 3;
      // fragilidade: sem reserva, cada KO inimigo é derrota — prioridade máxima
      if (p.bench.length === 0) score += 9 * (0.5 + prof.futurePlanning);
      if (opp.active) score += threatBonus(state, card, opp.active, ctx) * 0.35;
      options.push({ cmd: { type: 'DEPLOY_CHARACTER', player: pIdx, uid }, score: score + nz() });
    }
  }

  // --- 2. attach resources ----------------------------------------------
  if (p.attachedThisTurn < state.config.turn.attachPerTurn + attachExtra(state, pIdx)) {
    for (const card of p.hand) {
      if (card.kind !== 'RESOURCE') continue;
      const best = bestResourceTarget(state, pIdx, card, ctx);
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
    // avaliar o que a nova forma muda no ataque (dano real contra o Ativo inimigo)
    if (opp.active) {
      const before = bestDamageOnto(state, host, opp.active);
      const after = bestDamageOnto(state, { ...host, defId: card.defId } as CardInstance, opp.active);
      score += (after - before) / 8;
    }
    options.push({ cmd: { type: 'UPGRADE', player: pIdx, uid: up.to, targetUid: up.from }, score: score + nz() });
  }

  // --- 4. abilities -------------------------------------------------------
  for (const ab of legal.abilities) {
    if (!ab.playable) continue;
    const host = findChar(state, pIdx, ab.charUid);
    if (!host) continue;
    const adef = charDef(host).abilities.find((a) => a.id === ab.abilityId);
    if (!adef) continue;
    let score = 2 + effectsValue(ctx, adef.effects, emptyPlan());
    if (adef.mods) score += modsValue(state, pIdx, host, adef.mods, prof);
    if (score < 0.5) score = 0.5; // habilidade "gratuita" ainda é melhor que passar o turno
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
      let s = 5 + modsValue(state, pIdx, host, ed.mods ?? {}, prof);
      for (const granted of ed.grantsAttacks ?? []) {
        const sim = { ...host, attached: [...host.attached, card] } as CardInstance;
        s += grantedAttackValue(state, pIdx, sim, granted, prof);
      }
      if (s > bestScore) { bestScore = s; bestTarget = t; }
    }
    if (bestTarget) options.push({ cmd: { type: 'PLAY_EQUIPMENT', player: pIdx, uid: eq.uid, targetUid: bestTarget }, score: bestScore + nz() });
  }

  // --- 6. field ------------------------------------------------------------
  for (const uid of legal.playableFields) {
    const card = p.hand.find((c) => c.uid === uid)!;
    const fd = defOf(card) as any;
    let score = 4 + effectsValue(ctx, fd.onPlay, emptyPlan());
    for (const c of charactersInPlay(state, pIdx)) score += modsValue(state, pIdx, c, fd.mods ?? {}, prof) * 0.45;
    if (fd.mods?.attachExtra || fd.override?.attachExtra) score += 3.5 * prof.futurePlanning;
    if (fd.mods?.drawExtra) score += 2 * prof.futurePlanning;
    if (fd.override?.disableAbilities) score += 2.5 * prof.matchupKnowledge * (opponentHasAbilities(state, pIdx) ? 1 : 0);
    if (fd.override?.blockRetreat || fd.override?.blockSwitching) score += 2 * prof.tempoWeight;
    if (state.fields.length > 0) score -= 2; // trocar o próprio campo
    options.push({ cmd: { type: 'PLAY_FIELD', player: pIdx, uid }, score: score + nz() });
  }

  // --- 7. action cards (o avaliador conhece TODAS as operações) ----------
  for (const uid of legal.playableActions) {
    const card = p.hand.find((c) => c.uid === uid)!;
    const d = defOf(card);
    const base = effectsValue(ctx, (d as any).effects, emptyPlan());
    // cartas de "quebra de plano" (negação) valem mais quando o oponente tem
    // ameaça armada; dano grátis vale menos que um KO real
    const threat = opp.active && p.active ? bestDamageOnto(state, opp.active, p.active) / 8 : 0;
    const denies = (d as any).effects?.some((e: any) => e.op === 'detachResource' || e.op === 'applyStatus' || e.op === 'forceEnemySwitch' || e.op === 'disableAbility');
    options.push({
      cmd: { type: 'PLAY_ACTION', player: pIdx, uid },
      score: base + (denies ? threat * 0.35 * prof.matchupKnowledge : 0) + 0.4 + nz()
    });
  }

  // --- 8. retreat ----------------------------------------------------------
  if (legal.canRetreat && p.active) {
    const active = p.active;
    const retreatScore = retreatDesirability(state, pIdx, active, prof);
    if (retreatScore > 0 && legal.retreatTargets.length > 0) {
      const bestBench = bestBy(legal.retreatTargets, (uid) => {
        const c = findChar(state, pIdx, uid)!;
        const d = charDef(c);
        let s = d.maxHp / 20;
        for (const a of grantedAttacks(state, c)) {
          if (costSatisfied(c, a.cost, effectiveAttackCostReduce(state, c, a.cost, a))) s += (a.damage ?? 0) / 15;
        }
        if (incomingThreatEnough(state, c, pIdx)) s -= 3; // alvo novo já morrendo
        return s;
      });
      const cost = retreatCostOf(state, active);
      options.push({ cmd: { type: 'RETREAT', player: pIdx, benchUid: bestBench }, score: retreatScore - cost * 1.2 + nz() });
    }
  }

  // --- 8b. Supremas (uma vez por partida, condicionais) -------------------
  for (const ult of legal.ultimates ?? []) {
    if (!ult.playable) continue;
    const host = charactersInPlay(state, pIdx).find((c) => c.uid === ult.charUid);
    if (!host) continue;
    const udef = charDef(host).ultimate;
    if (!udef) continue;
    const urgency = opponentOf(state, pIdx).victoryPoints >= state.config.victory.targetPoints - 1 ? 6 : 3;
    options.push({
      cmd: { type: 'USE_ULTIMATE', player: pIdx, charUid: ult.charUid, ultimateId: ult.ultimateId },
      score: urgency + effectsValue(ctx, udef.effects, emptyPlan()) + nz()
    });
  }

  // --- 9. attack -----------------------------------------------------------
  const active = p.active;
  if (active) {
    for (const atk of legal.attacks) {
      if (!atk.playable) continue;
      const def = grantedAttacks(state, active).find((a) => a.id === atk.attackId)!;
      options.push({ cmd: { type: 'ATTACK', player: pIdx, attackId: atk.attackId }, score: attackValue(ctx, def, active) + nz() * 0.4 });
    }
  }

  // --- lookahead determinístico (depth/beam) -----------------------------
  if (prof.searchDepth >= 1 && options.length > 0 && typeof engine.cloneForSimulation === 'function') {
    options.sort((a, b) => b.score - a.score);
    const beam = options.slice(0, Math.max(1, prof.beamWidth));
    for (const o of beam) o.score += lookaheadScore(engine, pIdx, o.cmd, prof);
  }

  // --- pick ----------------------------------------------------------------
  options.sort((a, b) => b.score - a.score);

  // blunder: chance SEEDed de escolher uma jogada subótima (legal) — nunca ilegal
  if (prof.blunderRate > 0 && options.length > 0 && noise.next() < prof.blunderRate) {
    const subpool = options.filter((o) => o.score > 0.2);
    if (subpool.length > 1) return subpool[noise.index(subpool.length)].cmd;
  }

  const bestThreshold = prof.searchDepth >= 1 ? 0 : prof.blunderRate > 0.1 ? 0.8 : 2.2;
  const pool = options.filter((o) => o.score >= (options[0]?.score ?? 0) - bestThreshold && o.score > 0.2);
  if (pool.length > 0) {
    const pick = prof.blunderRate > 0.15 ? pool[noise.index(pool.length)] : pool[0];
    return pick.cmd;
  }

  // nada positivo: atacar ainda assim (se der) para o jogo andar; senão passar
  const anyAttack = legal.attacks.find((a: { playable: boolean; attackId: string }) => a.playable);
  if (anyAttack) return { type: 'ATTACK', player: pIdx, attackId: anyAttack.attackId };
  return { type: 'END_TURN', player: pIdx };
}

/** Resolves a mid-effect choice for the AI (deck search, targets, options). */
export function aiSmartChoice(state: MatchState, pIdx: PlayerId, req: ChoiceRequest): string[] {
  const p = player(state, pIdx);
  const opp = opponentOf(state, pIdx);
  const needsEnergy = !p.active || !hasPayableAttack(state, p.active);
  const thinBench = p.bench.length < 2;

  const scoreUid = (uid: string): number => {
    const found = [...p.hand, ...p.deck, ...p.discard, ...p.bench, ...(p.active ? [p.active] : []), ...opp.bench, ...(opp.active ? [opp.active] : []), ...opp.discard, ...opp.deck]
      .find((c) => c.uid === uid);
    if (!found) return 0;
    const d = defOf(found);
    let s = 1;
    if (d.kind === 'CHARACTER') {
      const cd = d as any;
      s = 3 + (cd.maxHp ?? 0) / 40 + (cd.stage ?? 0) * 2;
      if (cd.family) s += 1.5;
      if (thinBench) s += 4; // reserva vazia = derrota no próximo KO
    }
    if (d.kind === 'RESOURCE') s = needsEnergy ? 6 : 2.5;
    if (d.kind === 'EQUIPMENT') s = 2.2;
    if (d.kind === 'ACTION') s = 2;
    return s;
  };
  if (req.kind === 'option') {
    // opção do efeito (ex.: escolher linha): pega a primeira não-destrutiva;
    // descreve o efeito, então manter o comportamento determinístico de antes
    return [req.candidates[0]];
  }
  const sorted = [...req.candidates].sort((a, b) => scoreUid(b) - scoreUid(a));
  const want = Math.max(req.min, Math.min(req.max, sorted.length));
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

function lookaheadScore(engine: EngineLike, pIdx: PlayerId, cmd: Command, prof: AiProfile): number {
  let clone: any;
  try {
    clone = engine.cloneForSimulation!((req: ChoiceRequest) => aiSmartChoice(clone.state, req.player, req));
  } catch {
    return 0;
  }
  const resolveAll = (): void => {
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

/** Quanto o agente recém-chegado ameaça o Ativo inimigo (KO iminente, pressão). */
function threatBonus(state: MatchState, attackerCard: CardInstance, defender: CardInstance, ctx: EvalCtx): number {
  const dmg = bestDamageOnto(state, attackerCard, defender);
  if (dmg <= 0) return 0;
  const hp = currentHp(state, defender);
  let v = dmg / 10;
  if (dmg >= hp) v += 4 + charDef(defender).victoryValue * 2;
  void ctx;
  return v;
}

function isThreatened(state: MatchState, c: CardInstance, opp: { active: CardInstance | null }): boolean {
  if (!opp.active) return false;
  const dmg = bestDamageOnto(state, opp.active, c);
  return dmg >= currentHp(state, c);
}

function incomingThreatEnough(state: MatchState, c: CardInstance, pIdx: PlayerId): boolean {
  const opp = opponentOf(state, pIdx);
  if (!opp.active) return false;
  return bestDamageOnto(state, opp.active, c) >= currentHp(state, c);
}

function hasPayableAttack(state: MatchState, inst: CardInstance): boolean {
  for (const a of grantedAttacks(state, inst)) {
    const need = (a.cost ?? []).reduce((s: number, e) => s + (e.amount ?? 0), 0) - effectiveAttackCostReduce(state, inst, a.cost, a);
    if ((a.damage ?? 0) > 0 && need <= inst.attached.filter((x) => x.kind === 'RESOURCE').length) return true;
  }
  return false;
}

function opponentHasAbilities(state: MatchState, pIdx: PlayerId): boolean {
  return charactersInPlay(state, (pIdx === 0 ? 1 : 0) as PlayerId).some((c) => charDef(c).abilities.length > 0);
}

/** Valor de um `mods` aplicado a um hospedeiro específico. */
function modsValue(state: MatchState, pIdx: PlayerId, host: CardInstance, mods: any, prof: AiProfile): number {
  let v = 0;
  const isActive = player(state, pIdx).active?.uid === host.uid;
  if (mods.damageDealtFlat) v += (mods.damageDealtFlat / 8) * (isActive ? 1.1 : 0.35) * (0.5 + prof.aggression);
  if (mods.damageTakenFlat) {
    const incoming = opponentOf(state, pIdx).active ? bestDamageOnto(state, opponentOf(state, pIdx).active!, host) : 0;
    v += (Math.min(incoming, mods.damageTakenFlat) / 8) * 0.9 + (isActive && incoming >= currentHp(state, host) ? 3 : 0);
  }
  if (mods.healFlat) v += (mods.healFlat / 8) * (host.damage > 0 ? 1 : 0.2);
  if (mods.statBonusHp) v += mods.statBonusHp / 40;
  if (mods.retreatCostMod) v += -mods.retreatCostMod * 1.1 * prof.tempoWeight;
  if (mods.attackCostReduce) v += (2.2 + (isActive && !hasPayableAttack(state, host) ? 3 : 0)) * (0.4 + 0.6 * prof.matchupKnowledge);
  if (mods.attachExtra) v += 1.6 * prof.futurePlanning;
  if (mods.drawExtra) v += 1.5 * prof.futurePlanning;
  if (mods.cannotAttack) v -= 4;
  if (mods.abilitiesDisabled) v -= 3;
  return v;
}

/** Valor de um ataque concedido (finisher) no alvo atual. */
function grantedAttackValue(state: MatchState, pIdx: PlayerId, hostWithEq: CardInstance, granted: any, prof: AiProfile): number {
  const opp = opponentOf(state, pIdx);
  if (!opp.active) return 0;
  const dmg = bestDamageOnto(state, hostWithEq, opp.active);
  if (dmg <= 0) return 0;
  const hp = currentHp(state, opp.active);
  const cost = (granted.cost ?? []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0) - effectiveAttackCostReduce(state, hostWithEq, granted.cost, granted);
  const pool = hostWithEq.attached.filter((a) => a.kind === 'RESOURCE').length;
  const reachableSoon = cost <= pool + 2; // alcançável em ≤2 turnos de conexão
  let v = (dmg / 8) * 0.45 * (0.5 + prof.aggression);
  if (dmg >= hp) v += 4 + charDef(opp.active).victoryValue * 2;
  if (!reachableSoon) v *= 0.35; // payoff inatingível nesta partida
  return v;
}

function bestResourceTarget(state: MatchState, pIdx: PlayerId, card: CardInstance, ctx: EvalCtx): CardInstance | null {
  const p = player(state, pIdx);
  const rd = defOf(card) as any;
  const type = rd.resourceType;
  const chars = charactersInPlay(state, pIdx);
  let best: CardInstance | null = null;
  let bestScore = -Infinity;
  for (const c of chars) {
    if (c.attached.some((a) => a.kind === 'RESOURCE' && (defOf(a) as any).resourceId === card.defId)) continue;
    let score = 1;
    const sim = simulateAttach(c, type, rd.wild);
    for (const a of grantedAttacks(state, c)) {
      const before = costSatisfied(c, a.cost, effectiveAttackCostReduce(state, c, a.cost, a));
      const after = costSatisfied(sim, a.cost, effectiveAttackCostReduce(state, sim, a.cost, a));
      if (!before && after) score += 4 + (a.damage ?? 0) / 20;
      if (before && after && (a.damage ?? 0) > 0) score += 0.5;
    }
    if (state.players[pIdx].active?.uid === c.uid) score += 1.5;
    // futuro: agente de reserva que vai atacar no próximo turno
    else score += 0.8 * ctx.prof.futurePlanning;
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

/** Valor de conectar energia: habilitar ataque agora/amanhã + conservadorismo. */
function resourceScore(state: MatchState, pIdx: PlayerId, card: CardInstance, target: CardInstance, prof: AiProfile): number {
  void card;
  const before = isPayableAttack(state, target, 0);
  const after = isPayableAttack(state, target, -1);
  const opp = opponentOf(state, pIdx);
  let v = 5.0 * (0.4 + prof.resourcePreservation) + (prof.futurePlanning - 0.5) * 2;
  if (!before && after) {
    const dmg = opp.active ? bestDamageOnto(state, target, opp.active) : 0;
    v += 2 + dmg / 10;
    if (opp.active && dmg >= currentHp(state, opp.active)) v += 4; // passa a ter lethal
  }
  if (player(state, pIdx).active?.uid === target.uid) v += 0.8;
  return v;
}

/** `delta<0` significa "uma energia A mais disponível" (simula a conexão). */
function isPayableAttack(state: MatchState, inst: CardInstance, delta: number): boolean {
  const pool = Math.max(0, inst.attached.filter((a) => a.kind === 'RESOURCE').length - delta);
  for (const a of grantedAttacks(state, inst)) {
    const need = (a.cost ?? []).reduce((s: number, e) => s + (e.amount ?? 0), 0) - effectiveAttackCostReduce(state, inst, a.cost, a);
    if ((a.damage ?? 0) > 0 && need <= pool) return true;
  }
  return false;
}

function retreatDesirability(state: MatchState, pIdx: PlayerId, active: CardInstance, prof: AiProfile): number {
  const opp = opponentOf(state, pIdx);
  let score = 0;
  if (opp.active) {
    const incoming = bestDamageOnto(state, opp.active, active);
    if (incoming >= currentHp(state, active)) score += 8; // seria KO (e pode ser derrota se a reserva estiver vazia)
    else if (incoming > 0) score += incoming / 25;
  }
  if (player(state, pIdx).bench.length === 0) score -= 6; // recuar para lugar nenhum
  if (active.damage > maxHp(state, active) * 0.7) score += 3.5;
  if (active.statuses.some((s) => s.tokens > 0 && (s.id === 'confusion' || s.id === 'sleep'))) score += 2;
  if (abilitiesBlocked(state, active)) score += 3; // silenciado/atordoado: trocar salva o turno
  // existe um atacante melhor na reserva?
  for (const b of player(state, pIdx).bench) {
    if (opp.active && bestDamageOnto(state, b, opp.active) > bestDamageOnto(state, active, opp.active)) score += 2;
    if (canUpgradeTo(state, b, b)) score += 0.5;
  }
  score *= (0.4 + prof.tempoWeight);
  void abilitiesBlocked; void isDefeated;
  return score;
}

void DEFAULT_PROFILE;
