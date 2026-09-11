import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_TTL,
  RoomCore,
  expandDeckCards,
  generateRoomCode,
  maskToken,
  resolveStarterDeck,
  type RoomDeps
} from '../src/net/roomCore';
import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isRoomCode,
  normalizeRoomCode,
  parseClientMessage,
  parseCommand,
  parseDeckSubmission,
  sanitizeName,
  type Seat,
  type ServerMessage
} from '../src/net/protocol';
import { sanitizeLogFor, viewForPlayer, viewLeaksNothingOf, type PublicMatchView } from '../src/net/view';
import { registerJetDataPack } from '../src/data/jet/pack';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';
import type { Command, MatchState, PlayerId } from '../src/engine/types';

registerJetDataPack();

// ---------------------------------------------------------------------------
// Harness: liga RoomCore a caixas de entrada, relógio e RNG determinísticos.
// ---------------------------------------------------------------------------

interface Harness {
  room: RoomCore;
  inbox: Record<Seat, ServerMessage[]>;
  now: () => number;
  advance(ms: number): void;
  tick(): ReturnType<RoomCore['onTick']>;
  closedReason: () => string | null;
  lastTickDelay: () => number | null;
  drain(seat: Seat): ServerMessage[];
  lastOfType(seat: Seat, type: ServerMessage['type']): any;
}

function makeRoom(code = 'JTMVP4'): Harness {
  const inbox: Record<Seat, ServerMessage[]> = { 0: [], 1: [] };
  let clock = 1_000_000;
  let tokens = 0;
  let closed: string | null = null;
  let lastDelay: number | null = null;
  const deps: RoomDeps = {
    now: () => clock,
    randomRoomCode: () => code,
    randomToken: () => `tok-${++tokens}-${'x'.repeat(40)}`,
    randomSeed: () => 987654321,
    send: (seat, msg) => { inbox[seat].push(msg); },
    close: (reason) => { closed = reason; },
    scheduleTick: (d) => { lastDelay = d; }
  };
  const room = new RoomCore(code, deps, DEFAULT_TTL);
  return {
    room,
    inbox,
    now: () => clock,
    advance: (ms) => { clock += ms; },
    tick: () => room.onTick(),
    closedReason: () => closed,
    lastTickDelay: () => lastDelay,
    drain: (seat) => { const out = inbox[seat].splice(0); return out; },
    lastOfType: (seat, type) => [...inbox[seat]].reverse().find((m) => m.type === type) ?? null
  };
}

/** Ocupa os dois assentos, conecta e deixa ambos prontos → partida inicia. */
function startPlaying(h: Harness): { tokens: [string, string] } {
  const a = h.room.create('Ana');
  const b = h.room.join('Bruno');
  if ('error' in b) throw new Error('join falhou');
  h.room.attach(0, 'conn-a');
  h.room.attach(1, 'conn-b');
  h.room.selectDeck(0, { kind: 'starter', deckId: JET_STARTER_DECKS[0].id });
  h.room.selectDeck(1, { kind: 'starter', deckId: JET_STARTER_DECKS[1].id });
  h.room.setReady(0, true);
  h.room.setReady(1, true);
  return { tokens: [a.seatToken, b.seatToken] };
}

/** Jogador da vez segundo o engine autoritativo (não segundo a caixa de entrada). */
function activePlayer(h: Harness): PlayerId {
  const engine = h.room['engine'] as unknown as { state: MatchState } | null;
  if (!engine) throw new Error('partida não iniciada');
  return engine.state.activePlayer;
}

function matchStartFor(h: Harness, seat: Seat) {
  const msg = h.lastOfType(seat, 'MATCH_START');
  expect(msg?.type).toBe('MATCH_START');
  return msg;
}

function baseUidInView(view: MatchState, seat: PlayerId): string {
  const hand = view.players[seat].hand;
  const starter = hand.find((c) => c.kind === 'CHARACTER');
  expect(starter, 'mão inicial precisa ter agente Base').toBeTruthy();
  return starter!.uid;
}

/** Conduz o setup dos dois lados e devolve o comando de fim de setup. */
function completeSetup(h: Harness): void {
  for (const seat of [0, 1] as Seat[]) {
    const view = matchStartFor(h, seat).match as MatchState;
    const uid = baseUidInView(view, seat);
    h.drain(seat);
    h.room.command(seat, `setup-active-${seat}`, h.room.revision, { type: 'SETUP_SET_ACTIVE', player: seat, uid });
    h.room.command(seat, `setup-done-${seat}`, h.room.revision, { type: 'SETUP_DONE', player: seat });
  }
}

// ---------------------------------------------------------------------------
// 1. protocolo: parsing, validação e limites
// ---------------------------------------------------------------------------

describe('protocolo', () => {
  it('código de sala: 6 caracteres sem ambiguidade e validação estrita', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode((max) => i % max);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isRoomCode(code)).toBe(true);
      for (const ch of code) expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(true);
    }
    expect(isRoomCode('ABC')).toBe(false);
    expect(isRoomCode('ABCDEF')).toBe(true);
    expect(isRoomCode('JT4MQ7')).toBe(true);
    expect(isRoomCode('ABCILO')).toBe(false); // I/L/O excluídos
    expect(isRoomCode('ABC0IL')).toBe(false); // 0/I/L excluídos
    expect(isRoomCode(null)).toBe(false);
    expect(isRoomCode(123456)).toBe(false);
    expect(normalizeRoomCode('  jt4mq7 ')).toBe('JT4MQ7');
    expect(normalizeRoomCode(undefined)).toBe('');
  });

  it('rejeita mensagem desconhecida / malformada / tipo inválido', () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage({})).toBeNull();
    expect(parseClientMessage({ type: 'DROP_TABLE' })).toBeNull();
    expect(parseClientMessage('PING')).toBeNull();
    expect(parseClientMessage({ type: 'JOIN_ROOM', roomCode: 'nope' })).toBeNull();
    expect(parseClientMessage({ type: 'JOIN_ROOM', roomCode: 'JT4MQ7', name: 'Ana' })?.type).toBe('JOIN_ROOM');
    expect(parseClientMessage({ type: 'PING', t: 'x' })).toEqual({ type: 'PING', t: 0 });
  });

  it('sanitiza nome de exibição', () => {
    expect(sanitizeName('  Ana  ')).toBe('Ana');
    expect(sanitizeName('')).toBe('Jogador');
    expect(sanitizeName(null)).toBe('Jogador');
    expect(sanitizeName('a\u0000b\u001bc')).toBe('abc');
    expect(sanitizeName('x'.repeat(200))).toHaveLength(24);
  });

  it('parseCommand aceita formas válidas e recusa o resto', () => {
    expect(parseCommand({ type: 'END_TURN', player: 0 })).toEqual({ type: 'END_TURN', player: 0 });
    expect(parseCommand({ type: 'ATTACK', player: 1, attackId: 'atk-x' })).toEqual({ type: 'ATTACK', player: 1, attackId: 'atk-x' });
    expect(parseCommand({ type: 'END_TURN', player: 7 })).toBeNull();
    expect(parseCommand({ type: 'ATTACK', player: 0 })).toBeNull();
    expect(parseCommand({ type: 'END_TURN', player: 0, extra: () => 1 })).not.toBeNull();
    expect(parseCommand({ type: 'debugCommand', player: 0 })).toBeNull();
    // Nunca aceita campos que não conhece de volta na saída:
    const parsed = parseCommand({ type: 'ATTACH_RESOURCE', player: 0, uid: 'u1', targetUid: 'u2', hacked: true }) as any;
    expect(parsed).toEqual({ type: 'ATTACH_RESOURCE', player: 0, uid: 'u1', targetUid: 'u2' });
    expect('hacked' in parsed).toBe(false);
  });

  it('parseDeckSubmission limita entradas e valores', () => {
    expect(parseDeckSubmission({ kind: 'starter', deckId: JET_STARTER_DECKS[0].id })?.kind).toBe('starter');
    expect(parseDeckSubmission({ kind: 'starter', deckId: '' })).toBeNull();
    expect(parseDeckSubmission({ kind: 'custom', name: 'X', cards: { a: 0 } })).toBeNull();
    expect(parseDeckSubmission({ kind: 'custom', name: 'X', cards: { a: 1.5 } })).toBeNull();
    expect(parseDeckSubmission({ kind: 'custom', name: 'X', cards: { a: 100 } })).toBeNull();
    expect(parseDeckSubmission({ kind: 'custom', name: 'X', cards: {} })?.kind).toBe('custom');
    const huge: Record<string, number> = {};
    for (let i = 0; i < 200; i++) huge[`c${i}`] = 1;
    expect(parseDeckSubmission({ kind: 'custom', name: 'X', cards: huge })).toBeNull();
  });

  it('versão do protocolo é exposta ao cliente no JOINED', () => {
    const h = makeRoom();
    h.room.create('Ana');
    h.room.attach(0, 'c');
    const joined = h.room.joinedMessage(0, 'tk');
    expect(joined.type === 'JOINED' && joined.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('maskToken nunca expõe o token completo', () => {
    expect(maskToken('abcdef')).toBe('****');
    const masked = maskToken('0123456789abcdef');
    expect(masked).toBe('0123…cdef');
    expect(masked).not.toContain('456789ab');
  });
});

// ---------------------------------------------------------------------------
// 2. ciclo da sala (30 itens)
// ---------------------------------------------------------------------------

describe('sala privada — ciclo de vida', () => {
  let h: Harness;
  beforeEach(() => { h = makeRoom(); });

  it('1) criar sala gera código válido e assento 0 com token', () => {
    expect(isRoomCode(h.room.roomCode)).toBe(true);
    const { seat, seatToken } = h.room.create('Ana');
    expect(seat).toBe(0);
    expect(seatToken.length).toBeGreaterThan(16);
  });

  it('3/4) jogador 1 entra no assento 0 e jogador 2 no assento 1', () => {
    expect(h.room.create('Ana').seat).toBe(0);
    expect(h.room.join('Bruno')).toEqual(expect.objectContaining({ seat: 1 }));
  });

  it('5) terceiro jogador é recusado com room_full', () => {
    h.room.create('Ana');
    h.room.join('Bruno');
    expect(h.room.join('Carlos')).toEqual({ error: 'room_full' });
  });

  it('6) tokens de assento são diferentes entre si', () => {
    const a = h.room.create('Ana');
    const b = h.room.join('Bruno');
    if ('error' in b) throw new Error('join falhou');
    expect(a.seatToken).not.toBe(b.seatToken);
  });

  it('7/8) reconexão com token certo funciona; token errado é recusado', () => {
    const { tokens } = startPlaying(h);
    h.room.detach('conn-b');
    expect(h.room.reconnect(h.room.roomCode, tokens[1])).toEqual({ seat: 1 });
    expect(h.room.reconnect(h.room.roomCode, 'token-falso')).toEqual({ error: 'bad_token' });
    expect(h.room.reconnect('OUTRO1', tokens[1])).toEqual({ error: 'room_not_found' });
  });

  it('9/10) deck inválido é recusado e bloqueia o ready', () => {
    h.room.create('Ana');
    h.room.attach(0, 'c');
    h.room.selectDeck(0, { kind: 'custom', name: 'Vazio', cards: {} });
    const err = h.lastOfType(0, 'ERROR');
    expect(err.code).toBe('invalid_deck');
    expect(h.room.seatInfo(0).deckValid).toBe(false);
    h.drain(0);
    h.room.setReady(0, true);
    expect(h.lastOfType(0, 'ERROR').code).toBe('invalid_deck');
    expect(h.room.seatInfo(0).ready).toBe(false);
  });

  it('10b) baralho starter inexistente é recusado com unknown_deck', () => {
    h.room.create('Ana');
    h.room.attach(0, 'c');
    h.room.selectDeck(0, { kind: 'starter', deckId: 'deck-inexistente' });
    expect(h.lastOfType(0, 'ERROR').code).toBe('unknown_deck');
    expect(h.room.seatInfo(0).deckValid).toBe(false);
  });

  it('11/12) dois prontos iniciam a partida com seed do servidor', () => {
    h.drain(0); h.drain(1);
    startPlaying(h);
    expect(h.room.phase).toBe('playing');
    expect(h.room.revision).toBe(1);
    for (const seat of [0, 1] as Seat[]) {
      const start = matchStartFor(h, seat);
      // seed nunca vaza na visão
      expect(start.match.seed).toBe(0);
      expect(start.match.rngState).toBe(0);
      expect(start.match.players[seat].hand.length).toBeGreaterThan(0);
    }
  });

  it('11b) ready do jogador 1 sozinho NÃO inicia', () => {
    h.room.create('Ana');
    h.room.attach(0, 'c');
    h.room.selectDeck(0, { kind: 'starter', deckId: JET_STARTER_DECKS[0].id });
    h.room.setReady(0, true);
    expect(h.room.phase).toBe('lobby');
  });

  it('13) comando do jogador errado é recusado', () => {
    startPlaying(h);
    completeSetup(h);
    h.drain(0); h.drain(1);
    const turn = activePlayer(h);
    const wrong = (turn === 0 ? 1 : 0) as Seat;
    h.room.command(wrong, 'c1', h.room.revision, { type: 'END_TURN', player: wrong });
    const rej = h.lastOfType(wrong, 'COMMAND_REJECTED');
    expect(rej.code === 'not_your_turn' || rej.code === 'illegal').toBe(true);
  });

  it('14) comando ilegal é recusado com o motivo do engine', () => {
    startPlaying(h);
    completeSetup(h);
    h.drain(0); h.drain(1);
    const turn = activePlayer(h);
    h.room.command(turn as Seat, 'bad-1', h.room.revision, { type: 'ATTACK', player: turn, attackId: 'ataque-que-nao-existe' });
    expect(h.lastOfType(turn as Seat, 'COMMAND_REJECTED').code).toBe('illegal');
    expect(h.room.stats.commandsRejected).toBeGreaterThan(0);
  });

  it('15/16) comando legal altera o estado e incrementa a revision', () => {
    startPlaying(h);
    completeSetup(h);
    h.drain(0); h.drain(1);
    const before = h.room.revision;
    const turn = activePlayer(h);
    h.room.command(turn as Seat, 'end-1', before, { type: 'END_TURN', player: turn });
    expect(h.room.revision).toBe(before + 1);
    expect(h.lastOfType(turn as Seat, 'STATE').match.turn).toBeGreaterThan(0);
    expect(h.room.stats.commandsApplied).toBeGreaterThan(0);
  });

  it('17) revision stale é recusada e o estado atual é reenviado', () => {
    startPlaying(h);
    completeSetup(h);
    h.drain(0); h.drain(1);
    const turn = activePlayer(h);
    h.room.command(turn as Seat, 'end-1', h.room.revision, { type: 'END_TURN', player: turn });
    h.drain(turn as Seat);
    h.room.command(turn as Seat, 'end-2', 1, { type: 'END_TURN', player: turn });
    const rej = h.lastOfType(turn as Seat, 'COMMAND_REJECTED');
    expect(rej.code).toBe('stale_revision');
    expect(rej.revision).toBe(h.room.revision);
    // estado atual reenviado logo depois
    expect(h.lastOfType(turn as Seat, 'STATE').revision).toBe(h.room.revision);
  });

  it('18) commandId duplicado não aplica duas vezes', () => {
    startPlaying(h);
    completeSetup(h);
    h.drain(0); h.drain(1);
    const turn = activePlayer(h);
    const rev = h.room.revision;
    h.room.command(turn as Seat, 'same-id', rev, { type: 'END_TURN', player: turn });
    const afterFirst = h.room.revision;
    h.room.command(turn as Seat, 'same-id', afterFirst, { type: 'END_TURN', player: turn });
    expect(h.room.revision).toBe(afterFirst);
    expect(h.lastOfType(turn as Seat, 'COMMAND_REJECTED').code).toBe('duplicate');
  });

  it('19/20) mão e ordem do baralho do adversário não aparecem na visão', () => {
    startPlaying(h);
    const view0 = matchStartFor(h, 0).match as MatchState & { hidden: { hand: number; deck: number } };
    expect(view0.players[1].hand).toEqual([]);
    expect(view0.players[1].deck).toEqual([]);
    expect(view0.hidden.hand).toBeGreaterThan(0);
    expect(view0.hidden.deck).toBeGreaterThan(0);
    // o próprio lado continua completo
    expect(view0.players[0].hand.length).toBeGreaterThan(0);
    expect(view0.players[0].deck.length).toBeGreaterThan(0);
    expect(viewLeaksNothingOf(h.room['engine']!.state, view0 as unknown as PublicMatchView)).toBe(true);
  });

  it('19b) log não vaza defId de compra do adversário', () => {
    startPlaying(h);
    completeSetup(h);
    const state = h.room['engine']!.state;
    // o log completo é verificado sob a projeção de cada observador
    const view0 = viewForPlayer(state, 0);
    for (const ev of view0.log) {
      if (ev.player === 1 && ev.type === 'CARD_DRAWN') expect('defId' in ev.payload).toBe(false);
    }
    expect(sanitizeLogFor(state.log, 0).some((e) => e.player === 1 && e.type === 'CHOICE_REQUESTED')).toBe(false);
  });

  it('21/22) conceder encerra a partida com vencedor decidido pelo servidor', () => {
    startPlaying(h);
    completeSetup(h);
    h.drain(0); h.drain(1);
    h.room.concede(0);
    expect(h.room.phase).toBe('over');
    expect(h.room.winner).toBe(1);
    expect(h.lastOfType(0, 'MATCH_OVER').winner).toBe(1);
    expect(h.lastOfType(1, 'MATCH_OVER').winner).toBe(1);
  });

  it('22b) fim de partida reflete no lobby com vencedor do servidor', () => {
    startPlaying(h);
    completeSetup(h);
    // Concede exercita o wiring sala → MATCH_OVER → lobby; vitória por PV e
    // deck-out são cobertas pela bateria IA×IA (tests/jet-matches.test.ts).
    h.room.concede(1);
    expect(h.room.lobbyView().phase).toBe('over');
    expect(h.room.lobbyView().winner).toBe(0);
  });

  it('23) revanche exige os dois; 24) nova partida tem engine novo', () => {
    startPlaying(h);
    completeSetup(h);
    h.room.concede(0);
    const engineBefore = h.room['engine'];
    h.room.setRematch(0, true);
    expect(h.room.phase).toBe('over');
    h.room.setRematch(1, true);
    expect(h.room.phase).toBe('playing');
    expect(h.room['engine']).not.toBe(engineBefore);
    expect(h.room.winner).toBeNull();
    expect(h.room.revision).toBe(1);
    expect(h.room.stats.matchesPlayed).toBe(2);
  });

  it('23b) revanche fora do fim de partida é recusada', () => {
    startPlaying(h);
    h.drain(0);
    h.room.setRematch(0, true);
    expect(h.lastOfType(0, 'ERROR').code).toBe('not_in_lobby');
  });

  it('25/26) desconexão preserva o assento; reconexão restaura a visão', () => {
    const { tokens } = startPlaying(h);
    completeSetup(h);
    h.room.detach('conn-b');
    expect(h.room.seatInfo(1).present).toBe(true);
    expect(h.room.seatInfo(1).connected).toBe(false);
    expect(h.lastOfType(0, 'PEER_STATUS').connected).toBe(false);
    // o jogador 0 continua vendo o tabuleiro do 1 (campo público)
    const view = h.lastOfType(0, 'STATE').match;
    expect(view.players[1].active === null || view.players[1].active).toBeTruthy();
    h.drain(1);
    const rc = h.room.reconnect(h.room.roomCode, tokens[1]);
    expect(rc).toEqual({ seat: 1 });
    h.room.attach(1, 'conn-b2');
    const restored = h.lastOfType(1, 'STATE');
    expect(restored.type).toBe('STATE');
    expect(restored.revision).toBe(h.room.revision);
    expect(h.lastOfType(0, 'PEER_STATUS').connected).toBe(true);
  });

  it('25b) jogador desconectado não consegue mandar comando', () => {
    startPlaying(h);
    completeSetup(h);
    h.room.detach('conn-b');
    h.drain(1);
    h.room.command(1, 'off-1', h.room.revision, { type: 'END_TURN', player: 1 });
    expect(h.lastOfType(1, 'COMMAND_REJECTED').code).toBe('disconnected');
  });

  it('25c) o adversário NÃO avança sozinho: turno permanece do desconectado', () => {
    startPlaying(h);
    completeSetup(h);
    const turn = activePlayer(h);
    h.room.detach(turn === 0 ? 'conn-a' : 'conn-b');
    h.advance(60_000);
    expect((h.lastOfType(turn === 0 ? 1 : 0, 'STATE') ?? h.lastOfType(0, 'STATE')).match.activePlayer).toBe(turn);
  });

  it('27) TTL: sala vazia no lobby expira; sala em partida tem hard TTL', () => {
    // lobby vazio
    h.advance(DEFAULT_TTL.idleLobbyMs + 1);
    expect(h.tick()).toEqual({ action: 'close', reason: 'sala abandonada' });

    // hard TTL mesmo com atividade
    const h2 = makeRoom('JT4MQ7');
    startPlaying(h2);
    h2.advance(DEFAULT_TTL.hardTtlMs + 1);
    expect(h2.tick()).toEqual({ action: 'close', reason: 'tempo máximo da sala atingido' });

    // partida abandonada
    const h3 = makeRoom('JT4MQ7');
    startPlaying(h3);
    h3.advance(DEFAULT_TTL.idleMatchMs + 1);
    expect(h3.tick()).toEqual({ action: 'close', reason: 'partida abandonada' });

    // atividade recente → espera
    const h4 = makeRoom('JT4MQ7');
    startPlaying(h4);
    expect(h4.tick()).toEqual({ action: 'wait', delayMs: 60_000 });
  });

  it('27b) grace de reconexão expira depois do prazo', () => {
    startPlaying(h);
    h.room.detach('conn-b');
    expect(h.room.reconnectGraceExpired(1)).toBe(false);
    h.advance(DEFAULT_TTL.reconnectGraceMs + 1);
    expect(h.room.reconnectGraceExpired(1)).toBe(true);
  });

  it('28) sala com código inexistente → room_not_found', () => {
    expect(h.room.reconnect('XXXX99', 'qualquer')).toEqual({ error: 'room_not_found' });
  });

  it('29) mensagem inválida em partida → erro amigável, sem exceção', () => {
    startPlaying(h);
    h.drain(0);
    h.room.handle(0, { type: 'PING', t: 5 });
    expect(h.lastOfType(0, 'PONG')).toEqual({ type: 'PONG', t: 5 });
    h.room.handle(0, { type: 'JOIN_ROOM', roomCode: 'JT4MQ7', name: 'Ana' });
    expect(h.lastOfType(0, 'ERROR').code).toBe('bad_message');
  });

  it('30) payload gigante é rejeitado na camada de mensagem (limite de bytes)', () => {
    // O Worker aplica MAX_MESSAGE_BYTES antes do parse; aqui garantimos que um
    // deck enorme já cai no parseDeckSubmission (defesa em profundidade).
    const huge: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) huge[`carta-${i}`] = 4;
    expect(parseDeckSubmission({ kind: 'custom', name: 'X', cards: huge })).toBeNull();
    h.room.create('Ana');
    h.room.attach(0, 'c');
    h.room.selectDeck(0, { kind: 'custom', name: 'X', cards: { 'agent-jenny-base': 4 } });
    expect(h.lastOfType(0, 'ERROR').code).toBe('invalid_deck');
  });

  it('LOBBY nunca contém seatToken', () => {
    startPlaying(h);
    for (const seat of [0, 1] as Seat[]) {
      for (const msg of h.inbox[seat]) {
        const raw = JSON.stringify(msg);
        if (msg.type !== 'JOINED') expect(raw).not.toContain('tok-');
      }
    }
  });

  it('STATE/MATCH_START nunca contêm imagem, base64 ou blob', () => {
    startPlaying(h);
    for (const seat of [0, 1] as Seat[]) {
      const raw = JSON.stringify(h.inbox[seat]);
      expect(raw).not.toMatch(/data:image\//i);
      expect(raw).not.toMatch(/https?:\/\/[^\s"]+\.(png|jpg|jpeg|webp|gif)/i);
      expect(raw).not.toContain('base64');
    }
  });

  it('leave libera o assento no lobby', () => {
    h.room.create('Ana');
    h.room.attach(0, 'c');
    h.room.leave(0);
    expect(h.room.seatInfo(0).present).toBe(false);
    const rejoined = h.room.join('Bruno');
    expect(rejoined).toEqual(expect.objectContaining({ seat: 0 }));
  });

  it('concede sem partida em andamento não lança', () => {
    h.room.create('Ana');
    h.room.attach(0, 'c');
    h.room.concede(0);
    expect(h.lastOfType(0, 'ERROR').code).toBe('no_match');
  });
});

// ---------------------------------------------------------------------------
// 3. utilidades do servidor
// ---------------------------------------------------------------------------

describe('utilidades de sala', () => {
  it('resolveStarterDeck devolve os 3 starters conhecidos', () => {
    for (const d of JET_STARTER_DECKS) {
      expect(resolveStarterDeck(d.id)?.name).toBe(d.name);
    }
    expect(resolveStarterDeck('nada')).toBeNull();
  });

  it('expandDeckCards devolve CardDef registrados na quantidade certa', () => {
    const cards = expandDeckCards({ 'jres-energia': 3, 'agent-jenny-base': 1 });
    expect(cards).toHaveLength(4);
    expect(cards.filter((c) => c.id === 'jres-energia')).toHaveLength(3);
    expect(() => expandDeckCards({ 'carta-inexistente': 1 })).toThrow();
  });
});
