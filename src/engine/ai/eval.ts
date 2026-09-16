/**
 * AVALIADOR DA IA — modelo de valor de efeitos (estado PÚBLICO apenas).
 *
 * Existe para um único motivo: no 2.0 o `actionScore` da IA conhecia quatro
 * operações (`drawCards`, `dealDamage`, `heal`, `searchDeck`…) e dava +1 para
 * qualquer coisa desconhecida. Numa coleção onde o poder mora em
 * `conditionalEffect`, `applyStatus`, `forceEnemySwitch`, `detachResource` e
 * `coinFlip`, isso significava "a IA não sabe jogar decks condicionais" — e o
 * meta-sim punia esses baralhos duas vezes (carta fraca + avaliador burro).
 *
 * Regras que este módulo NUNCA quebra:
 *  - só lê o estado público + a mão/próprios recursos de `me` (nunca a mão ou a
 *    ordem do deck do oponente, nunca RNG futuro);
 *  - não ganha recurso, não ignora custo, não escolhe jogada ilegal — quem
 *    decide a legalidade é `rules.ts`; aqui só se pontua o que já é legal;
 *  - é determinístico: mesmo estado + mesmo perfil ⇒ mesmo número.
 *
 * Unidades: 1 ponto ≈ 8 de dano (a mesma escala do `attackScore` histórico),
 * KO do Agente Ativo inimigo ≈ 8 + 3·PV. Perfis fracos (matchupKnowledge baixo)
 * recebem valores *menores* para jogadas sutis — é assim que "fácil" vira um
 * jogador realmente pior, sem trapaça e sem aleatoriedade pura.
 */

import type { AiProfile } from './profile';
import type { CardInstance, ConditionSpec, EffectStep, MatchState, PlayerId, ResourceCost } from '../types';
import {
  abilitiesBlocked, aggregateMods, cannotRetreat, charDef, charactersInPlay, costSatisfied,
  currentHp, defOf, findCard, grantedAttacks, isDefeated, maxHp, opponentOf, player, retreatCostOf
} from '../queries';
import { effectiveAttackCostReduce } from '../rules';
import { registry } from '../registry';

/** Operações que o avaliador conhece. `tests/jet-ai-eval.test.ts` trava que todo
 *  op usado pelo Core Set está aqui (senão a carta é invisível para a IA). */
export const KNOWN_OPS: ReadonlySet<string> = new Set([
  'drawCards', 'dealDamage', 'heal', 'applyStatus', 'removeStatus', 'attachResource', 'detachResource',
  'detachEquipment', 'transferResource', 'searchDeck', 'retrieveFromDiscard', 'shuffleIntoDeck', 'shuffleDeck',
  'discardCards', 'mill', 'moveCard', 'returnToHand', 'reviveCharacter', 'switchActive', 'forceEnemySwitch',
  'increaseDamage', 'reduceDamage', 'modifyStat', 'modifyCost', 'modifyVictoryPoints', 'coinFlip',
  'conditionalEffect', 'repeatEffect', 'copyAttack', 'tempMod', 'createTemporaryEffect', 'disableAbility',
  'deployCharacter', 'upgradeCharacter', 'addCounter', 'chooseOption', 'chooseTarget', 'randomTarget'
]);

export interface EvalCtx {
  state: MatchState;
  me: PlayerId;
  prof: AiProfile;
  /** Agente que executa (ataque/habilidade) — quando houver. */
  actor?: CardInstance | null;
  /**
   * Pré-computado UMA vez por decisão: o ganho de "alvo marcado" varre a mão
   * inteira, e `effectsValue` roda dentro de CLONES de lookahead — sem cache,
   * um único turno custava O(opções × passos × mão) e o simulador chegava a
   * >60 s por jogo (inviável para 4096 jogos e para o Worker do Ranked).
   */
  markedPayoff?: number;
}

/** Estado "planejado" dentro de um mesmo card: status que os passos anteriores já aplicam. */
export interface StepPlan {
  markedEnemy: boolean;
  enemyExhausted: boolean;
  statusesRemoved: boolean;
  energyTaken: number;
  damageSoFar: number;
}

export const emptyPlan = (): StepPlan => ({
  markedEnemy: false, enemyExhausted: false, statusesRemoved: false, energyTaken: 0, damageSoFar: 0
});

// ---------------------------------------------------------------------------
// Primitivas de leitura (só informação pública)
// ---------------------------------------------------------------------------

/** Dano esperado do melhor ataque pagável de `attacker` contra `target`. */
export function bestDamageOnto(state: MatchState, attacker: CardInstance, target: CardInstance): number {
  let best = 0;
  for (const a of grantedAttacks(state, attacker)) {
    const reduce = effectiveAttackCostReduce(state, attacker, a.cost, a);
    if (!costSatisfied(attacker, a.cost, reduce)) continue;
    const aff = a.affinity ?? charDef(attacker).affinity ?? charDef(attacker).faction;
    const dealt = aggregateMods(state, { char: attacker, owner: attacker.owner, side: 'dealt', affinity: aff });
    const taken = aggregateMods(state, { char: target, owner: target.owner, side: 'taken', affinity: aff });
    let dmg = (a.damage ?? 0) + scalingGuess(state, a, attacker);
    dmg = (dmg + dealt.dealt.flat) * dealt.dealt.mult;
    const tdef = charDef(target);
    if (!a.ignoreWeakness && tdef.weakness && tdef.weakness.affinity === aff) dmg *= state.config.damage.weaknessMultiplier;
    if (!a.ignoreResistance && tdef.resistance && tdef.resistance.affinity === aff) dmg -= tdef.resistance.reduce ?? state.config.damage.resistanceDefaultReduce;
    dmg = (dmg + taken.taken.flat) * taken.taken.mult;
    // status defensivo (tenacity/shield) e marca entram no dano real — mesma
    // convenção de applyDamage, para a IA não superestimar trocas.
    for (const s of target.statuses) {
      const sd = registry.status(s.id);
      if (!sd) continue;
      dmg += sd.damageTakenFlat ?? 0;
      dmg += sd.damageTakenBonusFlat ?? 0;
    }
    best = Math.max(best, Math.max(0, Math.floor(dmg)));
  }
  return best;
}

function scalingGuess(state: MatchState, a: { scaling?: { per: string; amount: number; type?: string; counter?: string; cap?: number }[] }, host: CardInstance): number {
  let sum = 0;
  for (const sc of a.scaling ?? []) {
    let n = 0;
    if (sc.per === 'attachedResource') n = host.attached.filter((x) => x.kind === 'RESOURCE').length;
    else if (sc.per === 'attachedResourceType') n = host.attached.filter((x) => x.kind === 'RESOURCE' && (defOf(x) as any).resourceType === sc.type).length;
    else if (sc.per === 'selfDamage') n = Math.floor(host.damage / 30);
    else if (sc.per === 'counter') n = host.counters[sc.counter ?? ''] ?? 0;
    else if (sc.per === 'benchCount') n = player(state, host.owner).bench.length;
    else if (sc.per === 'turnNumber') n = state.turn;
    else if (sc.per === 'discardCount') n = player(state, host.owner).discard.length;
    else if (sc.per === 'resourcesInPlay') n = charactersInPlay(state, host.owner).reduce((s, c) => s + c.attached.filter((x) => x.kind === 'RESOURCE').length, 0);
    else n = 0;
    const v = n * sc.amount;
    sum += sc.cap !== undefined ? Math.min(sc.cap, v) : v;
  }
  return sum;
}

/** Dano que `defender` vai sofrer do Ativo inimigo se nada mudar. */
function incomingThreat(state: MatchState, defender: CardInstance): number {
  const opp = opponentOf(state, defender.owner);
  if (!opp.active) return 0;
  if (abilitiesBlocked(state, opp.active)) return 0;
  return bestDamageOnto(state, opp.active, defender);
}

/** Melhor dano que `me` consegue causar ao Ativo inimigo neste turno. */
export function myNextDamage(state: MatchState, me: PlayerId): number {
  const p = player(state, me);
  const opp = opponentOf(state, me);
  if (!p.active || !opp.active) return 0;
  return bestDamageOnto(state, p.active, opp.active);
}

const isPayable = (state: MatchState, inst: CardInstance, minus: number = 0): boolean => {
  const pool = Math.max(0, inst.attached.filter((a) => a.kind === 'RESOURCE').length - minus);
  for (const a of grantedAttacks(state, inst)) {
    const reduce = effectiveAttackCostReduce(state, inst, a.cost, a);
    const need = (a.cost ?? []).reduce((s: number, e: { amount: number }) => s + (e.amount ?? 0), 0) - reduce;
    if ((a.damage ?? 0) > 0 && need <= pool) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Valor de status
// ---------------------------------------------------------------------------

function statusValue(ctx: EvalCtx, target: CardInstance, statusId: string, tokens: number, plan: StepPlan): number {
  const { state, me, prof } = ctx;
  const mine = target.owner === me;
  const k = 0.35 + 0.65 * prof.matchupKnowledge; // perfis fracos não sabem o valor da negação
  const tokensN = Math.max(1, tokens || 1);
  const incoming = mine ? incomingThreat(state, target) : 0;

  switch (statusId) {
    case 'exhausted':
    case 'stun':
    case 'sleep': {
      if (mine) return -(incoming / 8) * 0.9 - 0.5;
      // negar o ataque do oponente vale o dano que ele NÃO causa
      const denied = bestDamageOnto(state, target, player(state, me).active ?? target) + (isPayable(state, target) ? 2 : 0);
      const shed = registry.status(statusId)?.shedChance ?? 0;
      let v = (denied / 8) * (1 - shed) * (statusId === 'stun' ? 1.15 : 1);
      if (statusId === 'stun') v += cannotRetreat(state, target) ? 0 : 1.4; // também trava o recuo
      return v * k * (tokens >= 2 ? 1.4 : 1);
    }
    case 'root': {
      if (mine) return -1.2;
      // prender um agente que seria KO (e recuaria) vale a vida dele
      const wouldDie = !mine && incoming === 0 && bestDamageOnto(state, player(state, me).active ?? target, target) >= currentHp(state, target);
      return (1.1 + (wouldDie ? 3.2 : 0)) * k;
    }
    case 'confusion': return mine ? -(0.3 * 20) / 8 : (0.3 * 20) / 8 * 1.2 * k;
    case 'marked': {
      if (mine) return -1.4;
      // +10 de dano recebido por turno; +payoff das cartas condicionais da MINHA mão
      const payoff = markedPayoffInHand(ctx);
      return (1.3 + payoff) * k;
    }
    case 'silence': {
      if (mine) return -1.5;
      let v = 1.2;
      for (const ab of charDef(target).abilities) {
        if (!ab.mods && !ab.effects) continue;
        if (ab.trigger === 'whileActive' && player(state, target.owner).active?.uid === target.uid) v += Math.abs(ab.mods?.damageDealtFlat ?? 0) / 12 + 1;
        if (ab.trigger === 'activated') v += 1;
      }
      return v * k;
    }
    case 'tenacity':
    case 'shield': {
      const reduce = registry.status(statusId)?.damageTakenFlat ?? 20;
      if (!mine) return -0.8;
      const saved = Math.min(incoming, reduce);
      const savesLife = incoming >= currentHp(state, target) && incoming - saved < currentHp(state, target);
      return (saved / 8) * 1.15 + (savesLife ? 5.5 : 0);
    }
    case 'regeneration': return (mine ? 1 : -1) * (tokensN * 20) / 12 * (mine ? 0.7 + 0.5 * (1 - prof.aggression) : k);
    case 'poison': return (mine ? -1 : 1) * (tokensN * 10) / 8;
    case 'burn': return (mine ? -1 : 1) * (tokensN * 20) / 8;
    default: return 0;
  }
}

/** Quantas cartas da minha mão transformam "alvo marcado" em dano extra. */
export function markedPayoffInHand(ctx: EvalCtx): number {
  if (ctx.markedPayoff !== undefined) return ctx.markedPayoff;
  const p = player(ctx.state, ctx.me);
  let bonus = 0;
  for (const c of p.hand) {
    const def = defOf(c);
    const steps = (def as any).effects ?? (def as any).attacks ?? [];
    for (const st of steps) {
      if (st.op === 'conditionalEffect' && (st.condition as ConditionSpec | undefined)?.op === 'hasStatus' && (st.condition as any).status === 'marked') {
        bonus += ((st.then ?? []) as EffectStep[]).reduce((acc: number, x: EffectStep) => acc + (x.op === 'dealDamage' ? ((x.amount as number) ?? 0) / 8 : 0.5), 0) * 0.55;
      }
    }
  }
  return Math.min(3, bonus);
}

// ---------------------------------------------------------------------------
// Condições
// ---------------------------------------------------------------------------

/**
 * Probabilidade (0..1) de uma condição ser verdadeira quando o efeito resolver.
 * `plan` guarda o que os passos ANTERIORES do mesmo card já fizeram — é o que
 * permite à IA enxergar a própria linha ("aplico Marca e depois quebro em
 * Ruptura") em vez de ver um `if` frio.
 */
export function conditionLikelihood(ctx: EvalCtx, cond: ConditionSpec | undefined, plan: StepPlan): number {
  if (!cond) return 1;
  const { state, me } = ctx;
  const oppIdx = (me === 0 ? 1 : 0) as PlayerId;
  const side = (s: string | undefined) => (s === 'source' || s === undefined ? player(state, me) : player(state, oppIdx));
  switch ((cond as any).op) {
    case 'always': return 1;
    case 'never': return 0;
    case 'coinFlip': return Math.max(0, Math.min(1, (cond as any).chance ?? 0.5));
    case 'hasStatus': {
      const id = (cond as any).status as string;
      const t = resolveTargetChar(ctx, (cond as any).target ?? 'enemyActive');
      if (t && registry.status(id) && (t.statuses.some((s) => s.id === id))) return 1;
      if (id === 'marked' && plan.markedEnemy) return 1;
      if ((id === 'exhausted' || id === 'stun') && plan.enemyExhausted) return 1;
      return 0.25; // pode ter sido aplicado noutra jogada do turno
    }
    case 'hadStatus': {
      const id = (cond as any).status as string;
      if (id === 'marked' && plan.markedEnemy) return 1;
      const t = resolveTargetChar(ctx, (cond as any).target ?? 'enemyActive');
      return t?.statuses.some((s) => s.id === id) ? 1 : 0.25;
    }
    case 'damageAtLeast': {
      const t = resolveTargetChar(ctx, (cond as any).target);
      return t && t.damage >= ((cond as any).value ?? 0) ? 1 : 0;
    }
    case 'counterAtLeast': {
      const t = resolveTargetChar(ctx, (cond as any).target);
      return t && (t.counters[(cond as any).counter ?? ''] ?? 0) >= ((cond as any).value ?? 0) ? 1 : 0;
    }
    case 'discardAtLeast': return side((cond as any).side).discard.length >= ((cond as any).count ?? 0) ? 1 : 0;
    case 'benchAtLeast': return player(state, me).bench.length >= ((cond as any).value ?? 0) ? 1 : 0;
    case 'benchAtMost': return player(state, me).bench.length <= ((cond as any).value ?? 99) ? 1 : 0;
    case 'deckAtLeast': return side((cond as any).side).deck.length >= ((cond as any).count ?? 0) ? 1 : 0;
    case 'turnAtLeast': return state.turn >= ((cond as any).turn ?? 1) ? 1 : 0;
    case 'vpCompare': {
      const a = player(state, me).victoryPoints, b = player(state, oppIdx).victoryPoints;
      const cmp = (cond as any).cmp ?? 'atLeast';
      if (cmp === 'atLeast') return a >= b ? 1 : 0;
      if (cmp === 'more') return a > b ? 1 : 0;
      if (cmp === 'less') return a < b ? 1 : 0;
      return a <= b ? 1 : 0;
    }
    case 'factionInPlay': return charactersInPlay(state, me).some((c) => charDef(c).faction === (cond as any).faction) ? 1 : 0;
    case 'attachedType': {
      const t = resolveTargetChar(ctx, (cond as any).target);
      return t?.attached.some((a) => a.kind === 'RESOURCE' && (defOf(a) as any).resourceType === (cond as any).resourceType) ? 1 : 0;
    }
    case 'enemyActiveHasCostAtLeast': {
      const t = player(state, oppIdx).active;
      if (!t) return 0;
      const max = Math.max(0, ...grantedAttacks(state, t).map((a) => (a.cost ?? []).reduce((s: number, e) => s + (e.amount ?? 0), 0)));
      return max >= ((cond as any).value ?? 0) ? 1 : 0;
    }
    case 'and': return Math.min(...((cond as any).of ?? []).map((c: ConditionSpec) => conditionLikelihood(ctx, c, plan)));
    case 'or': return Math.max(...((cond as any).of ?? []).map((c: ConditionSpec) => conditionLikelihood(ctx, c, plan)));
    case 'not': return 1 - conditionLikelihood(ctx, (cond as any).of, plan);
    default: return 0.5;
  }
}

function resolveTargetChar(ctx: EvalCtx, selector: string): CardInstance | null {
  const { state, me } = ctx;
  const p = player(state, me);
  const opp = opponentOf(state, me);
  switch (selector) {
    case 'self': return ctx.actor ?? p.active ?? null;
    case 'activeAlly': return p.active ?? null;
    case 'anyAlly':
    case 'allAllies': return p.active ?? p.bench[0] ?? null;
    case 'enemyActive':
    case 'allEnemies':
    case 'anyEnemy': return opp.active ?? opp.bench[0] ?? null;
    case 'enemyBench': return opp.bench[0] ?? null;
    case 'attacker': return ctx.actor ?? p.active ?? null;
    case 'defender': return opp.active ?? null;
    case 'benchAlly': return p.bench[0] ?? null;
    default: return p.active ?? null;
  }
}

/**
 * Mesma vocabulário de `SelectorId` do motor (`targetCandidates` em
 * `effects/core.ts`). Manter os dois alinhados é obrigatório: se a IA achar
 * que um `defender` é o PRÓPRIO ativo, ela avalia dano inimigo como
 * autolesão. O teste `jet-ai-evaluator.test.ts` cobre a cobertura total.
 */
export function targetsOf(state: MatchState, me: PlayerId, selector: string, actor?: CardInstance | null): CardInstance[] {
  const p = player(state, me);
  const opp = opponentOf(state, me);
  switch (selector) {
    // seletores ligados ao contexto de resolução do motor: do ponto de vista
    // da IA, quem "defende" é o Ativo inimigo e quem "ataca" é o próprio ator
    case 'defender':
    case 'lastTarget':
      return opp.active ? [opp.active] : [];
    case 'attacker':
      return actor ? [actor] : p.active ? [p.active] : [];
    case 'self': return actor ? [actor] : p.active ? [p.active] : [];
    case 'activeAlly': return p.active ? [p.active] : [];
    case 'benchAlly': return [...p.bench];
    case 'anyAlly': return [...(p.active ? [p.active] : []), ...p.bench];
    case 'allAllies': return [...(p.active ? [p.active] : []), ...p.bench];
    case 'enemyActive': return opp.active ? [opp.active] : [];
    case 'enemyBench': return [...opp.bench];
    case 'anyEnemy': return [...(opp.active ? [opp.active] : []), ...opp.bench];
    case 'allEnemies': return [...(opp.active ? [opp.active] : []), ...opp.bench];
    case 'anyCharacter':
    case 'allCharacters': {
      const out: CardInstance[] = [];
      for (const i of [0, 1] as const) out.push(...charactersInPlay(state, i));
      return out;
    }
    default: return p.active ? [p.active] : [];
  }
}

/** Preenche os valores compartilhados do contexto (uma vez por decisão). */
export function prepareCtx(ctx: EvalCtx): EvalCtx {
  ctx.markedPayoff = markedPayoffInHand(ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// Valor de um passo de efeito
// ---------------------------------------------------------------------------

export function stepValue(ctx: EvalCtx, step: EffectStep, plan: StepPlan = emptyPlan(), depth = 0): number {
  const { state, me, prof } = ctx;
  if (depth > 3) return 0;
  const oppIdx = (me === 0 ? 1 : 0) as PlayerId;
  const p = player(state, me);
  const opp = player(state, oppIdx);
  const aggr = prof.aggression;
  void p; void opp;
  const knowledge = 0.35 + 0.65 * prof.matchupKnowledge;
  const all = (steps: EffectStep[] | undefined, sub: StepPlan = plan): number =>
    (steps ?? []).reduce((s, x) => s + stepValue(ctx, x, sub, depth + 1), 0);

  // Alvo padrão por "side": efeitos ofensivos miram o Ativo inimigo, os de
  // suporte miram o Aliado Ativo. Cartas com `target` explícito usam o alvo dela.
  const side = String(step.target ?? '');
  const isEnemySide = side.startsWith('enemy') || side.startsWith('allEnemies') || side === 'anyEnemy' || side === 'defender' || side === 'lastTarget';
  const dmgTargets = targetsOf(state, me, isEnemySide ? side : 'enemyActive', ctx.actor);
  const allyTargets = targetsOf(state, me, !isEnemySide && side !== 'defender' ? side : 'activeAlly', ctx.actor);

  switch (step.op) {
    case 'dealDamage': {
      const amount = (step.amount as number) ?? 0;
      const targets = dmgTargets;
      let v = 0;
      for (const t of targets) {
        const eff = amount + (t.statuses.some((s) => s.id === 'marked') ? (registry.status('marked')?.damageTakenBonusFlat ?? 10) : 0);
        const hp = currentHp(state, t);
        if (eff >= hp) {
          const pv = charDef(t).victoryValue;
          const wins = opp.victoryPoints + pv >= state.config.victory.targetPoints;
          v += (t.owner === me ? -1 : 1) * (8 + pv * 3 + (wins ? 60 : 0));
        } else {
          v += (t.owner === me ? -1 : 1) * (eff / 8) * (0.6 + 0.5 * aggr);
        }
      }
      plan.damageSoFar += targets.every((t) => t.owner !== me) ? amount * Math.max(1, targets.length) : 0;
      return v;
    }
    case 'heal': {
      const amount = (step.amount as number) ?? 0;
      let v = 0;
      for (const t of allyTargets.length ? allyTargets : dmgTargets) {
        if (t.owner !== me) continue;
        const missing = t.damage;
        const real = Math.min(amount, missing);
        const urgency = 0.35 + 0.85 * (missing / Math.max(1, maxHp(state, t)));
        const incoming = incomingThreat(state, t);
        const savesLife = incoming >= currentHp(state, t) && incoming - real < currentHp(state, t);
        v += (real / 8) * urgency * (0.7 + 0.6 * (1 - aggr)) + (savesLife ? 5.5 : 0);
      }
      return v;
    }
    case 'applyStatus': {
      const targets = dmgTargets;
      const id = (step.status as string) ?? '';
      let v = 0;
      for (const t of targets) {
        v += statusValue(ctx, t, id, (step.tokens as number) ?? 1, plan);
        if (t.owner !== me) {
          if (id === 'marked') plan.markedEnemy = true;
          if (id === 'exhausted' || id === 'stun') plan.enemyExhausted = true;
        }
      }
      return v;
    }
    case 'removeStatus': {
      const targets = isEnemySide ? dmgTargets : allyTargets;
      let v = 0;
      for (const t of targets) {
        for (const s of t.statuses) {
          if (step.status !== 'all' && s.id !== step.status) continue;
          const raw = statusValue(ctx, t, s.id, s.tokens, plan);
          v += t.owner === me ? Math.abs(raw) : -Math.abs(raw) * 0.6;
        }
      }
      if (targets.every((t) => t.owner === me)) plan.statusesRemoved = true;
      return v;
    }
    case 'detachResource': {
      const targets = isEnemySide ? dmgTargets : allyTargets;
      const amount = (step.amount as number) ?? 1;
      let v = 0;
      for (const t of targets) {
        const mine = t.owner === me;
        const had = t.attached.filter((a) => a.kind === 'RESOURCE').length;
        if (had === 0) { v += mine ? 0 : -0.3; continue; }
        const before = isPayable(state, t);
        const after = isPayable(state, t, amount);
        let val = 1.1 * Math.min(amount, had);
        if (!mine && before && !after) {
          // NEGOU o ataque: vale o dano que ele não causar + o turno ganho
          const denied = bestDamageOnto(state, t, p.active ?? t);
          val += 2.5 + (denied / 8);
        }
        if (mine) val = -val * (isPayable(state, t, amount) ? 0.4 : 2.2);
        v += val * knowledge;
        if (!mine) plan.energyTaken += Math.min(amount, had);
      }
      return v;
    }
    case 'attachResource': {
      const targets = allyTargets;
      let v = 0;
      for (const t of targets) {
        const before = isPayable(state, t);
        const after = isPayable(state, { ...t, attached: [...t.attached, {} as CardInstance] } as CardInstance);
        v += 2.6 * (0.4 + prof.resourcePreservation) + (after && !before ? 3.5 : 0);
      }
      return v;
    }
    case 'drawCards': {
      const n = (step.amount as number) ?? 1;
      const handPressure = Math.max(0.25, 1 - Math.max(0, p.hand.length - 7) * 0.18);
      const deckEmptyRisk = p.deck.length <= n ? -3 : 0;
      return n * 1.25 * handPressure + deckEmptyRisk;
    }
    case 'searchDeck': {
      const n = (step.amount as number) ?? 1;
      const kinds: string[] = ((step.filter as { kinds?: string[] })?.kinds) ?? [];
      const needsEnergy = p.deck.length > 0 && !isPayable(state, p.active ?? ({} as CardInstance));
      let v = n * 1.5;
      if (kinds.includes('RESOURCE')) v += needsEnergy ? 1.6 : 0.2;
      if (kinds.includes('CHARACTER')) v += p.bench.length === 0 ? 4.5 : p.bench.length < 2 ? 1.6 : 0.1;
      return v * (0.55 + 0.45 * prof.futurePlanning);
    }
    case 'retrieveFromDiscard': return ((step.amount as number) ?? 1) * 1.15 * (p.discard.length > 0 ? 1 : 0);
    case 'shuffleIntoDeck': return ((step.amount as number) ?? 1) * 0.7 * (p.discard.length >= 4 ? 1.4 : 1);
    case 'shuffleDeck': return 0.2;
    case 'discardCards': return -1.05 * ((step.amount as number) ?? 1);
    case 'mill': {
      const n = (step.amount as number) ?? 1;
      const pressure = opp.deck.length <= 12 ? 2.2 : 0.5;
      return n * pressure * knowledge;
    }
    case 'moveCard': return 0.4;
    case 'returnToHand': return 0.6;
    case 'reviveCharacter': return 4;
    case 'switchActive': {
      if (!p.active) return 0;
      const incoming = incomingThreat(state, p.active);
      const willDie = incoming >= currentHp(state, p.active);
      let best = -Infinity;
      for (const b of p.bench) {
        const s = charDef(b).maxHp / 30 + (isPayable(state, b) ? 2.5 : 0) - (incomingThreat(state, b) >= currentHp(state, b) ? 4 : 0);
        best = Math.max(best, s);
      }
      if (!isFinite(best)) return -2;
      const cur = charDef(p.active).maxHp / 30 + (isPayable(state, p.active) ? 2.5 : 0) - (willDie ? 4 : 0);
      return (best - cur) * (0.5 + prof.tempoWeight) + (willDie ? 4.5 : 0);
    }
    case 'forceEnemySwitch': {
      if (!opp.active || opp.bench.length === 0) return 0;
      const curThreat = bestDamageOnto(state, opp.active, p.active ?? opp.active);
      const curHp = currentHp(state, opp.active);
      // tirar um agente à beira do KO do alcance = DEVOLVER vida ao oponente
      const iCanKill = myNextDamage(state, me) >= curHp;
      let worst = Infinity;
      for (const b of opp.bench) {
        const t = bestDamageOnto(state, b, p.active ?? b);
        const hp = currentHp(state, b);
        const fresh = hp >= maxHp(state, b) ? 1.5 : 0;
        worst = Math.min(worst, t / 8 + fresh + (isPayable(state, b) ? 0.8 : 0));
      }
      if (!isFinite(worst)) return 0;
      const gain = (curThreat / 8) - worst;
      return (gain - (iCanKill ? 5 : 0)) * knowledge * (0.6 + 0.4 * prof.tempoWeight);
    }
    case 'increaseDamage': {
      const amount = (step.amount as number) ?? 0;
      const willAttack = p.active ? bestDamageOnto(state, p.active, opp.active ?? p.active) > 0 : false;
      return (amount / 8) * (willAttack ? 1.15 : 0.35);
    }
    case 'reduceDamage': {
      const amount = (step.amount as number) ?? 0;
      const t = allyTargets[0] ?? p.active;
      if (!t) return 0;
      const incoming = incomingThreat(state, t);
      const saved = Math.min(incoming, amount);
      const savesLife = incoming >= currentHp(state, t) && incoming - saved < currentHp(state, t);
      return (saved / 8) * 1.15 + (savesLife ? 5.5 : 0);
    }
    case 'modifyStat': return 1.0;
    case 'modifyCost': return 1.4 * knowledge;
    case 'modifyVictoryPoints': return 12 * Math.abs((step.amount as number) ?? 1);
    case 'coinFlip': {
      const chance = Math.max(0, Math.min(1, (step.chance as number) ?? 0.5));
      const thenV = all(step.then as EffectStep[] | undefined);
      const elseV = all(step.else as EffectStep[] | undefined);
      const base = chance * thenV + (1 - chance) * elseV;
      // aversão a risco: perfis conservadores pagam para não depender de moeda
      const variance = Math.abs(thenV - elseV) * chance * (1 - chance);
      return base - (1 - prof.riskTolerance) * variance * 0.9;
    }
    case 'conditionalEffect': {
      const pTrue = conditionLikelihood(ctx, step.condition as ConditionSpec, plan);
      const thenV = all(step.then as EffectStep[] | undefined);
      const elseV = all(step.else as EffectStep[] | undefined);
      const mixed = thenV * pTrue + elseV * (1 - pTrue);
      // um plano que SÓ funciona com a condição ligada precisa de confiança
      return elseV === 0 && pTrue < 1 ? mixed * (0.5 + 0.5 * prof.matchupKnowledge) : mixed;
    }
    case 'repeatEffect': return all(step.steps as EffectStep[] | undefined, { ...plan }) * ((step.times as number) ?? 1);
    case 'copyAttack': return 2.4 * aggr;
    case 'tempMod':
    case 'createTemporaryEffect': {
      const mods = (step.mods as Record<string, number>) ?? {};
      return ((mods.damageDealtFlat ?? 0) / 8 + (mods.damageTakenFlat ?? 0) / 8 + (mods.attachExtra ?? 0) * 1.5 + (mods.drawExtra ?? 0) * 1.3 + (mods.attackCostReduce ?? 0) * 1.6 + (mods.retreatCostMod ?? 0) * -0.4);
    }
    case 'disableAbility': return 1.6 * knowledge * (targetsOf(state, me, (step.target as string) ?? 'enemyActive', ctx.actor).some((t) => t.owner !== me) ? 1 : -1);
    case 'deployCharacter': return 4;
    case 'upgradeCharacter': return 3.4 + 1.2 * aggr;
    case 'addCounter': return 1.0;
    case 'detachEquipment': return 1.4 * knowledge;
    case 'transferResource': return 2.0 * knowledge;
    case 'chooseOption':
    case 'chooseTarget':
    case 'randomTarget': return 0;
    default: return 0; // op desconhecido: nem valoriza nem penaliza (nunca inventa força)
  }
}

export function effectsValue(ctx: EvalCtx, steps: EffectStep[] | undefined, plan: StepPlan = emptyPlan()): number {
  let total = 0;
  for (const s of steps ?? []) total += stepValue(ctx, s, plan);
  return total;
}

/** Valor de um ataque completo (dano + efeitos + risco de recuo). */
export function attackValue(ctx: EvalCtx, attack: { damage?: number; cost?: ResourceCost; effects?: EffectStep[]; effectsBefore?: EffectStep[]; selfDamage?: number; scaling?: any[] }, attacker: CardInstance): number {
  const { state, me, prof } = ctx;
  const opp = opponentOf(state, me);
  const target = opp.active;
  if (!target) return -1;
  const dmg = bestDamageOnto(state, attacker, target);
  const hp = currentHp(state, target);
  let v = 0;
  if (dmg >= hp) {
    const pv = charDef(target).victoryValue;
    const wins = player(state, me).victoryPoints + pv >= state.config.victory.targetPoints;
    v += 8 + pv * 3 + (wins ? 80 : 0);
  } else {
    v += (dmg / 8) * (0.55 + 0.45 * prof.aggression);
    // progressão em direção ao KO importa mais para perfis ofensivos
    if (dmg > 0 && hp - dmg < bestDamageOnto(state, target, player(state, me).active ?? target)) v -= 2.5 * (1 - prof.riskTolerance);
  }
  const plan = emptyPlan();
  v += effectsValue(ctx, [...(attack.effectsBefore ?? []), ...(attack.effects ?? [])], plan);
  if (attack.selfDamage) {
    const after = currentHp(state, attacker) - attack.selfDamage;
    if (after <= 0 && dmg < hp) v -= 12 * (1 - prof.riskTolerance) + 4;
    else if (after <= 0) v -= 3;
    else v -= (attack.selfDamage / 8) * 0.8;
  }
  // retaliação: quanto do meu agente sobrevive?
  const incoming = bestDamageOnto(state, target, attacker);
  if (incoming >= currentHp(state, attacker) && dmg < hp) v -= 5 * (0.4 + prof.tempoWeight) * (1 - prof.riskTolerance * 0.5);
  // gastar o turno inteiro atacando é ruim se há uma jogada melhor (o caller compara)
  void findCard; void retreatCostOf; void isDefeated; void abilitiesBlocked; void cannotRetreat;
  return v;
}
