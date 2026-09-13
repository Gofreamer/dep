import { describe, expect, it } from 'vitest';
import { MemoryRankedRepo } from '../src/ranked/repo';
import { handleAuth, handleRanked } from '../worker/src/rankedApi';
import { ARCHETYPE_DECKS } from '../src/data/jet/archetypes';
import { registry } from '../src/engine/registry';
import { expandDeck } from '../src/data/deckUtils';
import { runLocalRankedMatch } from '../src/ranked/localMatch';
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

    const start = await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-midrange') }, token), { JET_RANKED_SECRET: 'test-secret' }, repo, null);
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

    const finish = await handleRanked(req('POST', '/ranked/finish', { ticket: startBody.ticket, commands: local.humanCommands }, token), { JET_RANKED_SECRET: 'test-secret' }, repo, null);
    expect(finish!.status).toBe(200);
    const finishBody = (await finish!.json()) as { result: string; ratingAfter: number; rank: string };

    // resultado do servidor bate com o replay local
    expect(['win', 'loss']).toContain(finishBody.result);
    expect(typeof finishBody.ratingAfter).toBe('number');

    // reaplicar o mesmo finish é idempotente (não duplica rating)
    const finish2 = await handleRanked(req('POST', '/ranked/finish', { ticket: startBody.ticket, commands: local.humanCommands }, token), { JET_RANKED_SECRET: 'test-secret' }, repo, null);
    const finish2Body = (await finish2!.json()) as { ratingAfter: number };
    expect(finish2Body.ratingAfter).toBe(finishBody.ratingAfter);
  });

  it('rejeita comandos adulterados (o cliente não pode forjar vitória)', async () => {
    const repo = new MemoryRankedRepo();
    const reg = await handleAuth(req('POST', '/auth/register', { username: 'Hacker', password: 'senha-forte-123' }), repo, null);
    const { token } = (await reg!.json()) as { token: string };
    const start = await handleRanked(req('POST', '/ranked/start', { deck: deckIds('archetype-aggro') }, token), { JET_RANKED_SECRET: 'test-secret' }, repo, null);
    const startBody = (await start!.json()) as { ticket: string; seed: number; seat: 0 | 1; botId: string };

    // tenta enviar um comando com uid inexistente (ilegal — setup rejeita)
    const finish = await handleRanked(req('POST', '/ranked/finish', { ticket: startBody.ticket, commands: [{ type: 'SETUP_SET_ACTIVE', player: startBody.seat, uid: 'bogus-uid' }] }, token), { JET_RANKED_SECRET: 'test-secret' }, repo, null);
    expect(finish!.status).toBe(400);
    const body = (await finish!.json()) as { error: string };
    expect(body.error).toContain('partida rejeitada');
  });

  it('ladder público lista bots e topo (sem login)', async () => {
    const repo = new MemoryRankedRepo();
    const r = await handleRanked(req('GET', '/ranked/ladder?limit=10'), { JET_RANKED_SECRET: 'test-secret' }, repo, null);
    expect(r!.status).toBe(200);
    const body = (await r!.json()) as { ladder: { username: string; position: number; isReiDaLiga: boolean }[] };
    expect(body.ladder.length).toBe(10);
    expect(body.ladder[0].position).toBe(1);
    expect(body.ladder[0].username).toBe('bot-stella-prime');
    expect(body.ladder[0].isReiDaLiga).toBe(true);
  });
});
