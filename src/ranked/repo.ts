/**
 * REPOSITÓRIO DA LIGA — contrato de persistência para contas, sessões e ladder.
 *
 * A UI e a lógica de domínio falam APENAS com esta interface. Em produção o
 * worker implementa `D1RankedRepo` (Cloudflare D1); nos testes/desenvolvimento
 * usamos `MemoryRankedRepo`. Não há Firebase (requisito explícito).
 */

import type { RankId } from './ranks';

export interface Account {
  username: string;
  /** hash com salt (nunca a senha em claro). */
  salt: string;
  hash: string;
  createdAt: number;
}

export interface Session {
  token: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

export interface RankedProfile {
  username: string;
  rating: number;
  rank: RankId;
  wins: number;
  losses: number;
  streak: number;
  updatedAt: number;
  /** true = bot (âncora da liga). */
  isBot: boolean;
  /**
   * Temporada a que o perfil pertence. Perfis de temporadas liquidadas ficam
   * congelados (o rating final vira histórico em `season_results`).
   */
  seasonId?: string;
  /** Maior rating já atingido NA TEMPORADA atual (não cai quando o Elo cai). */
  peakRating?: number;
  /** Melhor (menor) posição no ladder já ocupada nesta temporada. */
  bestPosition?: number | null;
  /** Melhor rank de liga já atingido (não regrada quando o jogador cai). */
  highestRank?: RankId;
}

/** Definição de temporada persistida (a UI nunca decide a temporada sozinha). */
export interface SeasonRow {
  id: string;
  number: number;
  name: string;
  startAt: number;
  endAt: number;
  graceAfterEnd: number;
  /** liquidação escrita por `settleSeason` (idempotente). */
  settledAt?: number | null;
}

/** Linha de resultado de temporada (o "currículo" do jogador). */
export interface SeasonResultRow {
  seasonId: string;
  username: string;
  finalRating: number;
  peakRating: number;
  finalPosition: number;
  bestPosition: number;
  highestRank: RankId;
  wasLeagueKing: boolean;
  /** Melhor posição que o REI DA LIGA ocupou durante a temporada (1 = topo). */
  leagueKingPeakPosition: number | null;
  wins: number;
  losses: number;
  settledAt: number;
}

export interface RankedMatch {
  /** Idempotência: aplicar o mesmo id de novo NÃO muda rating. */
  rankedMatchId: string;
  seasonId: string;
  playerA: string;
  playerB: string;
  winner: string;
  aRatingDelta: number;
  bRatingDelta: number;
  createdAt: number;
}

export interface RankedRepo {
  // contas / sessões ------------------------------------------------------
  getAccount(username: string): Promise<Account | null>;
  createAccount(account: Account): Promise<void>;
  createSession(session: Session): Promise<void>;
  getSession(token: string): Promise<Session | null>;
  deleteSession(token: string): Promise<void>;
  /** Remove sessões expiradas (manutenção). */
  purgeExpiredSessions(now: number): Promise<void>;

  // ladder ----------------------------------------------------------------
  getProfile(username: string): Promise<RankedProfile | null>;
  upsertProfile(profile: RankedProfile): Promise<void>;
  /** Todos os perfis da temporada (para ranking global). */
  listProfiles(): Promise<RankedProfile[]>;
  getMatch(rankedMatchId: string): Promise<RankedMatch | null>;
  recordMatch(match: RankedMatch): Promise<void>;
  /** Últimas N partidas (histórico do perfil). */
  listMatches(seasonId: string, limit: number): Promise<RankedMatch[]>;

  // temporadas -------------------------------------------------------------
  listSeasons(): Promise<SeasonRow[]>;
  upsertSeason(season: SeasonRow): Promise<void>;
  listSeasonResults(seasonId: string): Promise<SeasonResultRow[]>;
  upsertSeasonResult(row: SeasonResultRow): Promise<void>;
}

/** Implementação em memória — testes, dev local e fallback do bot-ladder. */
export class MemoryRankedRepo implements RankedRepo {
  accounts = new Map<string, Account>();
  sessions = new Map<string, Session>();
  profiles = new Map<string, RankedProfile>();
  matches = new Map<string, RankedMatch>();
  seasons = new Map<string, SeasonRow>();
  seasonResults = new Map<string, SeasonResultRow>();

  async getAccount(username: string): Promise<Account | null> {
    return this.accounts.get(username.toLowerCase()) ?? null;
  }
  async createAccount(account: Account): Promise<void> {
    this.accounts.set(account.username.toLowerCase(), account);
  }
  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.token, session);
  }
  async getSession(token: string): Promise<Session | null> {
    return this.sessions.get(token) ?? null;
  }
  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }
  async purgeExpiredSessions(now: number): Promise<void> {
    for (const [t, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(t);
  }

  async getProfile(username: string): Promise<RankedProfile | null> {
    return this.profiles.get(username.toLowerCase()) ?? null;
  }
  async upsertProfile(profile: RankedProfile): Promise<void> {
    this.profiles.set(profile.username.toLowerCase(), profile);
  }
  async listProfiles(): Promise<RankedProfile[]> {
    return [...this.profiles.values()];
  }
  async getMatch(rankedMatchId: string): Promise<RankedMatch | null> {
    return this.matches.get(rankedMatchId) ?? null;
  }
  async recordMatch(match: RankedMatch): Promise<void> {
    this.matches.set(match.rankedMatchId, match);
  }
  async listMatches(seasonId: string, limit: number): Promise<RankedMatch[]> {
    return [...this.matches.values()].filter((m) => m.seasonId === seasonId).sort((x, y) => y.createdAt - x.createdAt).slice(0, limit);
  }

  async listSeasons(): Promise<SeasonRow[]> {
    return [...this.seasons.values()].sort((a, b) => a.number - b.number);
  }
  async upsertSeason(season: SeasonRow): Promise<void> {
    this.seasons.set(season.id, { ...season });
  }
  private static resultKey(seasonId: string, username: string): string {
    return `${seasonId}|${username.toLowerCase()}`;
  }
  async listSeasonResults(seasonId: string): Promise<SeasonResultRow[]> {
    return [...this.seasonResults.values()]
      .filter((r) => r.seasonId === seasonId)
      .sort((a, b) => a.finalPosition - b.finalPosition);
  }
  async upsertSeasonResult(row: SeasonResultRow): Promise<void> {
    this.seasonResults.set(MemoryRankedRepo.resultKey(row.seasonId, row.username), { ...row });
  }
}
