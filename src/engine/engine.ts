import type {
  CardInstance, CharacterDef, ChoiceRequest, Command, CommandResult, LegalActions, MatchState, PlayerId, TargetSpec
} from './types';
import { registry } from './registry';
import {
  abilitiesBlocked, charDef, charactersInPlay, costSatisfied, defOf, equipmentSlots, findCard,
  grantedAttacks, maxHp, opponentOf, player, retreatCostOf
} from './queries';
import {
  abilityCheck, attackCostReduce as sharedAttackCostReduce, attachLimit as sharedAttachLimit,
  canAttack as sharedCanAttack, canDeployCharacter, canPayRetreat, canSeatAtSetup, canUpgradeTo,
  checkRestrictions, retreatCheck, ultimateCheck, isDirectlyDeployable
} from './rules';
import { emit } from './events';
import type { G } from './effects/shared';
import {
  applyDamage, applyStatusToChar, attachToChar, checkMatchEnd, drawCards, healChar, newCardInstance, performGeneratedUpgrade,
  performUpgrade, promoteToActive, queueGlobalTriggers, queueHostTriggers, resolveDefeats, retreatActive, shuffleDeck,
  tickStatuses, toBench, toDiscard, toHand
} from './effects/shared';
import { detachFromChar } from './effects/shared';
import { evalCondition, rand, targetCandidates } from './effects/core';
import { attackDamageTotal, getOp, payAttackCost, resolveAttackTargetGen, runSteps, scalingDamageFor } from './effects/ops';
import { createMatchState, type MatchOptions } from './state/setup';
import { computeLegalActions } from './validation';

class EngineError extends Error {}

interface Suspended {
  gen: Generator<ChoiceRequest, void, string[]>;
  request: ChoiceRequest;
}

export interface MatchEngineOptions extends MatchOptions {
  aiChooser?: (state: MatchState, req: ChoiceRequest) => string[];
}

/**
 * Authoritative match engine. The UI never mutates state directly — it sends
 * Commands and receives events + fresh legal-action snapshots.
 * The engine is UI-agnostic and can run headless (tests, AI, future server).
 */
export class MatchEngine {
  state: MatchState;
  version = 0;
  private pending: Suspended | null = null;
  private aiChooser: (req: ChoiceRequest) => string[];

  constructor(opts: MatchEngineOptions) {
    this.state = createMatchState(opts);
    const custom = opts.aiChooser;
    this.aiChooser = (req) => (custom ? custom(this.state, req) : defaultAiChoice(this.state, req));
    for (const p of this.state.players) this.dealOpeningHand(p.index);
    this.beginInteractiveMulligan(0);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Sends a command; returns ok/error plus the events emitted by it. */
  dispatch(cmd: Command): CommandResult {
    const seqBefore = this.state.eventSeq;
    if (cmd.type !== 'RESOLVE_CHOICE') this.pending = null;
    let result: CommandResult;
    try {
      const gen = this.execute(cmd);
      this.drive(gen);
      result = { ok: true, events: [] };
    } catch (e) {
      if (e instanceof EngineError) {
        result = { ok: false, error: e.message, events: [] };
      } else {
        throw e;
      }
    }
    result.events = this.eventsSince(seqBefore);
    this.version++;
    return result;
  }

  getPending(): ChoiceRequest | null {
    return this.pending?.request ?? null;
  }

  eventsSince(seq: number) {
    return this.state.log.filter((e) => e.seq > seq);
  }

  legalActions(playerIdx: PlayerId): LegalActions {
    return computeLegalActions(this.state, playerIdx, this.version);
  }

  g(): G {
    return { state: this.state, emit: (type, pl, payload) => emit(this.state, type, pl, payload) };
  }

  cloneState(): MatchState {
    return JSON.parse(JSON.stringify({ ...this.state, log: this.state.log.slice(-20) }));
  }

  // -------------------------------------------------------------------------
  // Choice driving (suspension for human decisions)
  // -------------------------------------------------------------------------

  private drive(gen: Generator<ChoiceRequest, void, string[]>): boolean {
    let r = gen.next();
    while (!r.done) {
      const req = r.value;
      if (this.state.players[req.player].isAI) {
        r = gen.next(this.aiChooser(req));
      } else {
        this.pending = { gen, request: req };
        emit(this.state, 'CHOICE_REQUESTED', req.player, { prompt: req.prompt, kind: req.kind, candidates: req.candidates });
        return false;
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  /**
   * Opening hand. With requireBasic the engine shuffles back and redraws until
   * an eligible starter (Base character) appears — `mulligan: 'auto'`. Bonus
   * draw (`mulliganBonusDraw`) gives the OPPONENT one extra card per redraw
   * past the first, compensating the mulliganing player's advantage.
   */
  private dealOpeningHand(pIdx: PlayerId): void {
    const cfg = this.state.config.setup;
    const g = this.g();
    const p = player(this.state, pIdx);
    const hasStarter = () => p.hand.some((c) => canSeatAtSetupStarter(c));
    let attempts = 0;
    while (!hasStarter() && cfg.requireBasic && attempts < 8) {
      p.deck.push(...p.hand);
      p.hand = [];
      shuffleDeck(g, pIdx);
      for (let i = 0; i < cfg.handSize; i++) {
        if (p.deck.length > 0) p.hand.push(p.deck.pop()!);
      }
      attempts++;
      if (cfg.mulliganBonusDraw && attempts > 1) {
        const opp = opponentOf(this.state, pIdx);
        if (opp.deck.length > 0) {
          const c = opp.deck.pop()!;
          opp.hand.push(c);
        }
      }
    }
    this.mulliganRedraws[pIdx] = attempts;
  }

  private mulliganRedraws: [number, number] = [0, 0];

  /**
   * Interactive mulligan: after the mandatory securing loop, each player may
   * VOLUNTARILY redraw once (`mulligan: 'interactive'`). Voluntary redraws give
   * the opponent a bonus draw when mulliganBonusDraw is on. AI players answer
   * automatically; humans get a pending choice resolved via RESOLVE_CHOICE.
   */
  private beginInteractiveMulligan(pIdx: PlayerId): void {
    const cfg = this.state.config.setup;
    if (this.state.phase !== 'setup') return;
    if (pIdx > 1) return;
    if (cfg.mulligan !== 'interactive') { this.beginInteractiveMulligan((pIdx + 1) as PlayerId); return; }
    const p = player(this.state, pIdx);
    if (p.isAI) { this.beginInteractiveMulligan((pIdx + 1) as PlayerId); return; }
    const gen = this.mulliganChoiceGen(pIdx);
    const r = gen.next();
    if (!r.done && r.value) {
      this.pending = { gen, request: r.value };
      emit(this.state, 'CHOICE_REQUESTED', r.value.player, { prompt: r.value.prompt, kind: r.value.kind, candidates: r.value.candidates });
    } else {
      this.beginInteractiveMulligan((pIdx + 1) as PlayerId);
    }
  }

  private *mulliganChoiceGen(pIdx: PlayerId): Generator<ChoiceRequest, void, string[]> {
    const cfg = this.state.config.setup;
    const p = player(this.state, pIdx);
    const answer = yield {
      kind: 'option', player: pIdx,
      prompt: cfg.requireBasic
        ? 'Deseja recomprar a mão inicial? (o oponente compra 1 carta bônus)'
        : 'Deseja recomprar a mão inicial?',
      candidates: ['recomprar', 'manter'],
      min: 1, max: 1, optional: false,
      labels: { recomprar: 'Recomprar mão', manter: 'Manter mão' }
    };
    if (answer?.[0] === 'recomprar') {
      const g = this.g();
      p.deck.push(...p.hand);
      p.hand = [];
      shuffleDeck(g, pIdx);
      for (let i = 0; i < cfg.handSize; i++) {
        if (p.deck.length > 0) p.hand.push(p.deck.pop()!);
      }
      this.mulliganRedraws[pIdx] += 1;
      if (cfg.mulliganBonusDraw) {
        const opp = opponentOf(this.state, pIdx);
        if (opp.deck.length > 0) opp.hand.push(opp.deck.pop()!);
      }
      // Re-secure a starter if required
      let guard = 0;
      while (cfg.requireBasic && !p.hand.some((c) => canSeatAtSetupStarter(c)) && guard++ < 8) {
        p.deck.push(...p.hand);
        p.hand = [];
        shuffleDeck(g, pIdx);
        for (let i = 0; i < cfg.handSize; i++) {
          if (p.deck.length > 0) p.hand.push(p.deck.pop()!);
        }
        this.mulliganRedraws[pIdx] += 1;
      }
    }
    this.beginInteractiveMulligan((pIdx + 1) as PlayerId);
  }

  // -------------------------------------------------------------------------
  // Turn machinery
  // -------------------------------------------------------------------------

  private *startTurnGen(): Generator<ChoiceRequest, void, string[]> {
    const g = this.g();
    const steps = this.state.config.turn.steps;
    emit(this.state, 'TURN_STARTED', this.state.activePlayer, { turn: this.state.turn });

    this.state.tempMods = this.state.tempMods.filter((tm) => !(tm.scope === 'nextTurn' && tm.owner === this.state.activePlayer));
    this.state.fieldOverrides = this.state.fieldOverrides.filter((ov) => ov.expiresTurn === undefined || ov.expiresTurn > this.state.turn);

    const p = player(this.state, this.state.activePlayer);
    p.attachedThisTurn = 0;
    p.retreatedThisTurn = 0;
    p.actionsPlayedTurn = [];
    for (const c of charactersInPlay(this.state, p.index)) {
      c.usedTurn = [];
      for (const a of c.attached) a.usedTurn = [];
    }

    if (steps.includes('start')) {
      // Player with no active (requireBasic=false start): promote from bench or lose.
      if (!p.active) {
        if (p.bench.length > 0) {
          promoteToActive(g, p.bench[0]);
        } else if (this.state.config.victory.noActiveLoses) {
          const enemy = (p.index === 0 ? 1 : 0) as PlayerId;
          this.state.winner = enemy;
          this.state.endReason = 'no_active';
          this.state.phase = 'gameOver';
          emit(this.state, 'MATCH_ENDED', enemy, { reason: 'no_active' });
          return;
        }
      }
      queueGlobalTriggers(g, 'turnStart');
      yield* this.drainTriggers();
      if (this.state.winner !== null) return;
      tickStatuses(g, p.index, 'turnStartOwner');
      yield* resolveDefeats(g);
      if (this.state.winner !== null) return;
    }
    if (steps.includes('draw')) {
      drawCards(g, p.index, this.state.config.turn.drawAmount + this.drawExtraFor(p.index));
    }
    if (steps.includes('main')) {
      this.state.phase = 'main';
    } else {
      this.state.phase = 'main';
    }
  }

  private drawExtraFor(pIdx: PlayerId): number {
    let extra = 0;
    for (const f of this.state.fields) {
      const fd = defOf(f) as any;
      if (fd.scope === 'owner' && f.owner !== pIdx) continue;
      extra += fd.mods?.drawExtra ?? 0;
    }
    for (const tm of this.state.tempMods) {
      if (tm.targetUid) continue;
      if (tm.owner !== pIdx) continue;
      extra += tm.mods.drawExtra ?? 0;
    }
    return extra;
  }

  private *endTurnGen(): Generator<ChoiceRequest, void, string[]> {
    const g = this.g();
    const p = player(this.state, this.state.activePlayer);
    emit(this.state, 'TURN_ENDED', p.index, { turn: this.state.turn });

    queueGlobalTriggers(g, 'turnEnd');
    yield* this.drainTriggers();
    tickStatuses(g, p.index, 'turnEndOwner');
    yield* resolveDefeats(g);
    if (this.state.winner !== null) return;

    this.state.tempMods = this.state.tempMods.filter((tm) => tm.scope !== 'thisTurn');
    p.attachedThisTurn = 0;
    p.retreatedThisTurn = 0;
    p.actionsPlayedTurn = [];
    for (const c of charactersInPlay(this.state, p.index)) c.usedTurn = [];

    this.state.activePlayer = (this.state.activePlayer === 0 ? 1 : 0) as PlayerId;
    this.state.turn += 1;
    yield* this.startTurnGen();
  }

  // -------------------------------------------------------------------------
  // Trigger draining
  // -------------------------------------------------------------------------

  private static SUBJECT_ONLY = new Set(['onPlay', 'onUpgrade', 'onDamaged', 'onHealed', 'onLeavePlay', 'beforeAttack', 'afterAttack', 'onResourceAttached']);
  private static BROADCAST = new Set(['onAllyEnter', 'onAllyDefeated', 'onEnemyDefeated', 'turnStart', 'turnEnd']);

  private *drainTriggers(): Generator<ChoiceRequest, void, string[]> {
    const g = this.g();
    for (let guard = 0; guard < 64; guard++) {
      if (this.state.winner !== null) return;
      const task = this.state.triggerQueue.shift();
      if (!task) return;
      if (task.event === '__runOnAttach') {
        const found = findCard(this.state, task.sourceUid);
        if (!found) continue;
        const rd = defOf(found.card) as any;
        if (rd.onAttach) {
          yield* runSteps(g, { sourceUid: task.sourceUid, sourcePlayer: task.player, bound: {}, hostUid: task.hostUid, depth: 0 }, rd.onAttach);
        }
        continue;
      }
      const candidates = this.matchingAbilities(task);
      for (const { host, ability, abilityOwner } of candidates) {
        if (this.state.winner !== null) return;
        if (ability.oncePerTurn && host.usedTurn.includes(`ability:${ability.id}`)) continue;
        if (ability.oncePerMatch && host.usedMatch.includes(`ability:${ability.id}`)) continue;
        if (host.kind === 'CHARACTER' && abilitiesBlocked(this.state, host)) continue;
        const ctx = { sourceUid: host.uid, sourcePlayer: abilityOwner, bound: {}, depth: 0, hostUid: this.hostOf(host) };
        if (!evalCondition(this.state, ctx, ability.condition)) continue;
        if (!ability.effects || ability.effects.length === 0) continue;
        host.usedTurn.push(`ability:${ability.id}`);
        host.usedMatch.push(`ability:${ability.id}`);
        emit(this.state, 'ABILITY_ACTIVATED', abilityOwner, { uid: host.uid, abilityId: ability.id, trigger: task.event, passive: true });
        yield* runSteps(g, ctx, ability.effects);
      }
    }
  }

  private hostOf(inst: CardInstance): string | undefined {
    const found = findCard(this.state, inst.uid);
    if (found?.location === 'attached') return found.hostUid;
    return undefined;
  }

  private matchingAbilities(task: { event: string; sourceUid: string; player: PlayerId }): { host: CardInstance; ability: any; abilityOwner: PlayerId }[] {
    const out: { host: CardInstance; ability: any; abilityOwner: PlayerId }[] = [];
    const subjectOnly = MatchEngine.SUBJECT_ONLY.has(task.event);
    const broadcast = MatchEngine.BROADCAST.has(task.event);
    const consider = (inst: CardInstance, owner: PlayerId, triggers: any[]) => {
      for (const ab of triggers) {
        if (ab.trigger !== task.event) continue;
        if (ab.trigger === 'activated') continue;
        if (subjectOnly && inst.uid !== task.sourceUid) continue;
        if (broadcast && inst.uid === task.sourceUid) continue; // don't react to own broadcast events
        out.push({ host: inst, ability: ab, abilityOwner: owner });
      }
    };
    for (const p of this.state.players) {
      for (const c of charactersInPlay(this.state, p.index)) {
        consider(c, p.index, charDef(c).abilities as any[]);
        for (const eq of c.attached) {
          if (eq.kind === 'EQUIPMENT') consider(eq, p.index, (defOf(eq) as any).triggers ?? []);
        }
      }
      for (const f of this.state.fields) {
        consider(f, p.index, (defOf(f) as any).triggers ?? []);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Command execution
  // -------------------------------------------------------------------------

  private *execute(cmd: Command): Generator<ChoiceRequest, void, string[]> {
    if (cmd.type === 'RESOLVE_CHOICE') {
      const pending = this.pending;
      if (!pending) return;
      if (pending.request.player !== cmd.player) throw new EngineError('not_your_choice');
      this.pending = null;
      let r = pending.gen.next(cmd.selected);
      while (!r.done) {
        const req = r.value;
        if (this.state.players[req.player].isAI) r = pending.gen.next(this.aiChooser(req));
        else { this.pending = { gen: pending.gen, request: req }; emit(this.state, 'CHOICE_REQUESTED', req.player, { prompt: req.prompt, kind: req.kind, candidates: req.candidates }); return; }
      }
      return;
    }
    if (this.pending) throw new EngineError('choice_pending');

    switch (cmd.type) {
      case 'SETUP_SET_ACTIVE': yield* this.setupSetActive(cmd.player, cmd.uid); break;
      case 'SETUP_BENCH': yield* this.setupBench(cmd.player, cmd.uid); break;
      case 'SETUP_DONE': yield* this.setupDone(cmd.player); break;
      case 'DEPLOY_CHARACTER': yield* this.deployCharacter(cmd.player, cmd.uid); break;
      case 'ATTACH_RESOURCE': yield* this.attachResource(cmd.player, cmd.uid, cmd.targetUid); break;
      case 'UPGRADE': yield* this.upgrade(cmd.player, cmd.uid, cmd.targetUid); break;
      case 'PLAY_ACTION': yield* this.playAction(cmd.player, cmd.uid); break;
      case 'PLAY_EQUIPMENT': yield* this.playEquipment(cmd.player, cmd.uid, cmd.targetUid); break;
      case 'PLAY_FIELD': yield* this.playField(cmd.player, cmd.uid); break;
      case 'USE_ABILITY': yield* this.useAbility(cmd.player, cmd.charUid, cmd.abilityId); break;
      case 'USE_ULTIMATE': yield* this.useUltimate(cmd.player, cmd.charUid, cmd.ultimateId); break;
      case 'ATTACK': yield* this.attack(cmd.player, cmd.attackId); break;
      case 'RETREAT': yield* this.retreat(cmd.player, cmd.benchUid); break;
      case 'END_TURN': yield* this.endTurn(cmd.player); break;
      case 'CONCEDE': this.concede(cmd.player); break;
      default: throw new EngineError('unknown_command');
    }
    if (this.state.phase !== 'setup') {
      yield* this.drainTriggers();
      checkMatchEnd(this.g());
    }
  }

  private assertTurn(pIdx: PlayerId): void {
    if (this.state.phase === 'gameOver') throw new EngineError('game_over');
    if (this.state.phase !== 'setup' && this.state.activePlayer !== pIdx) throw new EngineError('not_your_turn');
  }

  private *setupSetActive(pIdx: PlayerId, uid: string): Generator<ChoiceRequest, void, string[]> {
    if (this.state.phase !== 'setup') throw new EngineError('not_setup');
    const p = player(this.state, pIdx);
    const card = p.hand.find((c) => c.uid === uid);
    if (!card || card.kind !== 'CHARACTER') throw new EngineError('not_a_character');
    if (!isDirectlyDeployable(card)) throw new EngineError('must_start_with_base');
    if (p.active) toHand(this.g(), p.active, pIdx);
    p.active = card;
    p.hand = p.hand.filter((c) => c.uid !== uid);
    emit(this.state, 'ACTIVE_SET', pIdx, { uid });
  }

  private *setupBench(pIdx: PlayerId, uid: string): Generator<ChoiceRequest, void, string[]> {
    if (this.state.phase !== 'setup') throw new EngineError('not_setup');
    const p = player(this.state, pIdx);
    const card = p.hand.find((c) => c.uid === uid);
    if (!card || card.kind !== 'CHARACTER') throw new EngineError('not_a_character');
    const check = canSeatAtSetup(this.state, pIdx, card);
    if (!check.ok) throw new EngineError(check.reason ?? 'setup_bench_disabled');
    toBench(this.g(), card, pIdx);
    emit(this.state, 'CHARACTER_DEPLOYED', pIdx, { uid, setup: true });
  }

  private *setupDone(pIdx: PlayerId): Generator<ChoiceRequest, void, string[]> {
    if (this.state.phase !== 'setup') throw new EngineError('not_setup');
    const p = player(this.state, pIdx);
    if (!p.active && this.state.config.setup.requireBasic) throw new EngineError('no_active');
    p.setupDone = true;
    if (this.state.players[0].setupDone && this.state.players[1].setupDone) {
      this.state.startingPlayer = rand(this.state) < 0.5 ? 0 : 1;
      this.state.activePlayer = this.state.startingPlayer;
      this.state.turn = 1;
      emit(this.state, 'MATCH_STARTED', this.state.startingPlayer, { startingPlayer: this.state.startingPlayer });
      yield* this.startTurnGen();
    }
  }

  private *deployCharacter(pIdx: PlayerId, uid: string): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    if (this.state.phase !== 'main') throw new EngineError('not_main');
    const p = player(this.state, pIdx);
    const card = p.hand.find((c) => c.uid === uid);
    if (!card || card.kind !== 'CHARACTER') throw new EngineError('not_a_character');
    // Only Base (stage 0) characters can be deployed directly; higher stages
    // REQUIRE an Upgrade card. (Effect-driven deploys are the explicit bypass.)
    const check = canDeployCharacter(this.state, pIdx, card);
    if (!check.ok) throw new EngineError(check.reason ?? 'must_upgrade_not_deploy');
    toBench(this.g(), card, pIdx);
    emit(this.state, 'CHARACTER_DEPLOYED', pIdx, { uid });
    this.state.triggerQueue.push({ event: 'onPlay', sourceUid: uid, player: pIdx });
    this.state.triggerQueue.push({ event: 'onAllyEnter', sourceUid: uid, player: pIdx });
  }

  private attachLimitFor(pIdx: PlayerId): number {
    return sharedAttachLimit(this.state, pIdx);
  }

  private *attachResource(pIdx: PlayerId, uid: string, targetUid: string): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    if (this.state.phase !== 'main') throw new EngineError('not_main');
    const p = player(this.state, pIdx);
    const card = p.hand.find((c) => c.uid === uid);
    if (!card || card.kind !== 'RESOURCE') throw new EngineError('not_a_resource');
    if (p.attachedThisTurn >= this.attachLimitFor(pIdx)) throw new EngineError('attach_limit');
    const target = findCard(this.state, targetUid);
    if (!target || (target.location !== 'active' && target.location !== 'bench')) throw new EngineError('no_valid_target');
    if (target.card.owner !== pIdx) throw new EngineError('not_your_character');
    attachToChar(this.g(), card, target.card);
    p.attachedThisTurn++;
    this.state.triggerQueue.push({ event: 'onResourceAttached', sourceUid: targetUid, player: pIdx, payload: { resourceUid: uid } });
    this.state.triggerQueue.push({ event: '__runOnAttach', sourceUid: uid, hostUid: targetUid, player: pIdx });
  }

  /**
   * Upgrade with REAL instance conservation: the upgrade card leaves the hand
   * and is pushed onto the host's progression stack. No new instance is
   * created, nothing is cloned and nothing is discarded here.
   */
  private *upgrade(pIdx: PlayerId, uid: string, targetUid: string): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    if (this.state.phase !== 'main') throw new EngineError('not_main');
    const p = player(this.state, pIdx);
    const card = p.hand.find((c) => c.uid === uid);
    if (!card || card.kind !== 'CHARACTER') throw new EngineError('not_a_character');
    const target = findCard(this.state, targetUid);
    if (!target || (target.location !== 'active' && target.location !== 'bench')) throw new EngineError('no_valid_target');
    if (target.card.owner !== pIdx) throw new EngineError('not_your_character');
    const check = canUpgradeTo(this.state, target.card, card);
    if (!check.ok) throw new EngineError(check.reason ?? 'invalid_upgrade');
    performUpgrade(this.g(), target.card, card, { cause: 'card' });
  }

  private checkActionRestrictions(pIdx: PlayerId, def: any): void {
    const check = checkRestrictions(this.state, pIdx, def);
    if (!check.ok) throw new EngineError(check.reason ?? 'restriction_condition');
  }

  private *playAction(pIdx: PlayerId, uid: string): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    if (this.state.phase !== 'main') throw new EngineError('not_main');
    const p = player(this.state, pIdx);
    const card = p.hand.find((c) => c.uid === uid);
    if (!card || card.kind !== 'ACTION') throw new EngineError('not_an_action');
    const def = defOf(card) as any;
    this.checkActionRestrictions(pIdx, def);
    p.actionsPlayedTurn.push(def.id);
    this.state.resolvingCardUid = uid;
    emit(this.state, 'ACTION_PLAYED', pIdx, { uid, defId: card.defId });
    yield* runSteps(this.g(), { sourceUid: uid, sourcePlayer: pIdx, bound: {}, depth: 0 }, def.effects);
    this.state.resolvingCardUid = null;
    toDiscard(this.g(), card, pIdx);
  }

  private *playEquipment(pIdx: PlayerId, uid: string, targetUid: string): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    if (this.state.phase !== 'main') throw new EngineError('not_main');
    const p = player(this.state, pIdx);
    const card = p.hand.find((c) => c.uid === uid);
    if (!card || card.kind !== 'EQUIPMENT') throw new EngineError('not_an_equipment');
    const target = findCard(this.state, targetUid);
    if (!target || (target.location !== 'active' && target.location !== 'bench')) throw new EngineError('no_valid_target');
    if (target.card.owner !== pIdx) throw new EngineError('not_your_character');
    if (target.card.attached.filter((a) => a.kind === 'EQUIPMENT').length >= equipmentSlots(this.state, target.card)) throw new EngineError('no_slots');
    attachToChar(this.g(), card, target.card);
    const ed = defOf(card) as any;
    for (const tr of ed.triggers ?? []) {
      if (tr.trigger === 'onPlay') {
        this.state.triggerQueue.push({ event: 'onPlay', sourceUid: card.uid, hostUid: targetUid, player: pIdx });
      }
    }
  }

  private *playField(pIdx: PlayerId, uid: string): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    if (this.state.phase !== 'main') throw new EngineError('not_main');
    const p = player(this.state, pIdx);
    const card = p.hand.find((c) => c.uid === uid);
    if (!card || card.kind !== 'FIELD') throw new EngineError('not_a_field');
    while (this.state.fields.length >= this.state.config.board.fieldSlots) {
      const old = this.state.fields.shift()!;
      emit(this.state, 'FIELD_REPLACED', old.owner, { uid: old.uid, defId: old.defId });
      toDiscard(this.g(), old, old.owner);
      this.state.fieldOverrides = this.state.fieldOverrides.filter((ov) => ov.sourceUid !== old.uid);
    }
    p.hand = p.hand.filter((c) => c.uid !== uid);
    this.state.fields.push(card);
    emit(this.state, 'FIELD_PLAYED', pIdx, { uid, defId: card.defId });
    const fd = defOf(card) as any;
    if (fd.onPlay) {
      yield* runSteps(this.g(), { sourceUid: uid, sourcePlayer: pIdx, bound: {}, depth: 0 }, fd.onPlay);
    }
    if (fd.override) {
      this.state.fieldOverrides.push({
        id: `ov-${card.uid}`,
        sourceUid: card.uid,
        owner: pIdx,
        override: fd.override,
        expiresTurn: fd.override.durationTurns ? this.state.turn + fd.override.durationTurns : undefined,
        blockSwitching: fd.override.blockSwitching,
        blockRetreat: fd.override.blockRetreat,
        disableAbilities: fd.override.disableAbilities,
        attackCostMod: fd.override.attackCostMod,
        retreatCostMod: fd.override.retreatCostMod,
        attachExtra: fd.override.attachExtra,
        damageMultAll: fd.override.damageMultAll
      } as any);
    }
    for (const tr of fd.triggers ?? []) {
      if (tr.trigger === 'onPlay') this.state.triggerQueue.push({ event: 'onPlay', sourceUid: uid, player: pIdx });
    }
  }

  private *useAbility(pIdx: PlayerId, charUid: string, abilityId: string): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    if (this.state.phase !== 'main') throw new EngineError('not_main');
    const target = findCard(this.state, charUid);
    if (!target || (target.location !== 'active' && target.location !== 'bench')) throw new EngineError('no_valid_target');
    const inst = target.card;
    if (inst.owner !== pIdx) throw new EngineError('not_your_character');
    const cd = charDef(inst);
    const ability = cd.abilities.find((a) => a.id === abilityId);
    if (!ability) throw new EngineError('unknown_ability');
    if (ability.trigger !== 'activated') throw new EngineError('not_activated');
    const check = abilityCheck(this.state, pIdx, inst, ability);
    if (!check.ok) throw new EngineError(check.reason ?? 'condition_not_met');
    const ctx = { sourceUid: inst.uid, sourcePlayer: pIdx, bound: {}, depth: 0 };
    if (ability.cost && ability.cost.some((c) => c.amount > 0)) {
      const reduce = Math.max(0, this.attackCostReduceFor(inst));
      if (!costSatisfied(inst, ability.cost, reduce)) throw new EngineError('not_enough_resources');
      payAttackCost(this.g(), inst, ability.cost, reduce);
    }
    inst.usedTurn.push(`ability:${ability.id}`);
    inst.usedMatch.push(`ability:${ability.id}`);
    emit(this.state, 'ABILITY_ACTIVATED', pIdx, { uid: inst.uid, abilityId, passive: false });
    yield* runSteps(this.g(), ctx, ability.effects);
  }

  /** Suprema: poder único por partida, condicionado e com custo — 100% data-driven. */
  private *useUltimate(pIdx: PlayerId, charUid: string, ultimateId: string): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    if (this.state.phase !== 'main') throw new EngineError('not_main');
    const target = findCard(this.state, charUid);
    if (!target || (target.location !== 'active' && target.location !== 'bench')) throw new EngineError('no_valid_target');
    const inst = target.card;
    if (inst.owner !== pIdx) throw new EngineError('not_your_character');
    const ult = charDef(inst).ultimate;
    if (!ult || ult.id !== ultimateId) throw new EngineError('unknown_ability');
    const check = ultimateCheck(this.state, pIdx, inst, ult);
    if (!check.ok) throw new EngineError(check.reason ?? 'condition_not_met');
    const ctx = { sourceUid: inst.uid, sourcePlayer: pIdx, bound: {}, depth: 0 };
    if (ult.cost && ult.cost.some((c) => c.amount > 0)) {
      const reduce = Math.max(0, this.attackCostReduceFor(inst));
      if (!costSatisfied(inst, ult.cost, reduce)) throw new EngineError('not_enough_resources');
      payAttackCost(this.g(), inst, ult.cost, reduce);
    }
    inst.usedMatch.push(`ultimate:${ult.id}`);
    emit(this.state, 'ABILITY_ACTIVATED', pIdx, { uid: inst.uid, abilityId: ult.id, ultimate: true });
    yield* runSteps(this.g(), ctx, ult.effects);
  }

  private attackCostReduceFor(inst: CardInstance): number {
    return sharedAttackCostReduce(this.state, inst);
  }

  canAttackNow(inst: CardInstance): { ok: boolean; reason?: string } {
    return sharedCanAttack(this.state, inst);
  }

  private *attack(pIdx: PlayerId, attackId: string): Generator<ChoiceRequest, void, string[]> {
    const g = this.g();
    const st = this.state;
    this.assertTurn(pIdx);
    const active = player(st, pIdx).active;
    if (!active) throw new EngineError('no_active');
    const check = this.canAttackNow(active);
    if (!check.ok) throw new EngineError(check.reason ?? 'cannot_attack');
    const attack = grantedAttacks(this.state, active).find((a) => a.id === attackId);
    if (!attack) throw new EngineError('unknown_attack');
    const ctx = { sourceUid: active.uid, sourcePlayer: pIdx, bound: { attacker: active.uid } as Record<string, string>, depth: 0 };
    if (attack.condition && !evalCondition(st, ctx, attack.condition)) throw new EngineError('condition_not_met');
    const costReduce = Math.max(0, this.attackCostReduceFor(active));
    if (!costSatisfied(active, attack.cost, costReduce)) throw new EngineError('not_enough_resources');
    if (!payAttackCost(g, active, attack.cost, costReduce)) throw new EngineError('not_enough_resources');

    emit(st, 'ATTACK_USED', pIdx, { uid: active.uid, attackId, defId: active.defId });
    queueHostTriggers(g, active, 'beforeAttack');
    yield* this.drainTriggers();
    if (st.winner !== null) return;

    // Confusion: chance to hurt yourself and end the confusion
    if (active.statuses.some((s) => s.id === 'confusion') && rand(st) < 0.3) {
      applyDamage(g, active, 20, { label: 'confusão', attackerUid: active.uid });
      active.statuses = active.statuses.filter((s) => s.id !== 'confusion');
      emit(st, 'STATUS_REMOVED', pIdx, { uid: active.uid, status: 'confusion' });
      yield* resolveDefeats(g);
      if (st.config.turn.attackEndsTurn && st.winner === null && st.phase === 'main') yield* this.endTurnGen();
      return;
    }

    // copyAttack support
    let effAttack: any = attack;
    const copyFrom = ctx.bound['__copyAttackFrom'];
    if (copyFrom) {
      const src = findCard(st, copyFrom)?.card;
      if (src && src.kind === 'CHARACTER') {
        const cd = charDef(src);
        if (cd.attacks[0]) effAttack = { ...cd.attacks[0], cost: [] };
      }
    }

    const target = yield* resolveAttackTargetGen(g, ctx, effAttack);
    if (!target) return;
    ctx.bound['defender'] = target.uid;

    const baseDamage = scalingDamageFor(g, active, effAttack);
    let finalDamage = 0;
    if (baseDamage > 0) {
      const { total } = attackDamageTotal(g, active, target, effAttack, { isAttack: true });
      finalDamage = total;
    }
    st.lastAttack = { attackerUid: active.uid, attackId: effAttack.id, damage: finalDamage, targetUids: [target.uid] };
    emit(st, 'DAMAGE_DEALT', pIdx, { preview: true, attackerUid: active.uid, targetUid: target.uid, amount: finalDamage });

    if (effAttack.effectsBefore) yield* runSteps(g, ctx, effAttack.effectsBefore);
    if (finalDamage > 0) {
      applyDamage(g, target, finalDamage, {
        isAttack: true,
        affinity: effAttack.affinity ?? charDef(active).affinity,
        attackerUid: active.uid,
        label: effAttack.name
      });
    }
    if (effAttack.selfDamage) {
      applyDamage(g, active, effAttack.selfDamage, { label: 'recuo', attackerUid: active.uid });
    }
    if (effAttack.effects) yield* runSteps(g, ctx, effAttack.effects);
    queueHostTriggers(g, active, 'afterAttack');
    st.tempMods = st.tempMods.filter((tm) => tm.scope !== 'nextAttack');
    yield* resolveDefeats(g);
    if (st.config.turn.attackEndsTurn && st.winner === null && st.phase === 'main') {
      yield* this.endTurnGen();
    }
  }

  private *retreat(pIdx: PlayerId, benchUid: string): Generator<ChoiceRequest, void, string[]> {
    const g = this.g();
    const st = this.state;
    this.assertTurn(pIdx);
    const p = player(st, pIdx);
    const check = retreatCheck(st, pIdx);
    if (!check.ok) throw new EngineError(check.reason ?? 'cannot_retreat');
    const benchChar = p.bench.find((c) => c.uid === benchUid);
    if (!benchChar) throw new EngineError('no_valid_target');
    const activeChar = p.active!;
    const cost = retreatCostOf(st, activeChar);
    if (cost > 0) {
      const pool = activeChar.attached.filter((a) => a.kind === 'RESOURCE');
      const order = (a: CardInstance) => {
        const rd = defOf(a) as any;
        return (rd.temporary ? 0 : 2) + (rd.wild ? 0 : 1);
      };
      pool.sort((a, b) => order(a) - order(b));
      if (pool.length < cost) throw new EngineError('not_enough_resources');
      for (let i = 0; i < cost; i++) detachFromChar(g, pool[i], 'discard');
    }
    p.retreatedThisTurn++;
    retreatActive(g, benchChar);
  }

  private *endTurn(pIdx: PlayerId): Generator<ChoiceRequest, void, string[]> {
    this.assertTurn(pIdx);
    yield* this.endTurnGen();
  }

  private concede(pIdx: PlayerId): void {
    if (this.state.phase === 'gameOver') return;
    this.state.winner = (pIdx === 0 ? 1 : 0) as PlayerId;
    this.state.endReason = 'concede';
    this.state.phase = 'gameOver';
    emit(this.state, 'MATCH_ENDED', this.state.winner, { reason: 'concede' });
  }

  /** Debug helpers (exposed through the debug panel in dev mode only). */
  debugCommand(op: string, payload: Record<string, unknown>): CommandResult {
    const seqBefore = this.state.eventSeq;
    const g = this.g();
    try {
      runDebugOp(g, op, payload);
      this.version++;
    } catch (e) {
      return { ok: false, error: (e as Error).message, events: this.eventsSince(seqBefore) };
    }
    return { ok: true, events: this.eventsSince(seqBefore) };
  }
}

// ---------------------------------------------------------------------------
// Default AI choice resolution (heuristic target picking)
// ---------------------------------------------------------------------------

export function defaultAiChoice(state: MatchState, req: ChoiceRequest): string[] {
  if (req.kind === 'option') return [req.candidates[req.candidates.length - 1]];
  const score = (uid: string): number => {
    const found = findCard(state, uid);
    if (!found) return 0;
    const c = found.card;
    if (c.kind !== 'CHARACTER') return 1;
    const hpFrac = 1 - c.damage / Math.max(1, maxHp(state, c));
    return charDef(c).victoryValue * 2 + hpFrac;
  };
  const sorted = [...req.candidates].sort((a, b) => score(b) - score(a));
  const maxN = req.max;
  const want = Math.max(req.optional ? 0 : req.min, Math.min(maxN, sorted.length));
  return sorted.slice(0, want);
}

// ---------------------------------------------------------------------------
// Debug ops (dev builds only — reachable through the debug panel)
// ---------------------------------------------------------------------------

/** Opening-hand starter eligibility (Base character, seatable at setup). */
function canSeatAtSetupStarter(card: CardInstance): boolean {
  return card.kind === 'CHARACTER' && charDef(card).stage === 0;
}

function runDebugOp(g: G, op: string, p: Record<string, unknown>): void {
  const state = g.state;
  const me = player(state, (p.player as PlayerId) ?? 0);
  switch (op) {
    case 'draw':
      drawCards(g, me.index, (p.amount as number) ?? 1);
      break;
    case 'addCardToHand': {
      const def = registry.card(p.defId as string);
      me.hand.push(newCardInstance(g, def, me.index));
      break;
    }
    case 'spawnCharacter': {
      const def = registry.card(p.defId as string) as CharacterDef;
      const owner = (p.owner as PlayerId) ?? me.index;
      toBench(g, newCardInstance(g, def, owner), owner);
      break;
    }
    case 'giveResource': {
      const target = findCard(state, p.targetUid as string);
      if (target) {
        const def = registry.card(p.defId as string);
        attachToChar(g, newCardInstance(g, def, target.card.owner), target.card);
      }
      break;
    }
    case 'setHp': {
      const t = findCard(state, p.targetUid as string);
      if (t?.card.kind === 'CHARACTER') t.card.damage = Math.max(0, p.value as number);
      break;
    }
    case 'damage': {
      const t = findCard(state, p.targetUid as string);
      if (t) applyDamage(g, t.card, (p.amount as number) ?? 10, { label: 'debug' });
      break;
    }
    case 'heal': {
      const t = findCard(state, p.targetUid as string);
      if (t) healChar(g, t.card, (p.amount as number) ?? 10);
      break;
    }
    case 'applyStatus': {
      const t = findCard(state, p.targetUid as string);
      if (t?.card.kind === 'CHARACTER') {
        applyStatusToChar(g, t.card, p.statusId as string, (p.tokens as number) ?? 2, 1);
      }
      break;
    }
    case 'forceUpgrade': {
      const t = findCard(state, p.targetUid as string);
      if (t?.card.kind === 'CHARACTER') {
        const cd = charDef(t.card);
        const next = (cd.upgradesTo ?? [])[0];
        if (next) performGeneratedUpgrade(g, t.card, next, { cause: 'debug' });
      }
      break;
    }
    case 'swapActive': {
      const uid = p.targetUid as string;
      const cand = me.bench.find((c) => c.uid === uid);
      if (cand && me.active && !state.fieldOverrides.some((o) => o.blockSwitching || o.blockRetreat)) {
        retreatActive(g, cand);
      }
      break;
    }
    case 'setVp': {
      me.victoryPoints = Math.max(0, p.value as number);
      break;
    }
    case 'triggerAbility': {
      const t = findCard(state, p.targetUid as string);
      if (t) state.triggerQueue.push({ event: (p.event as string) ?? 'turnStart', sourceUid: t.card.uid, player: t.card.owner });
      break;
    }
    default:
      throw new Error(`Debug op desconhecido: ${op}`);
  }
}
