/**
 * JET TCG — teste de integração REAL contra o Worker (Cloudflare local).
 *
 * Não é simulado: dois clientes WebSocket reais falam com o `wrangler dev`
 * (workerd + Durable Object local) e exercitam o fluxo completo de sala.
 *
 * Só roda quando `JET_WORKER_URL` está definido (ex.: `http://127.0.0.1:8787`).
 * Sem isso o arquivo é ignorado — o núcleo da sala continua coberto em
 * `tests/net-room.test.ts`, que não precisa de rede.
 *
 *   JET_WORKER_URL=http://127.0.0.1:8787 npx vitest run tests/worker-live.test.ts
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { CardInstance, Command, MatchState, PlayerId } from '../src/engine/types';
import { ROOM_CODE_ALPHABET, type LobbyView, type PublicMatchView, type ServerMessage } from '../src/net/protocol';

const BASE = process.env.JET_WORKER_URL ?? '';
const ORIGIN = process.env.JET_WORKER_ORIGIN ?? 'http://localhost:5173';
const describeIf = BASE ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Cliente WebSocket mínimo (pacote `ws`: permite enviar o cabeçalho Origin,
// que o Worker exige por segurança).
// ---------------------------------------------------------------------------

class TestClient {
  private socket: WebSocket | null = null;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; from: number }[] = [];
  /** Todas as mensagens recebidas, na ordem. `waitFor` varre este histórico. */
  messages: ServerMessage[] = [];
  revision = 0;
  roomCode = '';
  seat: 0 | 1 = 0;
  seatToken = '';
  closed: string | null = null;

  async connect(path: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}${path}`, { headers: { Origin: ORIGIN } });
      this.socket = ws;
      ws.on('open', () => resolve());
      ws.on('error', () => reject(new Error(`falha ao conectar em ${path}`)));
      ws.on('message', (data: Buffer | string) => this.receive(String(data)));
      ws.on('close', (code: number, reason: Buffer) => { this.socket = null; this.closed = `${code} ${reason.toString()}`; });
    });
  }

  private receive(raw: string): void {
    const msg = JSON.parse(raw) as ServerMessage;
    this.messages.push(msg);
    if ('revision' in msg) this.revision = msg.revision;
    if (msg.type === 'JOINED') {
      this.roomCode = msg.roomCode;
      this.seat = msg.seat;
      if (msg.seatToken) this.seatToken = msg.seatToken;
    }
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (w.pred(msg)) {
        clearTimeout(w.timer);
        this.waiters.splice(i, 1);
        w.resolve(msg);
      }
    }
  }

  send(msg: unknown): void {
    if (!this.socket) throw new Error('socket fechado');
    this.socket.send(JSON.stringify(msg));
  }

  /** Índice atual do histórico — use para esperar só mensagens novas. */
  mark(): number {
    return this.messages.length;
  }

  /**
   * Espera uma mensagem que satisfaça o predicado, varrendo primeiro o
   * histórico a partir de `from` (o servidor responde muito rápido; registrar
   * o observador depois do envio perderia a mensagem).
   */
  waitFor(pred: (m: ServerMessage) => boolean, label: string, timeoutMs = 10_000, from = 0): Promise<ServerMessage> {
    for (let i = from; i < this.messages.length; i++) {
      if (pred(this.messages[i])) return Promise.resolve(this.messages[i]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`timeout esperando ${label} (recebidas: ${this.messages.map((m) => m.type).join(',')}${this.closed ? ` | socket fechado: ${this.closed}` : ''})`));
      }, timeoutMs);
      this.waiters.push({ pred, resolve, reject, timer, from });
    });
  }

  waitType(type: ServerMessage['type'], timeoutMs = 10_000, from = 0): Promise<ServerMessage> {
    return this.waitFor((m) => m.type === type, type, timeoutMs, from);
  }

  lastOf<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].type === type) return this.messages[i] as Extract<ServerMessage, { type: T }>;
    }
    return null;
  }

  /**
   * Espera o socket ficar em silêncio por `ms`. Sem isso, um STATE ainda em
   * trânsito do comando anterior resolve o observador do comando seguinte.
   */
  async settle(ms = 80): Promise<void> {
    let last = this.messages.length;
    let since = Date.now();
    while (Date.now() - since < ms) {
      await new Promise((r) => setTimeout(r, 10));
      if (this.messages.length !== last) { last = this.messages.length; since = Date.now(); }
    }
  }

  /** Espera a visão local alcançar a revision informada (sincroniza os dois clientes). */
  syncTo(revision: number, timeoutMs = 10_000): Promise<ServerMessage> {
    return this.waitFor((m) => 'revision' in m && m.revision >= revision, `sync até r${revision}`, timeoutMs);
  }

  /**
   * Envia um comando e espera a resposta DELE: um STATE com revision maior que
   * a do envio, ou um COMMAND_REJECTED com o mesmo commandId.
   */
  async command(cmd: Command, commandId: string, revisionOverride?: number): Promise<ServerMessage> {
    await this.settle();
    const from = this.mark();
    const revAtSend = this.revision;
    const pending = this.waitFor(
      (m) => (m.type === 'STATE' && m.revision > revAtSend) || (m.type === 'COMMAND_REJECTED' && m.commandId === commandId),
      `resposta de ${cmd.type}`,
      10_000,
      from
    );
    this.send({ type: 'COMMAND', commandId, revision: revisionOverride ?? revAtSend, command: cmd });
    return pending;
  }

  close(): void {
    try { this.socket?.close(1000, 'bye'); } catch { /* noop */ }
    this.socket = null;
  }
}

/**
 * Faz o upgrade "na mão" para inspecionar o status HTTP recusado.
 * (`fetch` do Node proíbe definir os cabeçalhos Upgrade/Connection.)
 */
function rawUpgradeStatus(path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, BASE), { headers }, (res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
    });
    req.on('error', reject);
    req.end();
  });
}

const STARTER_A = 'deck-jet-kof-12';
const STARTER_B = 'deck-jet-asgard';

/** revision de uma mensagem que a carrega (falha explícito se não tiver). */
function revOf(m: ServerMessage): number {
  if (!('revision' in m)) throw new Error(`mensagem ${m.type} não carrega revision`);
  return m.revision;
}

function baseUid(view: PublicMatchView, seat: PlayerId): string {
  const hand: CardInstance[] = view.players[seat].hand;
  const starter = hand.find((c) => c.kind === 'CHARACTER');
  if (!starter) throw new Error('mão inicial sem agente Base');
  return starter.uid;
}

describeIf('Worker + Durable Object (integração real via WebSocket)', () => {
  let a: TestClient;
  let b: TestClient;
  let c: TestClient;

  beforeAll(async () => {
    // O Worker precisa estar de pé antes de qualquer asserção.
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; protocolVersion: number };
    expect(body.ok).toBe(true);
    expect(body.protocolVersion).toBe(1);
  }, 20_000);

  afterAll(() => {
    a?.close();
    b?.close();
    c?.close();
  });

  it('health responde sem CORS para origem não permitida', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await fetch(`${BASE}/health`, { headers: { Origin: ORIGIN } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('WebSocket sem Origin permitido é recusado (403)', async () => {
    const upgrade = { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' };
    expect(await rawUpgradeStatus('/room/new', { ...upgrade, Origin: 'https://evil.example' })).toBe(403);
    expect(await rawUpgradeStatus('/room/new', { ...upgrade })).toBe(403); // sem Origin nenhum
  });

  it('criar sala → código de 6 caracteres, assento 0 e token', async () => {
    a = new TestClient();
    await a.connect('/room/new');
    const joined = a.waitType('JOINED');
    a.send({ type: 'CREATE_ROOM', name: 'Ana' });
    const msg = (await joined) as Extract<ServerMessage, { type: 'JOINED' }>;
    expect(msg.seat).toBe(0);
    expect(msg.roomCode).toMatch(/^[3-9A-HJ-NP-Y]{6}$/);
    expect(msg.seatToken.length).toBeGreaterThan(16);
    expect(msg.protocolVersion).toBe(1);
    expect(msg.lobby.players[0].name).toBe('Ana');
    expect(msg.lobby.players[1].present).toBe(false);
  }, 20_000);

  it('jogador 2 entra pelo código; terceiro é recusado', async () => {
    b = new TestClient();
    await b.connect(`/room/${a.roomCode}`);
    const joined = b.waitType('JOINED');
    b.send({ type: 'JOIN_ROOM', roomCode: a.roomCode, name: 'Bruno' });
    const msg = (await joined) as Extract<ServerMessage, { type: 'JOINED' }>;
    expect(msg.seat).toBe(1);
    expect(msg.roomCode).toBe(a.roomCode);
    expect(msg.seatToken).not.toBe(a.seatToken);
    // o lobby do jogador 1 atualiza
    const lobby = (await a.waitFor((m) => m.type === 'LOBBY' && m.lobby.players[1].present, 'LOBBY com jogador 2')) as Extract<ServerMessage, { type: 'LOBBY' }>;
    expect(lobby.lobby.players[1].name).toBe('Bruno');
    // LOBBY nunca carrega token
    expect(JSON.stringify(lobby.lobby)).not.toContain(a.seatToken);

    c = new TestClient();
    await c.connect(`/room/${a.roomCode}`);
    const err = c.waitType('ERROR');
    c.send({ type: 'JOIN_ROOM', roomCode: a.roomCode, name: 'Carlos' });
    const msgErr = (await err) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(msgErr.code).toBe('room_full');
    c.close();
  }, 30_000);

  it('sala inexistente devolve room_not_found; código malformado é recusado no HTTP', async () => {
    // Código bem formado mas inexistente: o socket abre e o servidor responde
    // room_not_found — é o texto que o cliente mostra ao jogador.
    // Código bem formado porém jamais criado — aleatório para não colidir com
    // estado persistido de execuções anteriores do wrangler dev.
    const ghostCode = Array.from({ length: 6 }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]).join('');
    const ghost = new TestClient();
    await ghost.connect(`/room/${ghostCode}`);
    const from = ghost.mark();
    ghost.send({ type: 'JOIN_ROOM', roomCode: ghostCode, name: 'Ninguém' });
    const msg = (await ghost.waitType('ERROR', 10_000, from)) as Extract<ServerMessage, { type: 'ERROR' }>;
    expect(msg.code).toBe('room_not_found');
    expect(msg.message).toBe('Sala não encontrada. Confira o código.');
    ghost.close();

    // 'Z' e '1'/'2' não existem no alfabeto de códigos (anti-ambiguidade):
    // recusados antes do upgrade, sem abrir WebSocket.
    const up = { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: ORIGIN };
    expect(await rawUpgradeStatus('/room/ZZZZZZ', up)).toBe(400);
    expect(await rawUpgradeStatus('/room/ABC123', up)).toBe(400);
  }, 20_000);

  it('deck inválido é recusado pelo servidor; dois prontos iniciam a partida', async () => {
    // deck inválido (vazio)
    const bad = a.waitType('ERROR');
    a.send({ type: 'SELECT_DECK', deck: { kind: 'custom', name: 'Vazio', cards: {} } });
    expect(((await bad) as Extract<ServerMessage, { type: 'ERROR' }>).code).toBe('invalid_deck');

    const startA = a.waitType('MATCH_START');
    const startB = b.waitType('MATCH_START');
    a.send({ type: 'SELECT_DECK', deck: { kind: 'starter', deckId: STARTER_A } });
    b.send({ type: 'SELECT_DECK', deck: { kind: 'starter', deckId: STARTER_B } });
    a.send({ type: 'READY', ready: true });
    b.send({ type: 'READY', ready: true });

    const msgA = (await startA) as Extract<ServerMessage, { type: 'MATCH_START' }>;
    const msgB = (await startB) as Extract<ServerMessage, { type: 'MATCH_START' }>;
    expect(msgA.match.players[0].hand.length).toBeGreaterThan(0);
    expect(msgB.match.players[1].hand.length).toBeGreaterThan(0);
    // seed/RNG nunca vazam
    expect(msgA.match.seed).toBe(0);
    expect(msgA.match.rngState).toBe(0);
    // visão do adversário: mão e baralho VAZIOS, só contagem
    expect(msgA.match.players[1].hand).toEqual([]);
    expect(msgA.match.players[1].deck).toEqual([]);
    expect(msgA.match.hidden.hand).toBeGreaterThan(0);
    expect(msgA.match.hidden.deck).toBeGreaterThan(0);
    // nenhuma imagem trafega
    for (const raw of [JSON.stringify(msgA), JSON.stringify(msgB)]) {
      expect(raw).not.toMatch(/data:image\//i);
      expect(raw).not.toMatch(/https?:\/\/[^\s"]+\.(png|jpg|jpeg|webp|gif)/i);
    }
  }, 30_000);

  it('setup dos dois lados leva à fase principal', async () => {
    const uidA = baseUid((a.lastOf('MATCH_START') as Extract<ServerMessage, { type: 'MATCH_START' }>).match, 0);
    const uidB = baseUid((b.lastOf('MATCH_START') as Extract<ServerMessage, { type: 'MATCH_START' }>).match, 1);
    // Cada comando precisa da revision atual; os dois clientes são
    // sincronizados entre si de propósito (como a UI real faz antes de
    // habilitar os controles).
    const r1 = await a.command({ type: 'SETUP_SET_ACTIVE', player: 0, uid: uidA }, 'a-act');
    expect(r1.type).toBe('STATE');
    await b.syncTo(revOf(r1));
    const r2 = await a.command({ type: 'SETUP_DONE', player: 0 }, 'a-done');
    expect(r2.type).toBe('STATE');
    await b.syncTo(revOf(r2));
    const r3 = await b.command({ type: 'SETUP_SET_ACTIVE', player: 1, uid: uidB }, 'b-act');
    expect(r3.type).toBe('STATE');
    await a.syncTo(revOf(r3));
    const r4 = await b.command({ type: 'SETUP_DONE', player: 1 }, 'b-done');
    expect(r4.type).toBe('STATE');
    await a.syncTo(revOf(r4));
    await a.waitFor((m) => m.type === 'STATE' && m.match.phase !== 'setup', 'fase principal');
    await b.waitFor((m) => m.type === 'STATE' && m.match.phase !== 'setup', 'fase principal');
    expect((a.lastOf('STATE') as Extract<ServerMessage, { type: 'STATE' }>).match.turn).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('comando do jogador errado e comando ilegal são recusados; legal aplica e sobe a revision', async () => {
    const view = (a.lastOf('STATE') as Extract<ServerMessage, { type: 'STATE' }>).match as unknown as MatchState;
    const turn = view.activePlayer;
    const wrong = (turn === 0 ? b : a);
    const wrongSeat = turn === 0 ? 1 : 0;
    const rej = await wrong.command({ type: 'END_TURN', player: wrongSeat as PlayerId }, 'wrong-1');
    expect(rej.type).toBe('COMMAND_REJECTED');

    const owner = turn === 0 ? a : b;
    const illegal = await owner.command({ type: 'ATTACK', player: turn, attackId: 'ataque-inexistente' }, 'illegal-1');
    expect(illegal.type).toBe('COMMAND_REJECTED');

    const before = owner.revision;
    const ok = await owner.command({ type: 'END_TURN', player: turn }, 'legal-1');
    if (ok.type !== 'STATE') throw new Error(`esperava STATE, veio ${ok.type}`);
    expect(ok.revision).toBe(before + 1);
  }, 30_000);

  it('revision stale é recusada e commandId duplicado não aplica duas vezes', async () => {
    const view = (a.lastOf('STATE') as Extract<ServerMessage, { type: 'STATE' }>).match as unknown as MatchState;
    const turn = view.activePlayer;
    const owner = turn === 0 ? a : b;
    const stale = await owner.command({ type: 'END_TURN', player: turn }, 'stale-1', 1);
    expect(stale.type).toBe('COMMAND_REJECTED');
    expect((stale as Extract<ServerMessage, { type: 'COMMAND_REJECTED' }>).code).toBe('stale_revision');

    const dupFirst = await owner.command({ type: 'END_TURN', player: turn }, 'dup-id');
    expect(dupFirst.type).toBe('STATE');
    const dup = await owner.command({ type: 'END_TURN', player: turn }, 'dup-id');
    expect(dup.type).toBe('COMMAND_REJECTED');
    expect((dup as Extract<ServerMessage, { type: 'COMMAND_REJECTED' }>).code).toBe('duplicate');
  }, 30_000);

  it('mensagem malformada e payload gigante são recusados sem derrubar a sala', async () => {
    let from = a.mark();
    a.send('isso não é json');
    expect(((await a.waitType('ERROR', 10_000, from)) as Extract<ServerMessage, { type: 'ERROR' }>).code).toBe('bad_message');
    from = a.mark();
    a.send(JSON.stringify({ type: 'SELECT_DECK', deck: { kind: 'custom', name: 'x'.repeat(5), cards: {} }, lixo: 'y'.repeat(120_000) }));
    expect(((await a.waitType('ERROR', 10_000, from)) as Extract<ServerMessage, { type: 'ERROR' }>).code).toBe('message_too_large');
    // a sala continua viva
    const pong = a.waitType('PONG', 10_000, a.mark());
    a.send({ type: 'PING', t: 42 });
    expect(((await pong) as Extract<ServerMessage, { type: 'PONG' }>).t).toBe(42);
  }, 20_000);

  it('desconexão preserva assento e reconexão com token restaura a visão', async () => {
    const peerOff = a.waitType('PEER_STATUS');
    b.close();
    const msg = (await peerOff) as Extract<ServerMessage, { type: 'PEER_STATUS' }>;
    expect(msg.connected).toBe(false);

    const b2 = new TestClient();
    await b2.connect(`/room/${a.roomCode}`);
    const joined = b2.waitType('JOINED');
    b2.send({ type: 'RECONNECT', roomCode: a.roomCode, seatToken: b.seatToken });
    const re = (await joined) as Extract<ServerMessage, { type: 'JOINED' }>;
    expect(re.seat).toBe(1);
    // token NÃO é reenviado em reconexão
    expect(re.seatToken).toBe('');
    const restored = (await b2.waitType('STATE')) as Extract<ServerMessage, { type: 'STATE' }>;
    expect(restored.match.players[1].hand.length).toBeGreaterThan(0);
    expect(restored.match.players[0].hand).toEqual([]);
    // token errado é recusado
    const bad = new TestClient();
    await bad.connect(`/room/${a.roomCode}`);
    const err = bad.waitType('ERROR');
    bad.send({ type: 'RECONNECT', roomCode: a.roomCode, seatToken: 'token-errado' });
    expect(((await err) as Extract<ServerMessage, { type: 'ERROR' }>).code).toBe('bad_token');
    bad.close();
    b = b2;
  }, 40_000);

  it('conceder encerra a partida com vencedor decidido pelo servidor', async () => {
    const overA = a.waitType('MATCH_OVER');
    const overB = b.waitType('MATCH_OVER');
    a.send({ type: 'CONCEDE' });
    const msgA = (await overA) as Extract<ServerMessage, { type: 'MATCH_OVER' }>;
    const msgB = (await overB) as Extract<ServerMessage, { type: 'MATCH_OVER' }>;
    expect(msgA.winner).toBe(1);
    expect(msgB.winner).toBe(1);
    expect(msgA.reason).toBe('concede');
  }, 30_000);

  it('revanche exige os dois e cria partida nova', async () => {
    const lobbyA = a.waitFor((m) => m.type === 'LOBBY', 'LOBBY pós-fim');
    a.send({ type: 'REMATCH', want: true });
    await lobbyA;
    // só um dos dois: ainda não reiniciou
    expect(a.messages.filter((m) => m.type === 'MATCH_START').length).toBe(1);
    const startA = a.waitType('MATCH_START');
    const startB = b.waitType('MATCH_START');
    b.send({ type: 'REMATCH', want: true });
    const msgA = (await startA) as Extract<ServerMessage, { type: 'MATCH_START' }>;
    await startB;
    expect(msgA.match.phase).toBe('setup');
    expect(msgA.match.winner).toBeNull();
    expect(msgA.match.turn).toBe(0);
    expect(a.messages.filter((m) => m.type === 'MATCH_START').length).toBe(2);
  }, 30_000);

  it('lobby informa os dois jogadores com deck e pronto', async () => {
    const lobby = (a.lastOf('LOBBY') ?? (await a.waitType('LOBBY'))) as Extract<ServerMessage, { type: 'LOBBY' }>;
    const players: LobbyView['players'] = lobby.lobby.players;
    expect(players[0].present).toBe(true);
    expect(players[1].present).toBe(true);
    expect(players[0].deckName).toBeTruthy();
    expect(players[1].deckName).toBeTruthy();
    // o token nunca aparece em nenhuma mensagem de lobby
    for (const m of a.messages.filter((x) => x.type === 'LOBBY')) {
      expect(JSON.stringify(m)).not.toContain(a.seatToken);
    }
  }, 20_000);
});
