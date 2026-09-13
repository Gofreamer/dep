/**
 * RANKED API — rotas HTTP da Liga Ranqueada (servidor-autoritativo).
 *
 *  - POST /auth/register { username, password }
 *  - POST /auth/login    { username, password }
 *  - GET  /auth/me       (Bearer token)
 *  - POST /auth/logout   (Bearer token)
 *  - GET  /ranked/ladder?limit=100
 *  - GET  /ranked/profile (Bearer token)
 *  - POST /ranked/start   (Bearer token, { deck }) → ticket + bot
 *  - POST /ranked/finish  (Bearer token, { ticket, commands }) → replay + rating
 *
 * O cliente NUNCA envia "eu venci": o servidor repete a partida (replay) e
 * determina o vencedor. Cada `rankedMatchId` aplica rating EXATAMENTE uma vez.
 */

import { registerJetDataPack } from '../../src/data/jet/pack';
import { ARCHETYPE_DECKS } from '../../src/data/jet/archetypes';
import { registry } from '../../src/engine/registry';
import { expandDeck } from '../../src/data/deckUtils';
import { replayMatch, ReplayError, validateSubmittedDeck } from '../../src/ranked/replay';
import { BOT_ROSTER, botById } from '../../src/ranked/bots';
import { applyRankedResult, leaderboard } from '../../src/ranked/ladder';
import { INITIAL_RATING } from '../../src/ranked/rating';
import { rankFor } from '../../src/ranked/ranks';
import { currentSeason, seasonAcceptsMatch } from '../../src/ranked/seasons';
import { seedBots } from '../../src/ranked/matchmaking';
import type { RankedRepo } from '../../src/ranked/repo';
import type { Command } from '../../src/engine/types';
import {
  hashPassword, isValidPassword, isValidUsername, newSessionToken, normalizeUsername,
  rateLimitKey, rateLimitOk, sessionTtl, verifyPassword
} from './auth';

registerJetDataPack();

type AuthResult =
  | { ok: true; username: string }
  | { ok: false; response: Response };

// ---------------------------------------------------------------------------
// Ticket assinado (matchmaking sem estado server-side entre start/finish)
// ---------------------------------------------------------------------------

interface TicketPayload {
  u: string;
  s: number;
  b: string;
  seat: 0 | 1;
  d: string[];
  t: number;
}

const TICKET_TTL_MS = 2 * 60 * 60 * 1000;

async function signTicket(payload: TicketPayload, secret: string): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacHex(body, secret);
  return `${body}.${sig}`;
}

async function verifyTicket(ticket: string, secret: string): Promise<TicketPayload | null> {
  const dot = ticket.lastIndexOf('.');
  if (dot < 0) return null;
  const body = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  const expect = await hmacHex(body, secret);
  if (!timingSafeEqualHex(sig, expect)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as TicketPayload;
    if (Date.now() - payload.t > TICKET_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200, origin?: string): Response => {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
};

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function authenticate(request: Request, repo: RankedRepo): Promise<AuthResult> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { ok: false, response: json({ ok: false, error: 'sem token' }, 401) };
  const session = await repo.getSession(token);
  if (!session) return { ok: false, response: json({ ok: false, error: 'sessão inválida ou expirada' }, 401) };
  return { ok: true, username: session.username };
}

export interface RankedRoutes {
  auth: (request: Request, env: Record<string, unknown>, repo: RankedRepo, origin: string | null) => Promise<Response | null>;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleAuth(request: Request, repo: RankedRepo, origin: string | null): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/auth/register' && request.method === 'POST') {
    if (!rateLimitOk(rateLimitKey(request, 'register'))) return json({ ok: false, error: 'muitas tentativas — aguarde' }, 429, origin ?? undefined);
    const body = await readJson(request);
    const username = normalizeUsername(String(body.username ?? ''));
    const password = String(body.password ?? '');
    if (!isValidUsername(username)) return json({ ok: false, error: 'nome de usuário inválido (3-24, a-z0-9_-)' }, 400, origin ?? undefined);
    if (!isValidPassword(password)) return json({ ok: false, error: 'senha deve ter 8-128 caracteres' }, 400, origin ?? undefined);
    if (await repo.getAccount(username)) return json({ ok: false, error: 'conta já existe' }, 409, origin ?? undefined);
    const { salt, hash } = await hashPassword(password);
    await repo.createAccount({ username, salt, hash, createdAt: Date.now() });
    await repo.upsertProfile({ username, rating: INITIAL_RATING, rank: rankFor(INITIAL_RATING).id, wins: 0, losses: 0, streak: 0, updatedAt: Date.now(), isBot: false });
    const token = newSessionToken();
    await repo.createSession({ token, username, createdAt: Date.now(), expiresAt: Date.now() + sessionTtl() });
    return json({ ok: true, token, username }, 201, origin ?? undefined);
  }

  if (path === '/auth/login' && request.method === 'POST') {
    if (!rateLimitOk(rateLimitKey(request, 'login'))) return json({ ok: false, error: 'muitas tentativas — aguarde' }, 429, origin ?? undefined);
    const body = await readJson(request);
    const username = normalizeUsername(String(body.username ?? ''));
    const password = String(body.password ?? '');
    const account = await repo.getAccount(username);
    if (!account) return json({ ok: false, error: 'credenciais inválidas' }, 401, origin ?? undefined);
    const valid = await verifyPassword(password, account.salt, account.hash);
    if (!valid) return json({ ok: false, error: 'credenciais inválidas' }, 401, origin ?? undefined);
    const token = newSessionToken();
    await repo.createSession({ token, username, createdAt: Date.now(), expiresAt: Date.now() + sessionTtl() });
    return json({ ok: true, token, username }, 200, origin ?? undefined);
  }

  if (path === '/auth/logout' && request.method === 'POST') {
    const auth = await authenticate(request, repo);
    if (!auth.ok) return auth.response;
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/, '');
    await repo.deleteSession(token);
    return json({ ok: true }, 200, origin ?? undefined);
  }

  if (path === '/auth/me' && request.method === 'GET') {
    const auth = await authenticate(request, repo);
    if (!auth.ok) return auth.response;
    const profile = await repo.getProfile(auth.username);
    return json({ ok: true, username: auth.username, profile: profile ?? null }, 200, origin ?? undefined);
  }

  return null;
}

export async function handleRanked(request: Request, env: Record<string, unknown>, repo: RankedRepo, origin: string | null): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const secret = typeof env.JET_RANKED_SECRET === 'string' ? env.JET_RANKED_SECRET : 'dev-secret-change-me';

  // Ladder pública (sem login) — multiplayer casual não exige conta.
  if (path === '/ranked/ladder' && request.method === 'GET') {
    await seedBots(repo);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));
    const lb = await leaderboard(repo, limit);
    return json({ ok: true, season: currentSeason(), ladder: lb }, 200, origin ?? undefined);
  }

  if (path === '/ranked/profile' && request.method === 'GET') {
    const auth = await authenticate(request, repo);
    if (!auth.ok) return auth.response;
    const lb = await leaderboard(repo, 100);
    const me = lb.find((e) => e.username === auth.username) ?? null;
    return json({ ok: true, profile: me }, 200, origin ?? undefined);
  }

  if (path === '/ranked/start' && request.method === 'POST') {
    const auth = await authenticate(request, repo);
    if (!auth.ok) return auth.response;
    await seedBots(repo);
    const season = currentSeason();
    if (!season || !seasonAcceptsMatch(season)) return json({ ok: false, error: 'temporada encerrada' }, 423, origin ?? undefined);

    const body = await readJson(request);
    const deckIds = Array.isArray(body.deck) ? body.deck.map(String) : [];
    const valid = validateSubmittedDeck(deckIds);
    if (!valid.ok) return json({ ok: false, error: valid.error }, 400, origin ?? undefined);

    const profile = await repo.getProfile(auth.username);
    const rating = profile?.rating ?? INITIAL_RATING;
    // Bot escolhe o arquétipo ANTES de ver qualquer info privada (arquétipo fixo).
    const bot = pickBotForRating(rating);
    const seed = (Date.now() ^ (rating * 31)) >>> 0;
    // O humano SEMPRE joga no assento 0 (o servidor atribui e valida o assento).
    const seat: 0 | 1 = 0;

    const ticket = await signTicket({ u: auth.username, s: seed, b: bot.id, seat, d: deckIds, t: Date.now() }, secret);
    return json({
      ok: true,
      matchId: `${seed}-${auth.username}-${bot.id}`,
      ticket,
      seed,
      seat,
      botId: bot.id,
      botName: bot.name,
      botArchetypeId: bot.archetypeId,
      seasonId: season.id
    }, 200, origin ?? undefined);
  }

  if (path === '/ranked/finish' && request.method === 'POST') {
    const auth = await authenticate(request, repo);
    if (!auth.ok) return auth.response;
    await seedBots(repo);
    const body = await readJson(request);
    const ticketStr = String(body.ticket ?? '');
    const payload = await verifyTicket(ticketStr, secret);
    if (!payload || payload.u !== auth.username) return json({ ok: false, error: 'ticket inválido ou expirado' }, 403, origin ?? undefined);

    const commands = Array.isArray(body.commands) ? (body.commands as Command[]) : [];
    const bot = botById(payload.b);
    if (!bot) return json({ ok: false, error: 'bot desconhecido' }, 400, origin ?? undefined);

    const deckValid = validateSubmittedDeck(payload.d);
    if (!deckValid.ok) return json({ ok: false, error: deckValid.error }, 400, origin ?? undefined);

    const archetype = ARCHETYPE_DECKS.find((d) => d.id === bot.archetypeId);
    if (!archetype) return json({ ok: false, error: 'arquétipo do bot desconhecido' }, 500, origin ?? undefined);
    const botDeck = expandDeck({ id: archetype.id, name: archetype.name, description: '', cards: archetype.cards }).map((id) => registry.card(id));

    let outcome;
    try {
      outcome = replayMatch({
        seed: payload.s,
        humanDeck: deckValid.deck,
        botDeck,
        botProfile: bot.profile,
        humanSeat: payload.seat,
        commands
      });
    } catch (e) {
      if (e instanceof ReplayError) return json({ ok: false, error: `partida rejeitada: ${e.message}` }, 400, origin ?? undefined);
      throw e;
    }

    const humanWon = outcome.winner === payload.seat;
    const winner = humanWon ? auth.username : bot.id;
    const loser = humanWon ? bot.id : auth.username;
    const season = currentSeason();
    const seasonId = season?.id ?? 'season-1';

    const applied = await applyRankedResult(repo, {
      rankedMatchId: `rm-${payload.u}-${payload.s}`,
      seasonId,
      winnerUsername: winner,
      loserUsername: loser
    });

    const lb = await leaderboard(repo, 100);
    const me = lb.find((e) => e.username === auth.username) ?? null;

    return json({
      ok: true,
      result: humanWon ? 'win' : 'loss',
      endReason: outcome.endReason,
      turns: outcome.turns,
      ratingAfter: humanWon ? applied.winnerRatingAfter : applied.loserRatingAfter,
      rank: humanWon ? applied.winnerRank : applied.loserRank,
      position: me?.position ?? null,
      isReiDaLiga: me?.isReiDaLiga ?? false
    }, 200, origin ?? undefined);
  }

  return null;
}

/** Escolhe um bot próximo do rating (sem contra-pick: arquétipo fixo por bot). */
function pickBotForRating(rating: number): (typeof BOT_ROSTER)[number] {
  let best = BOT_ROSTER[0];
  let bestDist = Infinity;
  for (const b of BOT_ROSTER) {
    const d = Math.abs(b.initialRating - rating);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}
