/**
 * Detector de estados impossíveis (soft-lock) — instrumentação de dev/test.
 *
 * SOFT-LOCK: `gameOver == false` mas não existe maneira válida de continuar.
 * Este módulo NÃO altera estado: apenas inspeciona o MatchState e aponta
 * suspeitas. É usado por:
 *  - testes (every-card, fuzz, bateria IA×IA);
 *  - painel de debug (dev);
 *  - servidor (Worker) para detecção precoce de partidas presas.
 *
 * Regras do diagnóstico (cheap, sem simulação):
 *  - choice pendente com min>0 e zero candidatos resolvíveis  → soft-lock;
 *  - choice pendente cujos candidatos não existem mais no estado → suspeito;
 *  - setup sem ativo, sem candidato seatable e sem baralho     → suspeito;
 *  - fase main com active nulo e reserva não-vazia             → suspeito;
 *  - triggerQueue não drenado após comando concluído (sem pending) → suspeito;
 *  - personagem derrotado ainda em jogo                        → suspeito;
 *  - pending para jogador inválido                             → suspeito.
 */

import type { ChoiceRequest, Command, MatchState, PlayerId } from './types';
import { findCard, isDefeated, maxHp } from './queries';
import { computeLegalActions } from './validation';

export interface PendingSummary {
  kind: string;
  player: PlayerId;
  prompt: string;
  candidateCount: number;
  min: number;
  max: number;
  optional: boolean;
}

export interface CommandTrace {
  type: string;
  player: PlayerId;
  cardUid?: string;
  cardDefId: string | null;
  ok: boolean;
  error?: string;
}

export interface ZoneCounts {
  deck: number;
  hand: number;
  active: number;
  bench: number;
  discard: number;
}

export interface SoftLockReport {
  suspicious: boolean;
  reasons: string[];
  gameOver: boolean;
  winner: PlayerId | 'draw' | null;
  endReason: string | null;
  turn: number;
  phase: string;
  activePlayer: PlayerId;
  pending: PendingSummary | null;
  legalSummary: {
    handPlayable: number;
    deployable: number;
    playableActions: number;
    playableEquipment: number;
    playableFields: number;
    attacks: number;
    abilities: number;
    canRetreat: boolean;
    canEndTurn: boolean;
  } | null;
  lastCommand: CommandTrace | null;
  lastCardId: string | null;
  lastEvents: string[];
  zones: [ZoneCounts, ZoneCounts];
  revision: number;
}

function emptyZone(): ZoneCounts {
  return { deck: 0, hand: 0, active: 0, bench: 0, discard: 0 };
}

/**
 * Inspeciona o estado e devolve o relatório de diagnóstico.
 * `lastCommand`/`lastCardId`/`revision` vêm do MatchEngine (opcionais).
 */
export interface DiagnoseExtras {
  lastCommand?: CommandTrace | null;
  lastCardId?: string | null;
  revision?: number;
  /** Escolha pendente atual (vive no MatchEngine, não no estado). */
  pending?: ChoiceRequest | null;
}

export function diagnoseSoftLock(state: MatchState, extra: DiagnoseExtras = {}): SoftLockReport {
  const reasons: string[] = [];
  const zones: [ZoneCounts, ZoneCounts] = [emptyZone(), emptyZone()];
  for (const p of state.players) {
    zones[p.index] = {
      deck: p.deck.length,
      hand: p.hand.length,
      active: p.active ? 1 : 0,
      bench: p.bench.length,
      discard: p.discard.length
    };
  }

  const req = extra.pending ?? null;
  const pending: PendingSummary | null = req
    ? {
        kind: req.kind,
        player: req.player,
        prompt: req.prompt,
        candidateCount: req.candidates.length,
        min: req.min,
        max: req.max,
        optional: req.optional
      }
    : null;

  // ---------- partida encerrada: nunca é soft-lock -------------------------
  if (state.phase === 'gameOver') {
    return {
      suspicious: false,
      reasons,
      gameOver: true,
      winner: state.winner,
      endReason: state.endReason,
      turn: state.turn,
      phase: state.phase,
      activePlayer: state.activePlayer,
      pending,
      legalSummary: null,
      lastCommand: extra.lastCommand ?? null,
      lastCardId: extra.lastCardId ?? null,
      lastEvents: [],
      zones,
      revision: extra.revision ?? 0
    };
  }

  // ---------- escolha pendente ----------------------------------------------
  if (pending) {
    if (pending.player !== 0 && pending.player !== 1) {
      reasons.push('pending_para_jogador_invalido');
    }
    if (pending.min > 0 && pending.candidateCount === 0) {
      reasons.push('choice_sem_candidatos_min_obrigatorio');
    } else if (pending.min > pending.candidateCount && !pending.optional) {
      reasons.push('choice_com_candidatos_insuficientes');
    }
  }

  // ---------- setup ----------------------------------------------------------
  if (state.phase === 'setup') {
    for (const p of state.players) {
      if (p.setupDone) continue;
      if (!state.config.setup.requireBasic) continue;
      const hasActive = !!p.active;
      const seatable = p.hand.some((c) => c.kind === 'CHARACTER' && !p.active);
      if (!hasActive && !seatable && p.deck.length === 0) {
        reasons.push(`setup_impossivel_p${p.index}`);
      }
    }
  }

  // ---------- main -----------------------------------------------------------
  if (state.phase === 'main') {
    const activeP = state.players[state.activePlayer];
    if (!activeP.active && activeP.bench.length > 0) {
      reasons.push('active_nulo_com_reserva_nao_vazia');
    }
    if (!activeP.active && activeP.bench.length === 0 && !state.winner) {
      // startTurnGen já encerraria a partida (no_active); se não encerrou…
      reasons.push('active_nulo_sem_reserva_sem_gameover');
    }
    // personagens derrotados ainda em jogo (resolveDefeats deveria tê-los removido)
    for (const p of state.players) {
      for (const c of [...(p.active ? [p.active] : []), ...p.bench]) {
        if (isDefeated(state, c)) reasons.push(`derrotado_ainda_em_jogo:${c.uid}`);
      }
    }
  }

  // ---------- trigger queue não drenada --------------------------------------
  // Após qualquer comando concluído SEM pending, a fila deve estar vazia.
  // Só avaliamos aqui quando não há pending (o pending pode ter sido emitido
  // no meio do dreno).
  if (!pending && state.triggerQueue.length > 0) {
    reasons.push(`trigger_queue_nao_drenada:${state.triggerQueue.length}`);
  }

  // ---------- candidatos da escolha pendente referenciando uids sumidos ------
  if (req && (req.kind === 'target' || req.kind === 'cards')) {
    const missing = req.candidates.filter((uid) => !findCard(state, uid));
    if (missing.length > 0) {
      reasons.push(`choice_candidatos_inexistentes:${missing.join(',')}`);
    }
  }

  // ---------- legal actions (fase main, jogador humano ativo) ----------------
  let legalSummary: SoftLockReport['legalSummary'] = null;
  if (state.phase === 'main' && !pending) {
    const legal = computeLegalActions(state, state.activePlayer, 0);
    const p = state.players[state.activePlayer];
    legalSummary = {
      handPlayable: Object.values(legal.hand).filter((h) => h.playable).length,
      deployable: legal.deployable.length,
      playableActions: legal.playableActions.length,
      playableEquipment: legal.playableEquipment.length,
      playableFields: legal.playableFields.length,
      attacks: legal.attacks.filter((a) => a.playable).length,
      abilities: legal.abilities.filter((a) => a.playable).length,
      canRetreat: legal.canRetreat,
      canEndTurn: !p.active ? false : true // END_TURN é sempre legal no turno do dono (main)
    };
    const nothing = legalSummary.handPlayable === 0
      && legalSummary.deployable === 0
      && legalSummary.playableActions === 0
      && legalSummary.playableEquipment === 0
      && legalSummary.playableFields === 0
      && legalSummary.attacks === 0
      && legalSummary.abilities === 0
      && !legalSummary.canRetreat;
    // END_TURN permanece a saída universal — não é lock por si só.
    // Só marcamos quando nem sequer encerrar o turno avança o jogo.
    void nothing;
  }

  return {
    suspicious: reasons.length > 0,
    reasons,
    gameOver: false,
    winner: state.winner,
    endReason: state.endReason,
    turn: state.turn,
    phase: state.phase,
    activePlayer: state.activePlayer,
    pending,
    legalSummary,
    lastCommand: extra.lastCommand === undefined ? null : extra.lastCommand,
    lastCardId: extra.lastCardId === undefined ? null : extra.lastCardId,
    lastEvents: state.log.slice(-12).map((e) => `${e.type}@${e.seq}`),
    zones,
    revision: extra.revision ?? 0
  };
}

/** Descreve o último comando de forma curta (para logs e relatórios). */
export function describeCommand(cmd: Command): CommandTrace {
  const any = cmd as Record<string, unknown>;
  const cardUid = (any.uid as string) ?? (any.charUid as string) ?? (any.targetUid as string) ?? undefined;
  return {
    type: cmd.type,
    player: cmd.player,
    cardUid,
    cardDefId: null,
    ok: true
  };
}

/** Resumo legível do relatório (dev console / painel de debug). */
export function formatReport(r: SoftLockReport): string {
  const lines = [
    `turn=${r.turn} phase=${r.phase} activePlayer=${r.activePlayer} gameOver=${r.gameOver}`,
    `pending=${r.pending ? `${r.pending.kind} p${r.pending.player} "${r.pending.prompt}" cand=${r.pending.candidateCount} min=${r.pending.min}` : 'none'}`,
    `zones0=${JSON.stringify(r.zones[0])}`,
    `zones1=${JSON.stringify(r.zones[1])}`,
    `last=${r.lastCommand ? `${r.lastCommand.type} p${r.lastCommand.player} ok=${r.lastCommand.ok}` : 'none'}`
  ];
  if (r.suspicious) lines.push(`SOFT-LOCK SUSPEITO: ${r.reasons.join(' | ')}`);
  return lines.join('\n');
}
