/**
 * JET TCG — transporte do multiplayer (único lugar que conhece WebSocket).
 *
 * A UI nunca toca em `WebSocket` diretamente: fala com o `MultiplayerTransport`
 * e recebe mensagens já validadas pelo protocolo compartilhado. Isso mantém o
 * modo IA/local 100% independente e permite testar o fluxo com um transporte
 * falso.
 *
 * Reconexão: ao cair a conexão, tenta reabrir com backoff e o store reenvia o
 * handshake (`RECONNECT` com o `seatToken` salvo) — a sala preserva o assento.
 */

import { parseClientMessage, type ClientMessage, type ServerMessage } from '../net/protocol';

export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface TransportHooks {
  /** Chamado quando o socket abre (inclusive em reconexão) — reenviar handshake. */
  onOpen: () => void;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: TransportStatus) => void;
  /** Chamado quando todas as tentativas falharam. */
  onGaveUp: () => void;
}

export interface TransportOptions {
  baseUrl: string;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export const MAX_RECONNECT_ATTEMPTS = 8;

export class MultiplayerTransport {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private closedByUs = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private path = '';
  private status: TransportStatus = 'idle';
  private readonly maxAttempts: number;
  private readonly baseDelay: number;

  constructor(private opts: TransportOptions, private hooks: TransportHooks) {
    this.maxAttempts = opts.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
    this.baseDelay = opts.baseDelayMs ?? 700;
  }

  get currentStatus(): TransportStatus {
    return this.status;
  }

  /** Abre (ou reabre) a conexão para uma rota da sala. */
  connect(path: string): void {
    this.path = path;
    this.closedByUs = false;
    this.open();
  }

  /** Reenvia o handshake atual sem trocar de rota (usado após reconectar). */
  private open(): void {
    if (typeof WebSocket === 'undefined') {
      this.setStatus('closed');
      this.hooks.onGaveUp();
      return;
    }
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.fullUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
      this.hooks.onOpen();
    };
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return; // mensagem não-JSON é ignorada (o servidor nunca envia isso)
      }
      // Revalida no cliente: defesa em profundidade contra resposta estranha.
      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as ServerMessage;
      if (typeof (msg as { type?: unknown }).type !== 'string') return;
      this.hooks.onMessage(msg);
    };
    socket.onclose = () => {
      this.ws = null;
      if (this.closedByUs) {
        this.setStatus('closed');
        return;
      }
      this.scheduleRetry();
    };
    socket.onerror = () => {
      // `onclose` dispara em seguida e cuida do retry.
    };
  }

  private scheduleRetry(): void {
    this.attempt += 1;
    if (this.attempt > this.maxAttempts) {
      this.setStatus('closed');
      this.hooks.onGaveUp();
      return;
    }
    this.setStatus('reconnecting');
    const delay = Math.min(15_000, this.baseDelay * 2 ** (this.attempt - 1));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  /** Envia uma mensagem; ignora silenciosamente se não houver conexão. */
  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    // Só sai o que o próprio protocolo aceita (nada de payload arbitrário).
    if (!parseClientMessage(msg)) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Fecha sem tentar reconectar (sair da sala). */
  close(): void {
    this.closedByUs = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ws) {
      try { this.ws.close(1000, 'client leaving'); } catch { /* noop */ }
      this.ws = null;
    }
    this.attempt = 0;
    this.setStatus('closed');
  }

  dispose(): void {
    this.close();
  }

  private fullUrl(): string {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    return `${base}${this.path}`;
  }

  private setStatus(status: TransportStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.hooks.onStatus(status);
  }
}

// ---------------------------------------------------------------------------
// Sessão local (só o necessário para reconectar)
// ---------------------------------------------------------------------------

export interface RoomSession {
  roomCode: string;
  seat: 0 | 1;
  seatToken: string;
  name: string;
}

const SESSION_KEY = 'jet-tcg:room-session:v1';

/**
 * Guarda a sessão em `sessionStorage`: sobrevive a reload da aba, morre ao
 * fechar — exatamente o tempo útil de um `seatToken`. Nunca vai para
 * `localStorage` (segredo de curta duração não deve ficar persistente).
 */
export function saveSession(session: RoomSession | null): void {
  try {
    if (!session) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Sem storage a reconexão automática não funciona; o código ainda serve.
  }
}

export function loadSession(): RoomSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoomSession;
    if (typeof parsed?.roomCode !== 'string' || (parsed.seat !== 0 && parsed.seat !== 1) || typeof parsed.seatToken !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** URL do servidor (env). Vazio = multiplayer não configurado. */
export function multiplayerUrl(): string {
  const raw = (import.meta.env.VITE_MULTIPLAYER_URL as string | undefined)?.trim();
  return raw ?? '';
}

/** Código de sala vindo do invite link (`?room=XXXXXX`). */
export function roomCodeFromUrl(search: string = window.location.search): string {
  try {
    const value = new URLSearchParams(search).get('room');
    return value ? value.trim().toUpperCase() : '';
  } catch {
    return '';
  }
}

export function inviteLink(roomCode: string, base: string = window.location.origin + window.location.pathname): string {
  const url = new URL(base);
  url.searchParams.set('room', roomCode);
  url.searchParams.delete('seat');
  return url.toString();
}
