/**
 * JET TCG — núcleo da sala privada (server-authoritative).
 *
 * Este módulo é PURO: não conhece WebSocket, Durable Object nem DOM. O Worker
 * (`worker/src/room.ts`) apenas liga `send`/`close`/`now`/RNG ao ambiente; os
 * testes ligam os mesmos hooks a arrays. Nada de regra duplicada: a partida é
 * SEMPRE resolvida pelo `MatchEngine` usado pelo modo IA/local.
 *
 * Garantias implementadas aqui:
 *  - exatamente 2 assentos; terceiro jogador é recusado;
 *  - `seatToken` aleatório por participante (room code NÃO reassume assento);
 *  - deck re-validado no servidor (o cliente nunca é acreditado);
 *  - seed gerada pelo servidor;
 *  - comando só do jogador da vez; ilegal é recusado com o motivo do engine;
 *  - `revision` monotônica; comando stale é recusado e o estado é reenviado;
 *  - `commandId` com janela de deduplicação (reenvio/duplo clique);
 *  - visão por jogador (`viewForPlayer`) — mão/baralho do adversário ocultos;
 *  - conceder decidido pelo servidor; revanche exige os dois e cria engine novo;
 *  - desconexão preserva assento; TTL encerra sala abandonada.
 */

import type { ChoiceRequest, Command, GameEvent, PlayerId } from '../engine/types';
import { DEFAULT_CONFIG } from '../engine/types';
import { MatchEngine } from '../engine/engine';
import { registry } from '../engine/registry';
import { registerJetDataPack } from '../data/jet/pack';
import { JET_STARTER_DECKS } from '../data/jet/starterDecks';
import { validateDeck } from '../data/deckUtils';
import { viewForPlayer, compactView, type PublicMatchView } from './view';
import {
  COMMAND_DEDUPE_WINDOW,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isSeat,
  otherSeat,
  type ClientMessage,
  type CommandRejectCode,
  type DeckSubmission,
  type ErrorCode,
  type LobbyPhase,
  type LobbyView,
  type Seat,
  type ServerMessage
} from './protocol';

// ---------------------------------------------------------------------------
// Ambiente injetado (mantém o núcleo testável e livre de I/O)
// ---------------------------------------------------------------------------

export interface RoomDeps {
  now(): number;
  randomRoomCode(): string;
  randomToken(): string;
  /** Seed da partida — SEMPRE gerada no servidor. */
  randomSeed(): number;
  /** Entrega uma mensagem ao assento (noop quando offline). */
  send(seat: Seat, msg: ServerMessage): void;
  /** Pede ao hospedeiro para destruir a sala. */
  close(reason: string): void;
  /** Agenda o próximo tick de manutenção (alarm do Durable Object). */
  scheduleTick?(delayMs: number): void;
}

/** Política de vida da sala (documentada em docs/RELEASE-V1.md). */
export interface RoomTtlPolicy {
  /** Sala vazia (ninguém conectado) no lobby por este tempo → encerra. */
  idleLobbyMs: number;
  /** Sem atividade (comando/lobby) durante a partida por este tempo → encerra. */
  idleMatchMs: number;
  /** Vida máxima absoluta da sala. */
  hardTtlMs: number;
  /** Grace para reconexão antes de liberar o botão "sair/conceder". */
  reconnectGraceMs: number;
}

export const DEFAULT_TTL: RoomTtlPolicy = {
  idleLobbyMs: 30 * 60 * 1000,
  idleMatchMs: 20 * 60 * 1000,
  hardTtlMs: 6 * 60 * 60 * 1000,
  reconnectGraceMs: 5 * 60 * 1000
};

// ---------------------------------------------------------------------------
// Estado interno
// ---------------------------------------------------------------------------

interface SeatState {
  /** Assento ocupado por alguém (mesmo momentaneamente desconectado). */
  present: boolean;
  token: string;
  name: string;
  connected: boolean;
  deck: DeckSubmission | null;
  deckName: string | null;
  deckCards: Record<string, number> | null;
  deckValid: boolean;
  deckError: string | null;
  ready: boolean;
  rematch: boolean;
  /** Instante da última desconexão (para o grace de reconexão). */
  disconnectedAt: number | null;
}

function emptySeat(name = 'Aguardando…'): SeatState {
  return {
    present: false, token: '', name, connected: false, deck: null, deckName: null,
    deckCards: null, deckValid: false, deckError: null, ready: false, rematch: false,
    disconnectedAt: null
  };
}

/** Formato persistido do lobby (Durable Object storage). */
export interface RoomSnapshot {
  roomCode: string;
  createdAt: number;
  phase: LobbyPhase;
  winner: PlayerId | 'draw' | null;
  endReason: string | null;
  seats: { present: boolean; token: string; name: string; deck: DeckSubmission | null }[];
}

export interface RoomStats {
  createdAt: number;
  startedAt: number | null;
  matchesPlayed: number;
  commandsApplied: number;
  commandsRejected: number;
}

// ---------------------------------------------------------------------------
// Resolução de baralho (servidor)
// ---------------------------------------------------------------------------

export interface ResolvedDeck {
  name: string;
  cards: Record<string, number>;
}

export function resolveStarterDeck(deckId: string): ResolvedDeck | null {
  const d = JET_STARTER_DECKS.find((s) => s.id === deckId);
  return d ? { name: d.name, cards: { ...d.cards } } : null;
}

/** Expande `Record<cardId, n>` na lista de `CardDef` exigida pelo engine. */
export function expandDeckCards(cards: Record<string, number>) {
  const out = [];
  for (const [id, n] of Object.entries(cards)) {
    const def = registry.card(id);
    for (let i = 0; i < n; i++) out.push(def);
  }
  return out;
}

// ---------------------------------------------------------------------------
// RoomCore
// ---------------------------------------------------------------------------

export class RoomCore {
  readonly roomCode: string;
  readonly deps: RoomDeps;
  readonly ttl: RoomTtlPolicy;
  phase: LobbyPhase = 'lobby';
  revision = 0;
  winner: PlayerId | 'draw' | null = null;
  endReason: string | null = null;
  /** Seed da partida em andamento (nunca enviada aos clientes). */
  private seed = 0;
  private engine: MatchEngine | null = null;
  private seats: [SeatState, SeatState] = [emptySeat(), emptySeat()];
  /** connectionId → seat (uma conexão por assento). */
  private connections = new Map<string, Seat>();
  private lastSeq: [number, number] = [0, 0];
  private recentCommandIds: string[] = [];
  private lastActivity: number;
  private startedAt: number | null = null;
  private closed = false;
  readonly createdAt: number;
  readonly stats: RoomStats;

  constructor(roomCode: string, deps: RoomDeps, ttl: RoomTtlPolicy = DEFAULT_TTL) {
    this.roomCode = roomCode;
    this.deps = deps;
    this.ttl = ttl;
    this.createdAt = deps.now();
    this.lastActivity = this.createdAt;
    this.stats = { createdAt: this.createdAt, startedAt: null, matchesPlayed: 0, commandsApplied: 0, commandsRejected: 0 };
    // O conteúdo do jogo precisa estar registrado antes de validar decks.
    registerJetDataPack();
  }

  // -------------------------------------------------------------------------
  // Conexões
  // -------------------------------------------------------------------------

  /** Liga uma conexão a um assento já ocupado (join/reconnect). */
  attach(seat: Seat, connectionId: string): void {
    const s = this.seats[seat];
    // Substitui conexão antiga do mesmo assento (reload/reconexão rápida).
    for (const [id, other] of this.connections) if (other === seat) this.connections.delete(id);
    this.connections.set(connectionId, seat);
    s.connected = true;
    s.disconnectedAt = null;
    this.touch();
    this.broadcastLobby();
    this.deps.send(seat, { type: 'PEER_STATUS', connected: this.seats[otherSeat(seat)].connected });
    const other = otherSeat(seat);
    if (this.seats[other].present) this.deps.send(other, { type: 'PEER_STATUS', connected: true });
    if (this.phase !== 'lobby') this.deps.send(seat, this.stateMessageFor(seat, []));
  }

  /** Uma conexão caiu. Preserva o assento (reconexão por token). */
  detach(connectionId: string): void {
    const seat = this.connections.get(connectionId);
    if (seat === undefined) return;
    this.connections.delete(connectionId);
    const s = this.seats[seat];
    // Só marca como desconectado se não houver outra conexão do mesmo assento.
    if (![...this.connections.values()].includes(seat)) {
      s.connected = false;
      s.disconnectedAt = this.deps.now();
    }
    this.touch();
    this.broadcastLobby();
    const other = this.seats[otherSeat(seat)];
    if (other.present) this.deps.send(otherSeat(seat), { type: 'PEER_STATUS', connected: s.connected });
  }

  seatOfConnection(connectionId: string): Seat | undefined {
    return this.connections.get(connectionId);
  }

  // -------------------------------------------------------------------------
  // Entrada na sala
  // -------------------------------------------------------------------------

  /** Jogador 1: ocupa o assento 0. */
  create(name: string): { seat: Seat; seatToken: string } {
    return this.occupy(0, name);
  }

  /** Jogador 2: ocupa o primeiro assento livre. Terceiro → `room_full`. */
  join(name: string): { seat: Seat; seatToken: string } | { error: ErrorCode } {
    const seat = this.seats[0].present ? (this.seats[1].present ? null : 1) : 0;
    if (seat === null) return { error: 'room_full' };
    return this.occupy(seat as Seat, name);
  }

  /** Reconexão com token. Token errado → `bad_token` (nunca reassume assento). */
  reconnect(roomCode: string, seatToken: string): { seat: Seat } | { error: ErrorCode } {
    if (roomCode !== this.roomCode) return { error: 'room_not_found' };
    const seat = this.seats.findIndex((s) => s.present && s.token === seatToken) as Seat | -1;
    if (seat === -1 || !isSeat(seat)) return { error: 'bad_token' };
    return { seat };
  }

  private occupy(seat: Seat, name: string): { seat: Seat; seatToken: string } {
    const s = this.seats[seat];
    const token = this.deps.randomToken();
    s.present = true;
    s.token = token;
    s.name = name || `Jogador ${seat + 1}`;
    s.ready = false;
    s.rematch = false;
    this.touch();
    return { seat, seatToken: token };
  }

  // -------------------------------------------------------------------------
  // Mensagens
  // -------------------------------------------------------------------------

  handle(seat: Seat, msg: ClientMessage): void {
    if (this.closed) return;
    switch (msg.type) {
      case 'SELECT_DECK':
        return this.selectDeck(seat, msg.deck);
      case 'READY':
        return this.setReady(seat, msg.ready);
      case 'COMMAND':
        return this.command(seat, msg.commandId, msg.revision, msg.command);
      case 'CONCEDE':
        return this.concede(seat);
      case 'REMATCH':
        return this.setRematch(seat, msg.want);
      case 'PING':
        return this.deps.send(seat, { type: 'PONG', t: msg.t });
      case 'LEAVE':
        return this.leave(seat);
      case 'CREATE_ROOM':
      case 'JOIN_ROOM':
      case 'RECONNECT':
        // Entrada é resolvida pelo Worker antes do attach (precisa do assento).
        return this.error(seat, 'bad_message', 'Entrada na sala já foi resolvida.');
      default:
        return this.error(seat, 'bad_message', 'Mensagem desconhecida.');
    }
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  selectDeck(seat: Seat, submission: DeckSubmission): void {
    if (this.phase === 'playing') return this.error(seat, 'not_in_lobby', 'A partida já começou.');
    const resolved = submission.kind === 'starter' ? resolveStarterDeck(submission.deckId) : { name: submission.name, cards: submission.cards };
    if (!resolved) {
      const s = this.seats[seat];
      s.deck = null;
      s.deckName = null;
      s.deckCards = null;
      s.deckValid = false;
      s.deckError = 'Baralho não encontrado.';
      s.ready = false;
      this.touch();
      this.broadcastLobby();
      return this.error(seat, 'unknown_deck', 'Baralho não encontrado.');
    }
    // VALIDAÇÃO NO SERVIDOR — o cliente nunca é acreditado.
    const check = validateDeck(resolved.cards, DEFAULT_CONFIG.deckRules);
    const s = this.seats[seat];
    s.deck = submission;
    s.deckName = resolved.name;
    s.deckCards = resolved.cards;
    s.deckValid = check.valid;
    s.deckError = check.errors[0] ?? null;
    if (!check.valid) s.ready = false;
    this.touch();
    this.broadcastLobby();
    if (!check.valid) this.error(seat, 'invalid_deck', check.errors[0] ?? 'Baralho inválido.');
  }

  setReady(seat: Seat, ready: boolean): void {
    if (this.phase === 'playing') return this.error(seat, 'already_started', 'A partida já começou.');
    const s = this.seats[seat];
    if (ready && !s.deckValid) return this.error(seat, 'invalid_deck', 'Escolha um baralho válido primeiro.');
    s.ready = ready;
    this.touch();
    this.broadcastLobby();
    if (this.canStart()) this.startMatch();
  }

  private canStart(): boolean {
    const [a, b] = this.seats;
    return this.phase === 'lobby' && a.present && b.present && a.deckValid && b.deckValid && a.ready && b.ready;
  }

  leave(seat: Seat): void {
    if (this.phase === 'playing') {
      this.concede(seat);
      return;
    }
    this.seats[seat] = emptySeat();
    for (const [id, s] of this.connections) if (s === seat) this.connections.delete(id);
    this.touch();
    this.broadcastLobby();
  }

  setRematch(seat: Seat, want: boolean): void {
    if (this.phase !== 'over') return this.error(seat, 'not_in_lobby', 'Só é possível pedir revanche após o fim da partida.');
    this.seats[seat].rematch = want;
    this.touch();
    this.broadcastLobby();
    if (this.seats[0].rematch && this.seats[1].rematch) this.startMatch();
  }

  // -------------------------------------------------------------------------
  // Partida
  // -------------------------------------------------------------------------

  /** Cria a partida: seed do servidor, engine novo, baralhos validados. */
  private startMatch(): void {
    const [a, b] = this.seats;
    if (!a.deckCards || !b.deckCards) return;
    this.seed = this.deps.randomSeed();
    this.engine = new MatchEngine({
      seed: this.seed,
      config: DEFAULT_CONFIG,
      players: [
        { name: a.name, deckId: deckIdOf(a.deck), isAI: false, aiLevel: 'normal', deck: expandDeckCards(a.deckCards) },
        { name: b.name, deckId: deckIdOf(b.deck), isAI: false, aiLevel: 'normal', deck: expandDeckCards(b.deckCards) }
      ]
    });
    this.phase = 'playing';
    this.winner = null;
    this.endReason = null;
    this.revision = 1;
    this.lastSeq = [this.engine.state.eventSeq, this.engine.state.eventSeq];
    this.recentCommandIds = [];
    this.startedAt = this.deps.now();
    this.stats.startedAt = this.startedAt;
    this.stats.matchesPlayed += 1;
    a.ready = false;
    b.ready = false;
    a.rematch = false;
    b.rematch = false;
    this.touch();
    const lobby = this.lobbyView();
    for (const seat of [0, 1] as Seat[]) {
      this.deps.send(seat, {
        type: 'MATCH_START',
        revision: this.revision,
        match: compactView(viewForPlayer(this.engine.state, seat)),
        legal: this.engine.legalActions(seat),
        pending: this.pendingFor(seat),
        lobby
      });
    }
    this.syncOutcome();
  }

  command(seat: Seat, commandId: string, revision: number, cmd: Command): void {
    if (this.phase !== 'playing' || !this.engine) {
      this.reject(seat, commandId, 'no_match', 'A partida ainda não começou.');
      return;
    }
    if (!this.seats[seat].connected) {
      this.reject(seat, commandId, 'disconnected', 'Você está desconectado.');
      return;
    }
    if (this.recentCommandIds.includes(commandId)) {
      this.reject(seat, commandId, 'duplicate', 'Comando já processado.');
      return;
    }
    if (revision !== this.revision) {
      this.reject(seat, commandId, 'stale_revision', 'Estado desatualizado.');
      // Reenvia o estado atual para o cliente se ressincronizar.
      this.deps.send(seat, this.stateMessageFor(seat, []));
      return;
    }
    if (cmd.player !== seat) {
      this.reject(seat, commandId, 'not_your_turn', 'Comando de outro jogador.');
      return;
    }
    const result = this.engine.dispatch(cmd);
    if (!result.ok) {
      const code: CommandRejectCode = result.error === 'not_your_turn' ? 'not_your_turn' : 'illegal';
      this.reject(seat, commandId, code, result.error ?? 'illegal');
      return;
    }
    this.rememberCommand(commandId);
    this.revision += 1;
    this.stats.commandsApplied += 1;
    this.touch();
    this.broadcastState(result.events);
    this.syncOutcome();
  }

  concede(seat: Seat): void {
    if (this.phase !== 'playing' || !this.engine) {
      this.error(seat, 'no_match', 'Não há partida em andamento.');
      return;
    }
    // O resultado é decidido pelo SERVIDOR (dispatch do próprio engine).
    const result = this.engine.dispatch({ type: 'CONCEDE', player: seat });
    if (!result.ok) {
      this.error(seat, 'match_over', 'A partida já terminou.');
      return;
    }
    this.revision += 1;
    this.touch();
    this.broadcastState(result.events);
    this.syncOutcome();
  }

  private syncOutcome(): void {
    const st = this.engine?.state;
    if (!st || this.phase !== 'playing' || st.phase !== 'gameOver') return;
    this.phase = 'over';
    this.winner = st.winner ?? 'draw';
    this.endReason = st.endReason ?? '';
    this.revision += 1;
    this.seats[0].rematch = false;
    this.seats[1].rematch = false;
    this.touch();
    for (const seat of [0, 1] as Seat[]) {
      this.deps.send(seat, {
        type: 'MATCH_OVER',
        revision: this.revision,
        winner: this.winner,
        reason: this.endReason,
        match: compactView(viewForPlayer(st, seat))
      });
    }
    this.broadcastLobby();
  }

  // -------------------------------------------------------------------------
  // Estado para os clientes
  // -------------------------------------------------------------------------

  stateMessageFor(seat: Seat, events: GameEvent[]): ServerMessage {
    const st = this.engine!.state;
    const mine = events.filter((e) => e.player === seat || e.player === null);
    this.lastSeq[seat] = st.eventSeq;
    return {
      type: 'STATE',
      revision: this.revision,
      match: compactView(viewForPlayer(st, seat)),
      legal: this.engine!.legalActions(seat),
      pending: this.pendingFor(seat),
      // Só eventos que não revelem cartas ocultas do adversário.
      events: mine
    };
  }

  private broadcastState(events: GameEvent[]): void {
    for (const seat of [0, 1] as Seat[]) {
      if (!this.seats[seat].present) continue;
      this.deps.send(seat, this.stateMessageFor(seat, events));
    }
  }

  lobbyView(): LobbyView {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      players: this.seats.map((s) => ({
        present: s.present,
        connected: s.connected,
        name: s.name,
        deckName: s.deckName,
        deckValid: s.deckValid,
        ready: s.ready
      })) as [LobbyView['players'][0], LobbyView['players'][1]],
      winner: this.winner,
      endReason: this.endReason,
      rematch: [this.seats[0].rematch, this.seats[1].rematch]
    };
  }

  broadcastLobby(): void {
    const lobby = this.lobbyView();
    for (const seat of [0, 1] as Seat[]) {
      if (this.seats[seat].present) this.deps.send(seat, { type: 'LOBBY', lobby });
    }
  }

  // -----------------------------------------------------------------------
  // Persistência do lobby (Durable Object storage)
  // -----------------------------------------------------------------------

  /**
   * Snapshot do lobby para sobrevivência a reinício do isolado. A partida em
   * andamento NÃO é persistida (o gerador de escolhas pendentes do engine não
   * é serializável): se o isolado reiniciar no meio de um jogo, a sala volta
   * ao lobby e os jogadores recomeçam. Documentado em docs/RELEASE-V1.md.
   */
  snapshot(): RoomSnapshot {
    return {
      roomCode: this.roomCode,
      createdAt: this.createdAt,
      phase: this.phase === 'playing' ? 'lobby' : this.phase,
      winner: this.winner,
      endReason: this.endReason,
      seats: this.seats.map((s) => ({
        present: s.present, token: s.token, name: s.name, deck: s.deck
      }))
    };
  }

  /** Restaura um snapshot de lobby (tokens preservados → reconexão funciona). */
  applySnapshot(snapshot: RoomSnapshot): void {
    if (snapshot.roomCode !== this.roomCode) return;
    for (const seat of [0, 1] as Seat[]) {
      const src = snapshot.seats[seat];
      if (!src) continue;
      const s = this.seats[seat];
      s.present = !!src.present;
      s.token = src.token ?? '';
      s.name = src.name || `Jogador ${seat + 1}`;
      s.deck = src.deck ?? null;
      s.connected = false;
      s.ready = false;
      s.rematch = false;
      s.deckValid = false;
      s.deckError = null;
      s.deckName = null;
      s.deckCards = null;
      // Revalida no servidor (fonte da verdade) para o lobby voltar coerente.
      if (s.deck) {
        const resolved = s.deck.kind === 'starter' ? resolveStarterDeck(s.deck.deckId) : { name: s.deck.name, cards: s.deck.cards };
        if (resolved) {
          const check = validateDeck(resolved.cards, DEFAULT_CONFIG.deckRules);
          s.deckName = resolved.name;
          s.deckCards = resolved.cards;
          s.deckValid = check.valid;
          s.deckError = check.errors[0] ?? null;
        }
      }
    }
    if (snapshot.phase === 'over') {
      this.phase = 'over';
      this.winner = snapshot.winner ?? null;
      this.endReason = snapshot.endReason ?? null;
    }
  }

  /** Mensagem completa para (re)conexão no meio da partida. */
  joinedMessage(seat: Seat, seatToken: string): ServerMessage {
    return { type: 'JOINED', protocolVersion: 1, roomCode: this.roomCode, seat, seatToken, lobby: this.lobbyView() };
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  /** Tick de manutenção (alarm). Retorna o próximo delay ou `null` para encerrar. */
  onTick(): { action: 'close'; reason: string } | { action: 'wait'; delayMs: number } {
    const now = this.deps.now();
    const age = now - this.createdAt;
    if (age >= this.ttl.hardTtlMs) return { action: 'close', reason: 'tempo máximo da sala atingido' };
    const idle = now - this.lastActivity;
    if (this.phase === 'lobby' && !this.anyConnected() && idle >= this.ttl.idleLobbyMs) {
      return { action: 'close', reason: 'sala abandonada' };
    }
    if (this.phase === 'lobby' && this.anyConnected() && idle >= this.ttl.idleLobbyMs) {
      return { action: 'close', reason: 'sala sem atividade' };
    }
    if (this.phase !== 'lobby' && idle >= this.ttl.idleMatchMs) {
      return { action: 'close', reason: 'partida abandonada' };
    }
    if (this.phase === 'over' && idle >= this.ttl.idleLobbyMs) {
      return { action: 'close', reason: 'sala encerrada' };
    }
    return { action: 'wait', delayMs: 60_000 };
  }

  /** Grace de reconexão expirado para o assento desconectado? */
  reconnectGraceExpired(seat: Seat): boolean {
    const s = this.seats[seat];
    if (s.connected || s.disconnectedAt === null) return false;
    return this.deps.now() - s.disconnectedAt >= this.ttl.reconnectGraceMs;
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    for (const seat of [0, 1] as Seat[]) {
      if (this.seats[seat].present) this.deps.send(seat, { type: 'ROOM_CLOSED', reason: 'A sala foi encerrada.' });
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  seatInfo(seat: Seat): LobbyView['players'][0] {
    const s = this.seats[seat];
    return { present: s.present, connected: s.connected, name: s.name, deckName: s.deckName, deckValid: s.deckValid, ready: s.ready };
  }

  private anyConnected(): boolean {
    return this.seats.some((s) => s.connected);
  }

  private touch(): void {
    this.lastActivity = this.deps.now();
    this.deps.scheduleTick?.(60_000);
  }

  private rememberCommand(commandId: string): void {
    this.recentCommandIds.push(commandId);
    if (this.recentCommandIds.length > COMMAND_DEDUPE_WINDOW) {
      this.recentCommandIds.splice(0, this.recentCommandIds.length - COMMAND_DEDUPE_WINDOW);
    }
  }

  private pendingFor(seat: Seat): ChoiceRequest | null {
    const pending = this.engine?.getPending() ?? null;
    return pending && pending.player === seat ? pending : null;
  }

  private reject(seat: Seat, commandId: string, code: CommandRejectCode, reason: string): void {
    this.stats.commandsRejected += 1;
    this.deps.send(seat, { type: 'COMMAND_REJECTED', commandId, revision: this.revision, code, reason });
  }

  private error(seat: Seat, code: ErrorCode, message: string): void {
    this.deps.send(seat, { type: 'ERROR', code, message });
  }
}

function deckIdOf(deck: DeckSubmission | null): string {
  if (!deck) return '';
  return deck.kind === 'starter' ? deck.deckId : 'custom';
}

// ---------------------------------------------------------------------------
// Geradores padrão (o Worker usa crypto; os testes injetam determinísticos)
// ---------------------------------------------------------------------------

/** Gera um código de sala curto e sem caracteres ambíguos. */
export function generateRoomCode(random: (maxExclusive: number) => number): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[random(ROOM_CODE_ALPHABET.length)];
  return out;
}

/** Token de assento imprevisível (nunca derivado do código da sala). */
export function generateSeatToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seed de partida (servidor). Nunca aceita seed do cliente. */
export function generateSeed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] >>> 0;
}

/** Máscara de token para logs (nunca logar token completo). */
export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * Verificação estrutural de que um payload serializado não carrega imagem.
 * Usada pelo Worker em produção (defesa em profundidade) e por testes.
 */
export function payloadContainsBinaryArt(serialized: string): boolean {
  return /data:image\//i.test(serialized) || /base64,/i.test(serialized);
}
