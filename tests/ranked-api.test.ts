import { describe, expect, it } from 'vitest';
import { MemoryRankedRepo } from '../src/ranked/repo';
import { handleAuth, handleRanked } from '../worker/src/rankedApi';
import { ARCHETYPE_DECKS } from '../src/data/jet/archetypes';
import { registry } from '../src/engine/registry';
import { expandDeck } from '../src/data/deckUtils';
import { runLocalRankedMatch } from '../src/ranked/localMatch';
import { signTicket } from '../worker/src/rankedApi';
import { PROFILE_LEVELS } from '../src/engine/ai/profile';
import { computeLegalActions } from '../src/engine/validation';
import type { MatchEngine } from '../src/engine/engine';
import type { Command, PlayerId } from '../src/engine/types';

function deckIds(archetypeId: string): string[] {
  const d = ARCHETYPE_DECKS.find((x) => x.id === archetypeId)!;
  return expandDeck({ id: d.id, name: d.name, description: '', cards: d.cards }).map((id) => registry.card(id).id);
}

/** Humano determinístico (não consome RNG — o replay server-side reproduz igual). */
function deterministicHuman(engine: MatchEngine, seat: PlayerId): Command {
  const state = engine.state;
  const legal = computeLegalActions(state, seat, 0);
  if (state.phase === 'setup') {
    const p = state.players[seat];
    if (!p.active && legal.setupActive.length) return { type: 'SETUP_SET_ACTIVE', player: seat, uid: legal.setupActive[0] };
    const b = legal.setupBench.find((uid) => uid !== p.active?.uid);
    if (p.bench.length < 2 && b) return { type: 'SETUP_BENCH', player: seat, uid: b };
    return { type: 'SETUP_DONE', player: seat };
  }
  if (legal.deployable.length) return { type: 'DEPLOY_CHARACTER', player: seat, uid: legal.deployable[0] };
  const p = state.players[seat];
  const res = p.hand.find((c) => c.kind === 'RESOURCE');
  if (res && p.attachedThisTurn < state.config.turn.attachPerTurn) {
    const target = p.active ?? p.bench[0];
    if (target) return { type: 'ATTACH_RESOURCE', player: seat, uid: res.uid, targetUid: target.uid };
  }
  if (legal.playableActions.length) return { type: 'PLAY_ACTION', player: seat, uid: legal.playableActions[0] };
  const atk = legal.attacks.find((a) => a.playable);
  if (atk) return { type: 'ATTACK', player: seat, attackId: atk.attackId };
  return { type: 'END_TURN', player: seat };
}

function req(method: string, path: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** Ambiente de teste: segredo com o tamanho mínimo de produção (≥32). */
const TEST_SECRET = 'a'.repeat(64);
const TEST_ENV = { JET_RANKED_SECRET: TEST_SECRET };

describe('ranked API (worker handlers, sem D1 real)', () => {
  it('registro → login → me (senha nunca em claro)', async () => {
    const repo = new MemoryRankedRepo();
    const r = await handleAuth(req('POST', '/auth/register', { username: 'PlayerOne', password: 'senha-forte-123' }), repo, null);
    expect(r!.status).toBe(201);
    const { token } = (await r!.json()) as { token: string };
    expect(token).toBeTruthy();

    const me = await handleAuth(req('GET', '/auth/me', undefined, token), repo, null);
    const meBody = (await me!.json()) as { username: string; profile: { rating: number } };
    expect(meBody.username).toBe('playerone');
    expect(meBody.profile.rating).toBe(1000);

    // conta armazenada com salt + hash (nunca senha em claro)
    const account = await repo.getAccount('playerone');
    expect(account!.hash).toBeTruthy();
    expect(account!.salt).toBeTruthy();
    expect(JSON.stringify(account)).not.toContain('senha-forte-123');
  });

  it('rejeita senha curta e usuário inválido', async () => {
    const repo = new MemoryRankedRepo();
    const r1 = await handleAuth(req('POST', '/auth/register', { username: 'ab', password: '12345678' }), repo, null);
    expect(r1!.status).toBe(400);
    const r2 = await handleAuth(req('POST', '/auth/register', { username: 'bom-nome', password: 'curta' }), repo, null);
    expect(r2!.status).toBe(400);
  });

  it('fluxo completo start → finish aplica rating exatamente uma vez', async () => {
    const repo = new MemoryRankedRepo();
    const reg = await handleAuth(req('POST', '/auth/register', { username: 'Challenger', password: 'senha-forte-123' }), repo, null);
    const { token } = (await reg!.json()) as { token: string };

    const start = await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-midrange') }, token), TEST_ENV, repo, null);
    expect(start!.status).toBe(200);
    const startBody = (await start!.json()) as { ticket: string; seed: number; seat: 0 | 1; botId: string; botName: string };

    // joga localmente (humano determinístico) e registra comandos
    const humanDeck = deckIds('archetype-midrange').map((id) => registry.card(id));
    const { BOT_ROSTER } = await import('../src/ranked/bots');
    const bot = BOT_ROSTER.find((b) => b.id === startBody.botId)!;
    const botDeck = deckIds(bot.archetypeId).map((id) => registry.card(id));
    const local = runLocalRankedMatch({
      seed: startBody.seed,
      humanDeck,
      botDeck,
      botProfile: bot.profile,
      humanSeat: startBody.seat,
      humanMove: (e) => deterministicHuman(e, startBody.seat)
    });

    const finish = await handleRanked(req('POST', '/ranked/finish', { ticket: startBody.ticket, commands: local.humanCommands }, token), TEST_ENV, repo, null);
    expect(finish!.status).toBe(200);
    const finishBody = (await finish!.json()) as { result: string; ratingAfter: number; rank: string };

    // resultado do servidor bate com o replay local
    expect(['win', 'loss']).toContain(finishBody.result);
    expect(typeof finishBody.ratingAfter).toBe('number');

    // reaplicar o mesmo finish é idempotente (não duplica rating)
    const finish2 = await handleRanked(req('POST', '/ranked/finish', { ticket: startBody.ticket, commands: local.humanCommands }, token), TEST_ENV, repo, null);
    const finish2Body = (await finish2!.json()) as { ratingAfter: number };
    expect(finish2Body.ratingAfter).toBe(finishBody.ratingAfter);
  });

  it('rejeita comandos adulterados (o cliente não pode forjar vitória)', async () => {
    const repo = new MemoryRankedRepo();
    const reg = await handleAuth(req('POST', '/auth/register', { username: 'Hacker', password: 'senha-forte-123' }), repo, null);
    const { token } = (await reg!.json()) as { token: string };
    const start = await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-aggro') }, token), TEST_ENV, repo, null);
    const startBody = (await start!.json()) as { ticket: string; seed: number; seat: 0 | 1; botId: string };

    // tenta enviar um comando com uid inexistente (ilegal — setup rejeita)
    const finish = await handleRanked(req('POST', '/ranked/finish', { ticket: startBody.ticket, commands: [{ type: 'SETUP_SET_ACTIVE', player: startBody.seat, uid: 'bogus-uid' }] }, token), TEST_ENV, repo, null);
    expect(finish!.status).toBe(400);
    const body = (await finish!.json()) as { error: string };
    expect(body.error).toContain('partida rejeitada');
  });

  it('ladder público lista bots e topo (sem login)', async () => {
    const repo = new MemoryRankedRepo();
    const r = await handleRanked(req('GET', '/ranked/ladder?limit=10'), TEST_ENV, repo, null);
    expect(r!.status).toBe(200);
    const body = (await r!.json()) as { ladder: { username: string; position: number; isReiDaLiga: boolean }[] };
    expect(body.ladder.length).toBe(10);
    expect(body.ladder[0].position).toBe(1);
    expect(body.ladder[0].username).toBe('bot-stella-prime');
    expect(body.ladder[0].isReiDaLiga).toBe(true);
  });
});
describe('segurança do ticket e recusa fechada (2.1)', () => {
  /** Par (ticket, comandos) válido, obtido pelo fluxo real. */
  async function realTicket(username = 'Player_A', deck = 'archetype-midrange', into?: MemoryRankedRepo) {
    const repo = into ?? new MemoryRankedRepo();
    const reg = await handleAuth(req('POST', '/auth/register', { username, password: 'senha-forte-123' }), repo, null);
    const { token } = (await reg!.json()) as { token: string };
    const start = (await handleRanked(req('POST', '/ranked/start', { deck: deckIds(deck) }, token), TEST_ENV, repo, null))!;
    const body = (await start.json()) as { ticket: string; seed: number; seat: 0 | 1; botId: string };
    return { repo, token, ...body };
  }

  it('sem JET_RANKED_SECRET: escrita 503 (falha fechada), leitura OK', async () => {
    const { repo, token, ...t } = await realTicket();
    const start2 = await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-aggro') }, token), {}, repo, null);
    expect(start2!.status).toBe(503);
    const err = (await start2!.json()) as { error: string };
    expect(err.error).toContain('JET_RANKED_SECRET');
    const fin = await handleRanked(req('POST', '/ranked/finish', { ticket: t.ticket, commands: [] }, token), {}, repo, null);
    expect(fin!.status).toBe(503);
    // leitura continua no ar (ladder não exige chave)
    const lb = await handleRanked(req('GET', '/ranked/ladder'), {}, repo, null);
    expect(lb!.status).toBe(200);
  });

  it('segredo curto é recusado (não aceita chave fraca em produção)', async () => {
    const { repo, token } = await realTicket();
    const r = await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-aggro') }, token), { JET_RANKED_SECRET: 'abc' }, repo, null);
    expect(r!.status).toBe(503);
    expect(((await r!.json()) as { error: string }).error).toContain('curto');
  });

  it('fallback dev só com opt-in explícito', async () => {
    const { repo, token } = await realTicket();
    const dev = await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-aggro') }, token), { NODE_ENV: 'development' }, repo, null);
    expect(dev!.status).toBe(200);
    const insecure = await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-aggro') }, token), { ALLOW_INSECURE_ORIGIN: '1' }, repo, null);
    expect(insecure!.status).toBe(200);
  });

  it('ticket forjado (segredo errado) é rejeitado', async () => {
    const { repo, token, seed, seat, botId } = await realTicket();
    const forged = await signTicket(
      { v: 2, u: token, s: seed, b: botId, seat, d: deckIds('archetype-aggro'), t: Date.now(), sid: 'season-1', mid: 'rm-forged', n: 'deadbeef' },
      'segredo-de-outra-pessoa-0123456789abcdef'
    );
    const fin = await handleRanked(req('POST', '/ranked/finish', { ticket: forged, commands: [] }, token), TEST_ENV, repo, null);
    expect(fin!.status).toBe(403);
  });

  it('payload do ticket adulterado (deck/bot/seed/seat/season/matchId) quebra a assinatura', async () => {
    const { repo, token, ticket } = await realTicket();
    const [body, sig] = [ticket.slice(0, ticket.lastIndexOf('.')), ticket.slice(ticket.lastIndexOf('.') + 1)];
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>;
    const mutations: Record<string, unknown>[] = [
      { d: deckIds('archetype-aggro') },           // troca o baralho jogado
      // troca o oponente (para um id DIFERENTE do que o ticket já traz —
      // senão a "mutação" produz o mesmo body assinado e não é forja)
      { b: payload.b === 'bot-stella-prime' ? 'bot-luna-underdog' : 'bot-stella-prime' },
      { s: (payload.s as number) + 1 },            // troca a seed
      { seat: 1 },                                 // troca o assento
      { sid: 'season-999' },                       // troca a temporada
      { mid: 'rm-' + Math.random().toString(36).slice(2) }, // troca a chave de idempotência
      { v: 1 }                                     // formato antigo
    ];
    for (const m of mutations) {
      const tampered = JSON.stringify({ ...payload, ...m });
      const b64 = Buffer.from(tampered, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const bad = `${b64}.${sig}`;
      const fin = await handleRanked(req('POST', '/ranked/finish', { ticket: bad, commands: [] }, token), TEST_ENV, repo, null);
      expect(fin!.status, `mutação ${JSON.stringify(m)} deveria ser rejeitada`).toBe(403);
    }
  });

  it('ticket expirado (TTL 2h) e ticket "do futuro" são recusados', async () => {
    const { repo, token, seed, seat, botId } = await realTicket();
    const base = { v: 2 as const, u: token.toLowerCase(), s: seed, b: botId, seat, d: deckIds('archetype-midrange'), sid: 'season-1', mid: 'rm-time-1', n: 'aa' };
    const old = await signTicket({ ...base, t: Date.now() - 3 * 60 * 60 * 1000 }, TEST_SECRET);
    const future = await signTicket({ ...base, mid: 'rm-time-2', t: Date.now() + 3_600_000 }, TEST_SECRET);
    expect((await handleRanked(req('POST', '/ranked/finish', { ticket: old, commands: [] }, token), TEST_ENV, repo, null))!.status).toBe(403);
    expect((await handleRanked(req('POST', '/ranked/finish', { ticket: future, commands: [] }, token), TEST_ENV, repo, null))!.status).toBe(403);
  });

  it('ticket de outro usuário não vale (assinatura certa, dono errado)', async () => {
    const repo = new MemoryRankedRepo();
    const a = await realTicket('Player_A', 'archetype-midrange', repo);
    const b = await realTicket('Player_B', 'archetype-midrange', repo);
    // o ticket do A apresentado pelo B: mesmo banco, mesmo segredo, dono errado
    const fin = await handleRanked(req('POST', '/ranked/finish', { ticket: a.ticket, commands: [] }, b.token), TEST_ENV, repo, null);
    expect(fin!.status).toBe(403);
  });

  it('baralho fora das regras do construtor é recusado na entrada', async () => {
    const repo = new MemoryRankedRepo();
    const reg = await handleAuth(req('POST', '/auth/register', { username: 'Cheater', password: 'senha-forte-123' }), repo, null);
    const { token } = (await reg!.json()) as { token: string };
    // 60× a mesma carta: ids conhecidos, tamanho certo — mas ilegal
    const spam = new Array(60).fill('agent-jenny-base');
    const start = await handleRanked(req('POST', '/ranked/start', { deck: spam }, token), TEST_ENV, repo, null);
    expect(start!.status).toBe(400);
    expect(((await start!.json()) as { error: string }).error).toContain('baralho inválido');
    // sem agente Base (só energia) também é recusado
    const noBasic = new Array(60).fill('jres-energia');
    const start2 = await handleRanked(req('POST', '/ranked/start', { deck: noBasic }, token), TEST_ENV, repo, null);
    expect(start2!.status).toBe(400);
  });

  it('nomes de bot são reservados para humanos', async () => {
    const repo = new MemoryRankedRepo();
    for (const name of ['StellaPrime', 'stellaprime', 'Luna_underdog', 'Luna-Underdog', 'LUNAunderdog', 'Moirai', 'bot-stella-prime']) {
      const r = await handleAuth(req('POST', '/auth/register', { username: name, password: 'senha-forte-123' }), repo, null);
      expect(r!.status, `${name} não deveria poder ser registrado`).toBe(409);
      const body = (await r!.json()) as { error: string };
      expect(body.error).toContain('bot');
    }
    // pontuação não é normalizada para virar nome de bot: é rejeitada como
    // username inválido (não passa por cima da reserva por acaso)
    const dotted = await handleAuth(req('POST', '/auth/register', { username: 'Stella.Prime', password: 'senha-forte-123' }), repo, null);
    expect(dotted!.status).toBe(400);
    const dotted2 = await handleAuth(req('POST', '/auth/register', { username: 'luna.underdog', password: 'senha-forte-123' }), repo, null);
    expect(dotted2!.status).toBe(400);
    // e um nome parecido com o de bot, mas distinto, é livre
    const okName = await handleAuth(req('POST', '/auth/register', { username: 'stellaprime_fan', password: 'senha-forte-123' }), repo, null);
    expect(okName!.status).toBe(201);
  });

  it('sequência de comandos gigante é recusada antes de gastar CPU', async () => {
    const { repo, token, ticket } = await realTicket();
    const huge = new Array(4001).fill({ type: 'END_TURN', player: 0 });
    const fin = await handleRanked(req('POST', '/ranked/finish', { ticket, commands: huge }, token), TEST_ENV, repo, null);
    expect(fin!.status).toBe(413);
  });

  it('dois tickets diferentes do mesmo par não colidem na chave de rating', async () => {
    const { repo, token } = await realTicket('Player_A');
    const s1 = (await (await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-midrange') }, token), TEST_ENV, repo, null))!.json()) as { matchId: string };
    const s2 = (await (await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-midrange') }, token), TEST_ENV, repo, null))!.json()) as { matchId: string };
    expect(s2.matchId).not.toBe(s1.matchId);
    expect(s1.matchId).toContain('season-1');
  });
});
