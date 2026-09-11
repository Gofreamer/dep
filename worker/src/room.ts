/**
 * JET TCG Worker — Durable Object de sala.
 *
 * Uma instância por sala (exatamente 2 jogadores). Toda a regra fica em
 * `RoomCore` (módulo compartilhado, puro e testado); este arquivo cuida só de:
 *  - aceitar o WebSocket e ligar sockets ⇄ assentos;
 *  - aplicar limites de mensagem (tamanho, JSON válido, tipo conhecido);
 *  - persistir o lobby (sobrevive a reinício do isolado; tokens preservados
 *    para reconexão);
 *  - agendar o alarm de TTL/cleanup;
 *  - nunca vazar stack trace interno para o cliente.
 */

import {
  ERROR_TEXTS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  isRoomCode,
  normalizeRoomCode,
  parseClientMessage,
  type ClientMessage,
  type DeckSubmission,
  type Seat,
  type ServerMessage
} from '../../src/net/protocol';
import {
  DEFAULT_TTL,
  RoomCore,
  generateRoomCode,
  generateSeatToken,
  generateSeed,
  maskToken,
  payloadContainsBinaryArt,
  type RoomDeps,
  type RoomSnapshot
} from '../../src/net/roomCore';
import { isAllowedOrigin, parseOrigins } from './config';

export interface RoomEnv {
  CLIENT_ORIGINS?: string;
  /** `1` só em desenvolvimento local (wrangler dev sem Origin do Vite). */
  ALLOW_INSECURE_ORIGIN?: string;
}

const encoder = new TextEncoder();

export class RoomDO {
  private core: RoomCore | null = null;
  private sockets = new Map<string, WebSocket>();
  private seq = 0;
  private code = '';
  private restoring: Promise<void> | null = null;

  constructor(private state: DurableObjectState, private env: RoomEnv) {}

  // -------------------------------------------------------------------------
  // Fetch interno: probe (existe?) + sessão (WebSocket)
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/probe') {
      const stored = await this.state.storage.get<RoomSnapshot>('lobby');
      return new Response(stored ? 'exists' : 'empty', { status: stored ? 200 : 404 });
    }
    if (url.pathname !== '/session') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('upgrade required', { status: 426 });

    const cfg = parseOrigins(this.env.CLIENT_ORIGINS);
    if (this.env.ALLOW_INSECURE_ORIGIN !== '1' && !isAllowedOrigin(request.headers.get('Origin'), cfg)) {
      return new Response('forbidden', { status: 403 });
    }

    const code = normalizeRoomCode(url.searchParams.get('code'));
    if (!isRoomCode(code)) return new Response('bad room code', { status: 400 });
    this.code = code;
    await this.ensureCore();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const connectionId = `c${++this.seq}`;
    this.sockets.set(connectionId, server);
    this.bindSocket(server, connectionId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    await this.ensureCore();
    const core = this.core;
    if (!core) return;
    const result = core.onTick();
    if (result.action === 'close') {
      await this.shutdown(result.reason);
      return;
    }
    await this.state.storage.setAlarm(Date.now() + result.delayMs);
  }

  /** Cria o `RoomCore` a partir do storage (uma única vez). */
  private async ensureCore(): Promise<void> {
    if (this.core) return;
    if (!this.restoring) {
      this.restoring = (async () => {
        const stored = await this.state.storage.get<RoomSnapshot>('lobby');
        const core = new RoomCore(this.code, this.deps(), DEFAULT_TTL);
        if (stored) {
          core.applySnapshot(stored);
          console.log(`[room] lobby restaurado ${this.code} (tokens: ${maskToken(stored.seats[0]?.token ?? '')})`);
        }
        this.core = core;
      })();
    }
    await this.restoring;
  }

  // -------------------------------------------------------------------------
  // Socket ⇄ RoomCore
  // -------------------------------------------------------------------------

  private bindSocket(server: WebSocket, connectionId: string): void {
    let seat: Seat | null = null;

    server.addEventListener('message', async (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? event.data : '';
        if (!data || encoder.encode(data).byteLength > MAX_MESSAGE_BYTES) {
          this.sendTo(connectionId, { type: 'ERROR', code: 'message_too_large', message: 'Mensagem grande demais.' });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          this.sendTo(connectionId, { type: 'ERROR', code: 'bad_message', message: 'Mensagem não pôde ser lida.' });
          return;
        }
        const msg = parseClientMessage(parsed);
        if (!msg) {
          this.sendTo(connectionId, { type: 'ERROR', code: 'bad_message', message: 'Mensagem desconhecida.' });
          return;
        }
        if (msg.type === 'CREATE_ROOM' || msg.type === 'JOIN_ROOM' || msg.type === 'RECONNECT') {
          seat = await this.handleEntry(msg, connectionId);
          return;
        }
        if (seat === null) {
          this.sendTo(connectionId, { type: 'ERROR', code: 'bad_token', message: 'Entre na sala antes de jogar.' });
          return;
        }
        this.core?.handle(seat, msg);
        if (msg.type === 'SELECT_DECK' || msg.type === 'READY' || msg.type === 'REMATCH' || msg.type === 'LEAVE') {
          await this.persist();
        }
      } catch (err) {
        // Stack interno NUNCA vai para o cliente; só para o log do Worker.
        console.error('[room] erro interno ao processar mensagem', connectionId, err);
        this.sendTo(connectionId, { type: 'ERROR', code: 'internal', message: 'Erro interno. Tente novamente.' });
      }
    });

    const dropped = (): void => {
      this.sockets.delete(connectionId);
      this.core?.detach(connectionId);
      try { server.close(1000, 'closed'); } catch { /* noop */ }
    };
    server.addEventListener('close', dropped);
    server.addEventListener('error', () => dropped());
  }

  /**
   * Resolve entrada na sala. `seatToken` só é enviado UMA vez (na criação ou
   * na primeira entrada); em reconexão o cliente já o possui.
   */
  private async handleEntry(msg: ClientMessage, connectionId: string): Promise<Seat | null> {
    const core = this.core;
    if (!core) {
      this.sendTo(connectionId, { type: 'ERROR', code: 'internal', message: 'Sala indisponível.' });
      return null;
    }
    if (msg.type === 'CREATE_ROOM') {
      if (core.seatInfo(0).present || core.seatInfo(1).present) {
        this.sendTo(connectionId, { type: 'ERROR', code: 'room_full', message: 'Esta sala já existe.' });
        return null;
      }
      const { seat, seatToken } = core.create(msg.name);
      core.attach(seat, connectionId);
      this.sendTo(connectionId, core.joinedMessage(seat, seatToken));
      await this.persist();
      await this.armAlarm();
      return seat;
    }
    if (msg.type === 'JOIN_ROOM') {
      // Sala sem nenhum jogador é sala que nunca foi criada (código digitado
      // errado) ou que já foi encerrada — entrar NÃO pode criá-la.
      const exists = core.seatInfo(0).present || core.seatInfo(1).present;
      if (msg.roomCode !== core.roomCode || !exists) {
        this.sendTo(connectionId, { type: 'ERROR', code: 'room_not_found', message: ERROR_TEXTS.room_not_found });
        return null;
      }
      const result = core.join(msg.name);
      if ('error' in result) {
        this.sendTo(connectionId, {
          type: 'ERROR',
          code: result.error,
          message: result.error === 'room_full' ? 'Esta sala já está cheia.' : 'Não foi possível entrar.'
        });
        return null;
      }
      core.attach(result.seat, connectionId);
      this.sendTo(connectionId, core.joinedMessage(result.seat, result.seatToken));
      await this.persist();
      await this.armAlarm();
      return result.seat;
    }
    // RECONNECT
    if (msg.type !== 'RECONNECT') return null;
    const result = core.reconnect(msg.roomCode, msg.seatToken);
    if ('error' in result) {
      this.sendTo(connectionId, { type: 'ERROR', code: result.error, message: 'Sessão da sala inválida. Entre pelo código.' });
      return null;
    }
    core.attach(result.seat, connectionId);
    this.sendTo(connectionId, {
      type: 'JOINED',
      protocolVersion: PROTOCOL_VERSION,
      roomCode: core.roomCode,
      seat: result.seat,
      seatToken: '',
      lobby: core.lobbyView()
    });
    await this.armAlarm();
    return result.seat;
  }

  private deps(): RoomDeps {
    return {
      now: () => Date.now(),
      randomRoomCode: () => generateRoomCode(randomInt),
      randomToken: () => generateSeatToken(),
      randomSeed: () => generateSeed(),
      send: (seat, msg) => this.sendToSeat(seat, msg),
      close: (reason) => { void this.shutdown(reason); },
      scheduleTick: (delay) => { void this.armAlarm(delay); }
    };
  }

  // -------------------------------------------------------------------------
  // Saída
  // -------------------------------------------------------------------------

  private sendToSeat(seat: Seat, msg: ServerMessage): void {
    for (const [id, ws] of this.sockets) {
      if (this.core?.seatOfConnection(id) === seat) this.write(ws, msg);
    }
  }

  private sendTo(connectionId: string, msg: ServerMessage): void {
    const ws = this.sockets.get(connectionId);
    if (ws) this.write(ws, msg);
  }

  private write(ws: WebSocket, msg: ServerMessage): void {
    try {
      const text = JSON.stringify(msg);
      // Defesa em profundidade: nenhuma mensagem pode carregar imagem/base64.
      if (payloadContainsBinaryArt(text)) {
        console.error('[room] mensagem com conteúdo binário bloqueada');
        return;
      }
      ws.send(text);
    } catch (err) {
      console.error('[room] falha ao enviar mensagem', err);
    }
  }

  private async armAlarm(delay = 60_000): Promise<void> {
    try {
      const current = await this.state.storage.getAlarm();
      const at = Date.now() + delay;
      if (current === null || current > at) await this.state.storage.setAlarm(at);
    } catch (err) {
      console.error('[room] falha ao agendar alarm', err);
    }
  }

  private async persist(): Promise<void> {
    const core = this.core;
    if (!core) return;
    await this.state.storage.put<RoomSnapshot>('lobby', core.snapshot());
  }

  private async shutdown(reason: string): Promise<void> {
    console.log(`[room] encerrando ${this.code}: ${reason}`);
    for (const ws of this.sockets.values()) {
      try { ws.close(1000, 'room closed'); } catch { /* noop */ }
    }
    this.sockets.clear();
    this.core?.destroy();
    this.core = null;
    await this.state.storage.deleteAll();
  }
}

/** Inteiro criptograficamente aleatório em `[0, max)`. */
export function randomInt(max: number): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] % max;
}

/**
 * Aloca um código de sala livre: gera candidato e pergunta ao Durable Object
 * correspondente se ele já existe (`/probe` → 404 = livre).
 */
export async function allocateRoomCode(env: { JET_ROOM: DurableObjectNamespace }): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateRoomCode(randomInt);
    const stub = env.JET_ROOM.get(env.JET_ROOM.idFromName(code));
    try {
      const res = await stub.fetch('https://room.internal/probe');
      if (res.status === 404) return code;
    } catch {
      // DO inalcançável: assume livre (o probe é otimização, não corretude).
      return code;
    }
  }
  throw new Error('não foi possível alocar código de sala');
}

export type { DeckSubmission };
