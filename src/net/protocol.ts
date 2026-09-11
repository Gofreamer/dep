/**
 * JET TCG — protocolo do multiplayer privado (v1).
 *
 * Módulo COMPARTILHADO entre o frontend e o Worker (Cloudflare Durable
 * Object). É puro: sem WebSocket, sem Durable Object, sem DOM, sem engine.
 * Isso permite testar protocolo + sala em Vitest puro e garante que cliente e
 * servidor falem exatamente o mesmo formato.
 *
 * Regras de segurança embutidas no formato:
 *  - cliente NUNCA envia estado: só intenção (`COMMAND`) + metadados;
 *  - servidor é a única fonte de `revision`, seed, resultado e visão;
 *  - nenhum campo de mensagem carrega imagem/base64/blob — arte é resolvida
 *    no cliente a partir de `cardId` (`resolveCardArt`);
 *  - tokens de assento só viajam UMA vez (na resposta de entrada) e nunca
 *    aparecem em `LobbyView`/`STATE`.
 */

import type { ChoiceRequest, Command, GameEvent, LegalActions, MatchState, PlayerId } from '../engine/types';

/** Versão do protocolo. Cliente e servidor recusam versões diferentes. */
export const PROTOCOL_VERSION = 1;

/** Assentos: exatamente dois jogadores por sala (sem terceiro, sem plateia). */
export type Seat = 0 | 1;

/** Tamanho máximo aceito de uma mensagem JSON (bytes, já decodificada). */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/** Janela de `commandId`s lembrada para idempotência (reenvios/duplo clique). */
export const COMMAND_DEDUPE_WINDOW = 48;

/** Código de sala: 6 caracteres sem ambiguidade (sem 0/O, 1/I/L, 2/Z). */
export const ROOM_CODE_ALPHABET = '3456789ABCDEFGHJKMNPQRSTUVWXY';
export const ROOM_CODE_LENGTH = 6;

export const isSeat = (v: unknown): v is Seat => v === 0 || v === 1;

export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// Tipos de guarda (sem dependência externa): JSON → mensagem válida ou null.
// ---------------------------------------------------------------------------

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Nome de exibição aceito (nunca vazio, nunca gigante). */
export function sanitizeName(raw: unknown, fallback = 'Jogador'): string {
  if (!isStr(raw)) return fallback;
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return clean.length > 0 ? clean : fallback;
}

export function isRoomCode(v: unknown): v is string {
  if (!isStr(v) || v.length !== ROOM_CODE_LENGTH) return false;
  return [...v.toUpperCase()].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}

/** Normaliza um código digitado/colado (trim + maiúsculas). */
export function normalizeRoomCode(raw: unknown): string {
  return isStr(raw) ? raw.trim().toUpperCase() : '';
}

const COMMAND_TYPES = new Set([
  'SETUP_SET_ACTIVE', 'SETUP_BENCH', 'SETUP_DONE', 'DEPLOY_CHARACTER', 'ATTACH_RESOURCE',
  'UPGRADE', 'PLAY_ACTION', 'PLAY_EQUIPMENT', 'PLAY_FIELD', 'USE_ABILITY', 'USE_ULTIMATE',
  'ATTACK', 'RETREAT', 'END_TURN', 'RESOLVE_CHOICE', 'CONCEDE'
]);

/**
 * Valida estruturalmente um comando vindo da rede. Não re-valida regra (isso é
 * do `MatchEngine`), apenas garante forma/tamanhos para nada estranho chegar ao
 * engine ou vazar para logs.
 */
export function parseCommand(raw: unknown): Command | null {
  if (!isRecord(raw) || !isStr(raw.type) || !COMMAND_TYPES.has(raw.type)) return null;
  const player = raw.player;
  if (!isSeat(player)) return null;
  const uidOk = (v: unknown): v is string => isStr(v) && v.length > 0 && v.length <= 32;
  const uidListOk = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length <= 16 && v.every(uidOk);
  const idOk = (v: unknown): v is string => isStr(v) && v.length > 0 && v.length <= 64;

  switch (raw.type) {
    case 'SETUP_SET_ACTIVE':
      return uidOk(raw.uid) ? { type: raw.type, player, uid: raw.uid } : null;
    case 'SETUP_BENCH':
      return uidOk(raw.uid) ? { type: raw.type, player, uid: raw.uid } : null;
    case 'SETUP_DONE':
      return { type: raw.type, player };
    case 'DEPLOY_CHARACTER':
      return uidOk(raw.uid) ? { type: raw.type, player, uid: raw.uid } : null;
    case 'ATTACH_RESOURCE':
      return uidOk(raw.uid) && uidOk(raw.targetUid)
        ? { type: raw.type, player, uid: raw.uid, targetUid: raw.targetUid }
        : null;
    case 'UPGRADE':
      return uidOk(raw.uid) && uidOk(raw.targetUid)
        ? { type: raw.type, player, uid: raw.uid, targetUid: raw.targetUid }
        : null;
    case 'PLAY_ACTION':
      return uidOk(raw.uid) && (raw.targetUids === undefined || uidListOk(raw.targetUids))
        ? { type: raw.type, player, uid: raw.uid, targetUids: raw.targetUids }
        : null;
    case 'PLAY_EQUIPMENT':
      return uidOk(raw.uid) && uidOk(raw.targetUid)
        ? { type: raw.type, player, uid: raw.uid, targetUid: raw.targetUid }
        : null;
    case 'PLAY_FIELD':
      return uidOk(raw.uid) ? { type: raw.type, player, uid: raw.uid } : null;
    case 'USE_ABILITY':
      return uidOk(raw.charUid) && idOk(raw.abilityId) && (raw.targetUids === undefined || uidListOk(raw.targetUids))
        ? { type: raw.type, player, charUid: raw.charUid, abilityId: raw.abilityId, targetUids: raw.targetUids }
        : null;
    case 'USE_ULTIMATE':
      return uidOk(raw.charUid) && idOk(raw.ultimateId) && (raw.targetUids === undefined || uidListOk(raw.targetUids))
        ? { type: raw.type, player, charUid: raw.charUid, ultimateId: raw.ultimateId, targetUids: raw.targetUids }
        : null;
    case 'ATTACK':
      return idOk(raw.attackId) ? { type: raw.type, player, attackId: raw.attackId } : null;
    case 'RETREAT':
      return uidOk(raw.benchUid) ? { type: raw.type, player, benchUid: raw.benchUid } : null;
    case 'END_TURN':
      return { type: raw.type, player };
    case 'RESOLVE_CHOICE':
      return uidListOk(raw.selected) ? { type: raw.type, player, selected: raw.selected } : null;
    case 'CONCEDE':
      return { type: raw.type, player };
    default:
      return null;
  }
}

/** Composição de baralho enviada pelo cliente. O SERVIDOR valida de novo. */
export type DeckSubmission =
  | { kind: 'starter'; deckId: string }
  | { kind: 'custom'; name: string; cards: Record<string, number> };

const MAX_DECK_ENTRIES = 80;

export function parseDeckSubmission(raw: unknown): DeckSubmission | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'starter') {
    return isStr(raw.deckId) && raw.deckId.length > 0 && raw.deckId.length <= 64
      ? { kind: 'starter', deckId: raw.deckId }
      : null;
  }
  if (raw.kind !== 'custom' || !isRecord(raw.cards)) return null;
  const entries = Object.entries(raw.cards);
  if (entries.length > MAX_DECK_ENTRIES) return null;
  const cards: Record<string, number> = {};
  for (const [id, n] of entries) {
    if (!isStr(id) || id.length === 0 || id.length > 64) return null;
    if (!isNum(n) || !Number.isInteger(n) || n < 1 || n > 60) return null;
    cards[id] = n;
  }
  return { kind: 'custom', name: sanitizeName(raw.name, 'Baralho'), cards };
}

// ---------------------------------------------------------------------------
// Cliente → Servidor
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'CREATE_ROOM'; name: string }
  | { type: 'JOIN_ROOM'; roomCode: string; name: string }
  | { type: 'RECONNECT'; roomCode: string; seatToken: string }
  | { type: 'SELECT_DECK'; deck: DeckSubmission }
  | { type: 'READY'; ready: boolean }
  | { type: 'COMMAND'; commandId: string; revision: number; command: Command }
  | { type: 'CONCEDE' }
  | { type: 'REMATCH'; want: boolean }
  | { type: 'PING'; t: number }
  | { type: 'LEAVE' };

const isCommandId = (v: unknown): v is string => isStr(v) && v.length > 0 && v.length <= 48;

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRecord(raw) || !isStr(raw.type)) return null;
  switch (raw.type) {
    case 'CREATE_ROOM':
      return { type: raw.type, name: sanitizeName(raw.name) };
    case 'JOIN_ROOM':
      return isRoomCode(normalizeRoomCode(raw.roomCode))
        ? { type: raw.type, roomCode: normalizeRoomCode(raw.roomCode), name: sanitizeName(raw.name) }
        : null;
    case 'RECONNECT':
      return isRoomCode(normalizeRoomCode(raw.roomCode)) && isStr(raw.seatToken) && raw.seatToken.length <= 128
        ? { type: raw.type, roomCode: normalizeRoomCode(raw.roomCode), seatToken: raw.seatToken }
        : null;
    case 'SELECT_DECK': {
      const deck = parseDeckSubmission(raw.deck);
      return deck ? { type: raw.type, deck } : null;
    }
    case 'READY':
      return { type: raw.type, ready: raw.ready !== false };
    case 'COMMAND': {
      const command = parseCommand(raw.command);
      if (!command || !isCommandId(raw.commandId) || !isNum(raw.revision) || !Number.isInteger(raw.revision)) return null;
      if (raw.revision < 0 || raw.revision > Number.MAX_SAFE_INTEGER) return null;
      return { type: raw.type, commandId: raw.commandId, revision: raw.revision, command };
    }
    case 'CONCEDE':
      return { type: raw.type };
    case 'REMATCH':
      return { type: raw.type, want: raw.want !== false };
    case 'PING':
      return { type: raw.type, t: isNum(raw.t) ? raw.t : 0 };
    case 'LEAVE':
      return { type: raw.type };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Servidor → Cliente
// ---------------------------------------------------------------------------

export type LobbyPhase = 'lobby' | 'playing' | 'over';

/** Informação pública do lobby — NUNCA contém `seatToken` do outro jogador. */
export interface LobbyPlayerView {
  present: boolean;
  connected: boolean;
  name: string;
  deckName: string | null;
  deckValid: boolean;
  ready: boolean;
}

export interface LobbyView {
  roomCode: string;
  phase: LobbyPhase;
  players: [LobbyPlayerView, LobbyPlayerView];
  winner: PlayerId | 'draw' | null;
  endReason: string | null;
  rematch: [boolean, boolean];
}

/**
 * Visão pública de uma partida para UM jogador. Tem a MESMA forma de
 * `MatchState` (para a UI reaproveitar os componentes de tabuleiro), mas:
 *  - `players[adversário].hand` e `.deck` vêm VAZIOS (só a contagem em
 *    `hidden`);
 *  - `seed`/`rngState` são zerados (não permitem prever embaralhamento);
 *  - `log` é sanitizado por observador;
 *  - não há escolha pendente do adversário.
 */
export type PublicMatchView = MatchState & {
  /** Índice do jogador para quem esta visão foi gerada. */
  viewer: PlayerId;
  /** Contagens públicas de zonas ocultas (mão/baralho do adversário). */
  hidden: { hand: number; deck: number };
};

export type CommandRejectCode =
  | 'not_your_turn'
  | 'stale_revision'
  | 'illegal'
  | 'no_match'
  | 'match_over'
  | 'duplicate'
  | 'disconnected'
  | 'invalid';

export type ErrorCode =
  | 'protocol_version'
  | 'bad_message'
  | 'message_too_large'
  | 'room_not_found'
  | 'room_full'
  | 'room_closed'
  | 'bad_token'
  | 'not_in_lobby'
  | 'invalid_deck'
  | 'unknown_deck'
  | 'already_started'
  | 'no_match'
  | 'match_over'
  | 'internal';

export type ServerMessage =
  | { type: 'JOINED'; protocolVersion: number; roomCode: string; seat: Seat; seatToken: string; lobby: LobbyView }
  | { type: 'LOBBY'; lobby: LobbyView }
  | { type: 'MATCH_START'; revision: number; match: PublicMatchView; legal: LegalActions | null; pending: ChoiceRequest | null; lobby: LobbyView }
  | { type: 'STATE'; revision: number; match: PublicMatchView; legal: LegalActions | null; pending: ChoiceRequest | null; events: GameEvent[] }
  | { type: 'COMMAND_REJECTED'; commandId: string; revision: number; code: CommandRejectCode; reason: string }
  | { type: 'MATCH_OVER'; revision: number; winner: PlayerId | 'draw'; reason: string; match: PublicMatchView }
  | { type: 'PEER_STATUS'; connected: boolean }
  | { type: 'ERROR'; code: ErrorCode; message: string }
  | { type: 'PONG'; t: number }
  | { type: 'ROOM_CLOSED'; reason: string };

// ---------------------------------------------------------------------------
// Mensagens amigáveis (PT-BR) — texto de jogador, nunca detalhe técnico.
// ---------------------------------------------------------------------------

export const ERROR_TEXTS: Record<ErrorCode, string> = {
  protocol_version: 'Este jogo está desatualizado para entrar na sala. Recarregue a página.',
  bad_message: 'A mensagem não pôde ser entendida.',
  message_too_large: 'Mensagem grande demais.',
  room_not_found: 'Sala não encontrada. Confira o código.',
  room_full: 'Esta sala já está cheia (dois jogadores).',
  room_closed: 'Esta sala foi encerrada.',
  bad_token: 'Sessão da sala inválida. Entre novamente pelo código.',
  not_in_lobby: 'A sala já está em partida.',
  invalid_deck: 'Baralho inválido para a partida.',
  unknown_deck: 'Baralho não encontrado.',
  already_started: 'A partida já começou.',
  no_match: 'Não há partida em andamento.',
  match_over: 'A partida já terminou.',
  internal: 'Algo deu errado no servidor. Tente novamente.'
};

export const REJECT_TEXTS: Record<CommandRejectCode, string> = {
  not_your_turn: 'Não é o seu turno.',
  stale_revision: 'A jogada chegou desatualizada — o tabuleiro foi atualizado.',
  illegal: 'Jogada não permitida agora.',
  no_match: 'A partida ainda não começou.',
  match_over: 'A partida já terminou.',
  duplicate: 'Essa jogada já foi aplicada.',
  disconnected: 'Você está desconectado da sala.',
  invalid: 'Jogada inválida.'
};
