/**
 * CLIENTE DA LIGA — fala com o Worker (D1 + auth + replay) via HTTP/JSON.
 *
 * A URL vem de `VITE_RANKED_API_URL` (mesma convenção do multiplayer). Sem ela,
 * a Liga fica "não configurada" e o modo casual/multiplayer seguem funcionando.
 * O token de sessão é guardado em localStorage (best-effort).
 */

import type { Command } from '../engine/types';
import type { RankId } from './ranks';

export interface RankedProfileView {
  username: string;
  rating: number;
  rank: RankId;
  position: number;
  wins: number;
  losses: number;
  isBot: boolean;
  isReiDaLiga: boolean;
}

export interface StartMatchResponse {
  ok: true;
  matchId: string;
  ticket: string;
  seed: number;
  seat: 0 | 1;
  botId: string;
  botName: string;
  botArchetypeId: string;
  seasonId: string;
}

export interface FinishMatchResponse {
  ok: true;
  /** matchId derivado do ticket — a chave de idempotência no servidor. */
  matchId: string;
  result: 'win' | 'loss';
  endReason: string;
  turns: number;
  ratingAfter: number;
  rank: RankId;
  /** Maior rating da temporada (não regride quando o Elo cai). */
  peakRating: number | null;
  position: number | null;
  /** Melhor (menor) posição já ocupada nesta temporada. */
  bestPosition: number | null;
  /** Melhor rank já alcançado (não regride ao cair). */
  highestRank: RankId | null;
  isReiDaLiga: boolean;
  /** true = o servidor já tinha aplicado este ticket (reenvio não pontua). */
  alreadyApplied: boolean;
  seasonId: string;
}

/** Estado da temporada, vindo do BANCO (o cliente não inventa janela). */
export type SeasonStatusView = 'pending' | 'active' | 'grace' | 'closed';

export interface RankedSeasonView {
  id: string;
  number: number;
  name: string;
  startAt: number;
  endAt: number;
  graceAfterEnd: number;
  status: SeasonStatusView;
  settledAt: number | null;
}

/** O que o servidor sabe do MEU perfil (pico e currículo não saem do cliente). */
export interface RankedProfileDetails {
  rating: number;
  rank: RankId;
  peakRating: number;
  bestPosition: number | null;
  highestRank: RankId;
  wins: number;
  losses: number;
  streak: number;
  seasonId: string | null;
}

export interface RankedSeasonResultRow {
  seasonId: string;
  username: string;
  finalRating: number;
  peakRating: number;
  finalPosition: number;
  bestPosition: number;
  highestRank: RankId;
  wasLeagueKing: boolean;
  /** Melhor posição que o REI DA LIGA ocupou na temporada (1 = topo). */
  leagueKingPeakPosition: number | null;
  wins: number;
  losses: number;
  settledAt: number;
}

export interface RankedHistoryRow {
  rankedMatchId: string;
  winner: string;
  playerA: string;
  playerB: string;
  deltaA: number;
  createdAt: number;
}

export interface RankedProfileResponse {
  ok: true;
  profile: RankedProfileView | null;
  season: { id: string; number: number; name: string; status: SeasonStatusView } | null;
  details: RankedProfileDetails | null;
  seasonResult: RankedSeasonResultRow | null;
  history: RankedHistoryRow[];
}

export interface RankedSeasonResponse {
  ok: true;
  season: RankedSeasonView | null;
  topTen: RankedProfileView[];
}

export interface RankedStandingsResponse {
  ok: true;
  seasonId: string;
  standings: RankedSeasonResultRow[];
}

const TOKEN_KEY = 'jet-ranked-token';

export function rankedUrl(): string {
  const raw = (import.meta.env.VITE_RANKED_API_URL as string | undefined)?.trim();
  return raw ?? '';
}

export function isRankedConfigured(): boolean {
  return rankedUrl().length > 0;
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage indisponível: sessão vive só em memória */
  }
}

export interface ApiError {
  status: number;
  error: string;
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const base = rankedUrl();
  if (!base) throw Object.assign(new Error('Liga Ranqueada não configurada'), { status: 0, error: 'não configurado' });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
  } catch {
    throw { status: 0, error: 'falha de rede ao falar com o servidor' } as ApiError;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw { status: res.status, error: err } as ApiError;
  }
  return data as T;
}

export const rankedApi = {
  async register(username: string, password: string): Promise<{ token: string; username: string }> {
    const r = await api<{ token: string; username: string }>('/auth/register', { method: 'POST', body: { username, password } });
    setToken(r.token);
    return r;
  },
  async login(username: string, password: string): Promise<{ token: string; username: string }> {
    const r = await api<{ token: string; username: string }>('/auth/login', { method: 'POST', body: { username, password } });
    setToken(r.token);
    return r;
  },
  async me(token: string): Promise<{ username: string; profile: RankedProfileView | null }> {
    return api('/auth/me', { token });
  },
  async logout(token: string): Promise<void> {
    await api('/auth/logout', { method: 'POST', token });
    setToken('');
  },
  async ladder(token: string): Promise<{ ladder: RankedProfileView[] }> {
    return api('/ranked/ladder?limit=100', { token });
  },
  async profile(token: string): Promise<RankedProfileResponse> {
    return api('/ranked/profile', { token });
  },
  /** Temporada corrente + Top 10 (rota PÚBLICA: não exige token). */
  async season(): Promise<RankedSeasonResponse> {
    return api('/ranked/season');
  },
  /** Standings liquidados de uma temporada (default: a mais recente). */
  async seasonResults(seasonId?: string): Promise<RankedStandingsResponse> {
    const q = seasonId ? `?season=${encodeURIComponent(seasonId)}` : '';
    return api(`/ranked/season/results${q}`);
  },
  async start(token: string, deck: string[]): Promise<StartMatchResponse> {
    return api('/ranked/start', { method: 'POST', token, body: { deck } });
  },
  async finish(token: string, ticket: string, commands: Command[]): Promise<FinishMatchResponse> {
    return api('/ranked/finish', { method: 'POST', token, body: { ticket, commands } });
  }
};
