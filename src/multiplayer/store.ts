/**
 * JET TCG — estado do multiplayer privado (Zustand).
 *
 * Único lugar que conversa com o transporte. A partida online é
 * server-authoritative: aqui só guardamos a VISÃO recebida do servidor
 * (`PublicMatchView`), enviamos comandos e traduzimos eventos em feedback.
 * Nenhuma regra de jogo é recriada neste arquivo.
 */

import { create } from 'zustand';
import type { ChoiceRequest, Command, LegalActions, PlayerId } from '../engine/types';
import type { LobbyView, PublicMatchView, Seat, ServerMessage } from '../net/protocol';
import { ERROR_TEXTS, REJECT_TEXTS, normalizeRoomCode } from '../net/protocol';
import { cuesFromEvents, sfxForCue, type SfxName } from '../game/cues';
import type { Cue } from '../game/controller';
import {
  MultiplayerTransport,
  inviteLink,
  loadSession,
  multiplayerUrl,
  roomCodeFromUrl,
  saveSession,
  type RoomSession,
  type TransportStatus
} from './client';
import { playSfx } from '../ui/audio';

export type RoomPhase = 'idle' | 'lobby' | 'playing' | 'over';

interface MultiplayerState {
  configured: boolean;
  url: string;
  status: TransportStatus;
  phase: RoomPhase;

  roomCode: string | null;
  seat: Seat | null;
  lobby: LobbyView | null;
  peerConnected: boolean;

  view: PublicMatchView | null;
  legal: LegalActions | null;
  pending: ChoiceRequest | null;
  revision: number;
  events: { seq: number; text: string }[];

  winner: PlayerId | 'draw' | null;
  endReason: string | null;

  notice: string | null;
  error: string | null;
  reconnectMessage: string | null;
  rematch: [boolean, boolean];

  /** Cues visuais derivados dos eventos públicos recebidos do servidor. */
  onlineCues: Cue[];

  // ações ---------------------------------------------------------------
  init: () => void;
  createRoom: (name: string) => void;
  joinRoom: (code: string, name: string) => void;
  reconnect: () => void;
  leave: () => void;
  selectDeck: (deck: { kind: 'starter'; deckId: string } | { kind: 'custom'; name: string; cards: Record<string, number> }) => void;
  setReady: (ready: boolean) => void;
  sendCommand: (command: Command) => void;
  resolveChoice: (selected: string[]) => void;
  concede: () => void;
  wantRematch: (want: boolean) => void;
  pushCue: (cue: Cue) => void;
  dropCue: (id: number) => void;
  clearNotice: () => void;
  reset: () => void;
}

let transport: MultiplayerTransport | null = null;
let commandSeq = 0;
let cueSeq = 1;
let pendingEntry: { type: 'create' | 'join'; name: string; code?: string } | null = null;

function newCommandId(): string {
  commandSeq += 1;
  return `c${Date.now().toString(36)}-${commandSeq}`;
}

export const useMultiplayer = create<MultiplayerState>((set, get) => {
  /** Envia o handshake adequado ao (re)abrir o socket. */
  const handshake = (): void => {
    const state = get();
    const session = loadSession();
    if (session && session.roomCode === state.roomCode && session.seatToken) {
      transport?.send({ type: 'RECONNECT', roomCode: session.roomCode, seatToken: session.seatToken });
      return;
    }
    if (pendingEntry?.type === 'create') transport?.send({ type: 'CREATE_ROOM', name: pendingEntry.name });
    else if (pendingEntry?.type === 'join') transport?.send({ type: 'JOIN_ROOM', roomCode: pendingEntry.code!, name: pendingEntry.name });
  };

  const setStatus = (status: TransportStatus): void => {
    if (status === 'reconnecting') set({ status, reconnectMessage: 'Reconectando…' });
    else if (status === 'connected') set({ status, reconnectMessage: null });
    else set({ status });
  };

  const applyMessage = (msg: ServerMessage): void => {
    switch (msg.type) {
      case 'JOINED': {
        if (msg.seatToken) {
          saveSession({ roomCode: msg.roomCode, seat: msg.seat, seatToken: msg.seatToken, name: get().lobby?.players[msg.seat].name ?? '' });
        }
        pendingEntry = null;
        set({ roomCode: msg.roomCode, seat: msg.seat, lobby: msg.lobby, phase: 'lobby', error: null });
        break;
      }
      case 'LOBBY':
        set({ lobby: msg.lobby, phase: msg.lobby.phase === 'playing' ? get().phase : msg.lobby.phase });
        break;
      case 'MATCH_START': {
        const session = loadSession();
        if (session) saveSession({ ...session, name: session.name });
        set({
          phase: 'playing',
          view: msg.match,
          legal: msg.legal,
          pending: msg.pending,
          revision: msg.revision,
          winner: null,
          endReason: null,
          lobby: msg.lobby,
          events: [],
          error: null
        });
        break;
      }
      case 'STATE': {
        const cues = cuesFromEvents(msg.events).map((seed) => ({ ...seed, id: cueSeq++ } as Cue));
        for (const cue of cues) {
          const sfx: SfxName | null = sfxForCue(cue);
          if (sfx) playSfx(sfx);
        }
        set((s) => ({
          view: msg.match,
          legal: msg.legal,
          pending: msg.pending,
          revision: msg.revision,
          onlineCues: cues,
          events: s.events
        }));
        break;
      }
      case 'COMMAND_REJECTED':
        set({ error: REJECT_TEXTS[msg.code] ?? msg.reason });
        break;
      case 'MATCH_OVER':
        set({
          phase: 'over',
          winner: msg.winner,
          endReason: msg.reason,
          view: msg.match,
          revision: msg.revision,
          rematch: [false, false]
        });
        playSfx('vp');
        break;
      case 'PEER_STATUS':
        set({
          peerConnected: msg.connected,
          notice: msg.connected ? 'Oponente reconectado.' : 'Oponente desconectado — aguardando reconexão.'
        });
        break;
      case 'ERROR':
        set({ error: ERROR_TEXTS[msg.code] ?? msg.message, notice: null });
        break;
      case 'PONG':
        break;
      case 'ROOM_CLOSED':
        saveSession(null);
        set({ phase: 'idle', error: msg.reason, view: null, legal: null, lobby: null, roomCode: null });
        break;
      default:
        break;
    }
  };

  const ensureTransport = (): MultiplayerTransport | null => {
    const url = multiplayerUrl();
    if (!url) return null;
    if (!transport) {
      transport = new MultiplayerTransport(
        { baseUrl: url },
        {
          onOpen: handshake,
          onMessage: applyMessage,
          onStatus: setStatus,
          onGaveUp: () => {
            set({ error: 'Não foi possível falar com o servidor da sala.', status: 'closed' });
          }
        }
      );
    }
    return transport;
  };

  return {
    configured: typeof multiplayerUrl() === 'string' && multiplayerUrl().length > 0,
    url: multiplayerUrl(),
    status: 'idle',
    phase: 'idle',
    roomCode: null,
    seat: null,
    lobby: null,
    peerConnected: false,
    view: null,
    legal: null,
    pending: null,
    revision: 0,
    events: [],
    winner: null,
    endReason: null,
    notice: null,
    error: null,
    reconnectMessage: null,
    rematch: [false, false],
    onlineCues: [],

    init: () => {
      set({ configured: multiplayerUrl().length > 0, url: multiplayerUrl() });
    },

    createRoom: (name) => {
      const t = ensureTransport();
      if (!t) {
        set({ error: 'Servidor multiplayer não configurado.' });
        return;
      }
      pendingEntry = { type: 'create', name };
      set({ error: null, phase: 'lobby', roomCode: null });
      t.connect('/room/new');
    },

    joinRoom: (code, name) => {
      const normalized = normalizeRoomCode(code);
      const t = ensureTransport();
      if (!t) {
        set({ error: 'Servidor multiplayer não configurado.' });
        return;
      }
      if (!normalized) {
        set({ error: 'Digite o código da sala.' });
        return;
      }
      pendingEntry = { type: 'join', name, code: normalized };
      set({ error: null, phase: 'lobby', roomCode: normalized });
      t.connect(`/room/${encodeURIComponent(normalized)}`);
    },

    reconnect: () => {
      const session = loadSession();
      if (!session) {
        set({ error: 'Nenhuma sala para reconectar.' });
        return;
      }
      const t = ensureTransport();
      if (!t) return;
      set({ error: null, roomCode: session.roomCode, seat: session.seat });
      t.connect(`/room/${encodeURIComponent(session.roomCode)}`);
    },

    leave: () => {
      transport?.send({ type: 'LEAVE' });
      transport?.close();
      saveSession(null);
      pendingEntry = null;
      set({ phase: 'idle', roomCode: null, seat: null, lobby: null, view: null, legal: null, pending: null, winner: null, status: 'idle', error: null });
    },

    selectDeck: (deck) => transport?.send({ type: 'SELECT_DECK', deck }),
    setReady: (ready) => transport?.send({ type: 'READY', ready }),

    sendCommand: (command) => {
      const { revision, seat } = get();
      if (seat === null) return;
      if (command.player !== seat) return; // nunca enviar comando de outro jogador
      transport?.send({ type: 'COMMAND', commandId: newCommandId(), revision, command });
    },

    resolveChoice: (selected) => {
      const { pending, seat } = get();
      if (!pending || seat === null || pending.player !== seat) return;
      transport?.send({
        type: 'COMMAND',
        commandId: newCommandId(),
        revision: get().revision,
        command: { type: 'RESOLVE_CHOICE', player: seat, selected }
      });
    },

    concede: () => transport?.send({ type: 'CONCEDE' }),

    wantRematch: (want) => transport?.send({ type: 'REMATCH', want }),

    pushCue: (cue) => set((s) => ({ onlineCues: [...s.onlineCues, cue].slice(-24) })),

    dropCue: (id) => set((s) => ({ onlineCues: s.onlineCues.filter((c) => c.id !== id) })),

    clearNotice: () => set({ notice: null, error: null }),

    reset: () => {
      saveSession(null);
      set({
        phase: 'idle', roomCode: null, seat: null, lobby: null, view: null, legal: null,
        pending: null, revision: 0, winner: null, endReason: null, notice: null, error: null,
        onlineCues: []
      });
    }
  };
});

export type { RoomSession, TransportStatus };
export { inviteLink, loadSession, multiplayerUrl, roomCodeFromUrl, saveSession };
