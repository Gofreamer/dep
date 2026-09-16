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
import { BOT_ROSTER, botById, isReservedUsername } from '../../src/ranked/bots';
import { applyRankedResult, leaderboard, seasonStandings } from '../../src/ranked/ladder';
import { INITIAL_RATING } from '../../src/ranked/rating';
import { rankFor } from '../../src/ranked/ranks';
import { activeSeason, seasonAcceptsMatch, seasonStatus, toSeason, type Season } from '../../src/ranked/seasons';
import { findOpponent, seedBots } from '../../src/ranked/matchmaking';
import { resolveRankedSecret, type RankedEnvLike } from './config';
import type { RankedRepo, SeasonResultRow } from '../../src/ranked/repo';
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

/**
 * Payload assinado do matchmaking. `sid`/`mid`/`n` entraram na 2.1 porque o
 * ticket precisa amarrar (a) a temporada em que a partida vale, (b) a chave de
 * idempotência do rating e (c) um nonce que torna o `matchId` não colidível —
 * sem nonce, duas partidas do mesmo humano vs mesmo bot no mesmo milissegundo
 * compartilhavam `rm-<user>-<seed>` e a segunda NÃO pontuava.
 */
export interface TicketPayload {
  /** versão do formato (rejeita tickets de 2.0) */
  v: 2;
  u: string;
  s: number;
  b: string;
  seat: 0 | 1;
  d: string[];
  t: number;
  sid: string;
  mid: string;
  n: string;
}

const TICKET_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Exportado só para os testes de forja (assinatura com segredo errado, ticket
 * expirado, payload adulterado) — nenhuma rota do jogo chama isto diretamente.
 */
export async function signTicket(payload: TicketPayload, secret: string): Promise<string> {
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
    // shape + versão + expiração: qualquer desvio é tratado como inválido
    if (payload.v !== 2) return null;
    if (typeof payload.u !== 'string' || typeof payload.s !== 'number' || typeof payload.b !== 'string') return null;
    if (payload.seat !== 0 && payload.seat !== 1) return null;
    if (!Array.isArray(payload.d) || !payload.d.every((x) => typeof x === 'string')) return null;
    if (typeof payload.t !== 'number' || !Number.isFinite(payload.t)) return null;
    if (typeof payload.sid !== 'string' || typeof payload.mid !== 'string' || typeof payload.n !== 'string') return null;
    if (payload.t > Date.now() + 60_000) return null; // ticket "do futuro" = forjado
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

/** Bytes aleatórios em hex (nonce/seed). Usa o CSPRNG do runtime. */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Seed da partida: ALEATÓRIA e secreta até o fim (o cliente não pode escolher
 * a seed — escolher seed seria escolher embaralhamento).
 */
function matchSeed(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0];
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
    if (isReservedUsername(username)) {
      return json({ ok: false, error: 'esse nome pertence a um bot da liga — escolha outro' }, 409, origin ?? undefined);
    }
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

export async function handleRanked(request: Request, env: RankedEnvLike, repo: RankedRepo, origin: string | null): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const secretRes = resolveRankedSecret(env);
  /**
   * Falha fechada: sem `JET_RANKED_SECRET` o worker NÃO assina nem aceita
   * tickets (o fallback `'dev-secret-change-me'` da 2.0 era público no
   * repositório → qualquer um forjava resultado ranqueado). O fallback de dev
   * só vale com opt-in explícito (`NODE_ENV=development`/`ALLOW_INSECURE_ORIGIN=1`).
   * Rotas de LEITURA seguem no ar: num incidente da chave dá para continuar
   * consultando ladder/perfil, só não dá para liquidar partida nova.
   */
  const writeGuard = secretRes.ok
    ? null
    : json({ ok: false, error: `Liga indisponível: ${secretRes.error}` }, 503, origin ?? undefined);

  // Ladder pública (sem login) — multiplayer casual não exige conta.
  if (path === '/ranked/ladder' && request.method === 'GET') {
    await seedBots(repo);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));
    const lb = await leaderboard(repo, limit);
    // temporada lida do BANCO (a UI e o worker têm de ver a mesma resposta
    // depois de um deploy que liquide S1 e abra S2)
    const season = await activeSeason(repo);
    return json({
      ok: true,
      season: season ? { id: season.id, number: season.number, name: season.name, status: seasonStatus(season), settledAt: season.settledAt ?? null } : null,
      bots: BOT_ROSTER.length,
      ladder: lb
    }, 200, origin ?? undefined);
  }

  if (path === '/ranked/profile' && request.method === 'GET') {
    const auth = await authenticate(request, repo);
    if (!auth.ok) return auth.response;
    const season = await activeSeason(repo);
    const lb = await leaderboard(repo, 100);
    const me = lb.find((e) => e.username === auth.username) ?? null;
    const own = await repo.getProfile(auth.username);
    // Resultado liquidado da temporada (se houver) — é o "currículo" que a
    // tela de perfil exibe; vem do banco, não de contas no cliente.
    let seasonResult: SeasonResultRow | null = null;
    if (season) {
      const rows = await repo.listSeasonResults(season.id);
      seasonResult = rows.find((r) => r.username.toLowerCase() === auth.username) ?? null;
    }
    const meKey = auth.username.toLowerCase();
    // SOMENTE partidas em que ESTE jogador participa (listMatches é por
    // temporada e inclui os ticks bot×bot da escada).
    const history = season ? (await repo.listMatches(season.id, 200))
      .filter((m) => m.playerA.toLowerCase() === meKey || m.playerB.toLowerCase() === meKey)
      .slice(0, 10)
      .map((m) => ({
      rankedMatchId: m.rankedMatchId,
      winner: m.winner,
      playerA: m.playerA,
      playerB: m.playerB,
      deltaA: m.aRatingDelta,
      createdAt: m.createdAt
    })) : [];
    return json({
      ok: true,
      profile: me,
      season: season ? { id: season.id, number: season.number, name: season.name, status: seasonStatus(season) } : null,
      details: own ? {
        rating: own.rating,
        rank: own.rank,
        peakRating: own.peakRating ?? own.rating,
        bestPosition: own.bestPosition ?? me?.position ?? null,
        highestRank: own.highestRank ?? own.rank,
        wins: own.wins,
        losses: own.losses,
        streak: own.streak,
        seasonId: own.seasonId ?? season?.id ?? null
      } : null,
      seasonResult,
      history
    }, 200, origin ?? undefined);
  }

  if (path === '/ranked/season' && request.method === 'GET') {
    const season = await activeSeason(repo);
    const lb = await leaderboard(repo, 10);
    return json({
      ok: true,
      season: season ? {
        id: season.id, number: season.number, name: season.name,
        startAt: season.startAt, endAt: season.endAt, graceAfterEnd: season.graceAfterEnd,
        status: seasonStatus(season), settledAt: season.settledAt ?? null
      } : null,
      topTen: lb
    }, 200, origin ?? undefined);
  }

  if (path === '/ranked/season/results' && request.method === 'GET') {
    const requested = url.searchParams.get('season');
    const seasons = await repo.listSeasons();
    const seasonId = requested ?? seasons[seasons.length - 1]?.id ?? 'season-1';
    const rows = await seasonStandings(repo, seasonId);
    return json({ ok: true, seasonId, standings: rows }, 200, origin ?? undefined);
  }

  if (path === '/ranked/start' && request.method === 'POST') {
    if (writeGuard) return writeGuard;
    const auth = await authenticate(request, repo);
    if (!auth.ok) return auth.response;
    await seedBots(repo);
    const season = await activeSeason(repo);
    if (!season || !seasonAcceptsMatch(season)) return json({ ok: false, error: 'temporada encerrada' }, 423, origin ?? undefined);

    const body = await readJson(request);
    const deckIds = Array.isArray(body.deck) ? body.deck.map(String) : [];
    const valid = validateSubmittedDeck(deckIds);
    if (!valid.ok) return json({ ok: false, error: valid.error }, 400, origin ?? undefined);

    const profile = await repo.getProfile(auth.username);
    const rating = profile?.rating ?? INITIAL_RATING;
    // Bot escolhido pelo rating VIVO do ladder (não o `initialRating` da
    // ficha) e sem contra-pick: o arquétipo é fixo no perfil do bot.
    const pick = await findOpponent(repo, rating);
    const bot = pick.bot;
    const seed = matchSeed();
    const nonce = randomHex(8);
    // O humano SEMPRE joga no assento 0 (o servidor atribui e valida o assento).
    const seat: 0 | 1 = 0;
    const matchId = `rm-${season.id}-${auth.username}-${bot.id}-${nonce}`;

    const ticket = await signTicket(
      { v: 2, u: auth.username, s: seed, b: bot.id, seat, d: deckIds, t: Date.now(), sid: season.id, mid: matchId, n: nonce },
      secretRes.ok ? secretRes.secret : ''
    );
    return json({
      ok: true,
      matchId,
      ticket,
      seed,
      seat,
      botId: bot.id,
      botName: bot.name,
      botArchetypeId: bot.archetypeId,
      botRating: pick.botRating,
      matchReason: pick.reason,
      seasonId: season.id,
      seasonNumber: season.number
    }, 200, origin ?? undefined);
  }

  if (path === '/ranked/finish' && request.method === 'POST') {
    if (writeGuard) return writeGuard;
    const auth = await authenticate(request, repo);
    if (!auth.ok) return auth.response;
    await seedBots(repo);
    const body = await readJson(request);
    const ticketStr = String(body.ticket ?? '');
    const payload = await verifyTicket(ticketStr, secretRes.ok ? secretRes.secret : '');
    if (!payload || payload.u !== auth.username) return json({ ok: false, error: 'ticket inválido ou expirado' }, 403, origin ?? undefined);

    // A temporada do ticket precisa existir no banco e ainda aceitar resultado
    // (janela ativa OU graça): impede injetar rating em temporada arquivada.
    const seasons = await repo.listSeasons();
    const ticketSeason = seasons.find((x) => x.id === payload.sid);
    if (!ticketSeason) return json({ ok: false, error: 'temporada do ticket desconhecida' }, 409, origin ?? undefined);
    if (!seasonAcceptsMatch(toSeasonOf(ticketSeason))) {
      return json({ ok: false, error: `temporada ${ticketSeason.number} encerrada — resultado não é mais aceito` }, 423, origin ?? undefined);
    }

    const commands = Array.isArray(body.commands) ? (body.commands as Command[]) : [];
    if (commands.length > MAX_REPLAY_COMMANDS) {
      return json({ ok: false, error: `sequência de comandos longa demais (${commands.length} > ${MAX_REPLAY_COMMANDS})` }, 413, origin ?? undefined);
    }
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

    const applied = await applyRankedResult(repo, {
      // Chave de idempotência = matchId do ticket: reenviar o MESMO ticket não
      // pontua de novo; e cada partida nova tem nonce próprio (o formato antigo
      // `rm-<user>-<seed>` colidia quando duas partidas caíam no mesmo seed).
      rankedMatchId: payload.mid,
      seasonId: payload.sid,
      winnerUsername: winner,
      loserUsername: loser
    });

    const lb = await leaderboard(repo, 100);
    const me = lb.find((e) => e.username === auth.username) ?? null;
    const own = await repo.getProfile(auth.username);

    return json({
      ok: true,
      matchId: payload.mid,
      result: humanWon ? 'win' : 'loss',
      endReason: outcome.endReason,
      turns: outcome.turns,
      ratingAfter: humanWon ? applied.winnerRatingAfter : applied.loserRatingAfter,
      rank: humanWon ? applied.winnerRank : applied.loserRank,
      peakRating: own?.peakRating ?? null,
      position: me?.position ?? null,
      bestPosition: own?.bestPosition ?? null,
      highestRank: own?.highestRank ?? null,
      isReiDaLiga: me?.isReiDaLiga ?? false,
      alreadyApplied: applied.alreadyApplied,
      seasonId: payload.sid
    }, 200, origin ?? undefined);
  }

  return null;
}

/** Teto defensivo de replay (CPU do Worker): nada de processar payload gigante. */
const MAX_REPLAY_COMMANDS = 4000;

/** Bridge de tipo: linha de `seasons` do banco → objeto de regras de janela. */
function toSeasonOf(row: import('../../src/ranked/repo').SeasonRow): Season {
  return toSeason(row);
}
