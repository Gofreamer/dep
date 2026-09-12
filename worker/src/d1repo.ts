/**
 * D1RankedRepo — implementação D1 (Cloudflare) do contrato RankedRepo.
 *
 * Tabelas (criadas por `worker/migrations/*.sql`):
 *   accounts         (username PK, salt, hash, created_at)
 *   sessions         (token PK, username, created_at, expires_at)
 *   ranked_profiles  (username PK, rating, rank, wins, losses, streak, updated_at, is_bot)
 *   ranked_matches   (ranked_match_id PK, season_id, player_a, player_b, winner, a_delta, b_delta, created_at)
 */

import type { Account, RankedMatch, RankedProfile, RankedRepo, Session } from '../../src/ranked/repo';
import type { RankId } from '../../src/ranked/ranks';

interface D1Result<T> {
  results: T[];
}

export class D1RankedRepo implements RankedRepo {
  constructor(private db: D1Database) {}

  // contas / sessões --------------------------------------------------------
  async getAccount(username: string): Promise<Account | null> {
    const r = await this.db.prepare('SELECT username, salt, hash, created_at FROM accounts WHERE username = ?1').bind(username.toLowerCase()).first<{ username: string; salt: string; hash: string; created_at: number }>();
    if (!r) return null;
    return { username: r.username, salt: r.salt, hash: r.hash, createdAt: r.created_at };
  }

  async createAccount(account: Account): Promise<void> {
    await this.db.prepare('INSERT OR REPLACE INTO accounts (username, salt, hash, created_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(account.username.toLowerCase(), account.salt, account.hash, account.createdAt).run();
  }

  async createSession(session: Session): Promise<void> {
    await this.db.prepare('INSERT OR REPLACE INTO sessions (token, username, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(session.token, session.username, session.createdAt, session.expiresAt).run();
  }

  async getSession(token: string): Promise<Session | null> {
    const r = await this.db.prepare('SELECT token, username, created_at, expires_at FROM sessions WHERE token = ?1').bind(token).first<{ token: string; username: string; created_at: number; expires_at: number }>();
    if (!r) return null;
    if (r.expires_at <= Date.now()) {
      await this.deleteSession(token);
      return null;
    }
    return { token: r.token, username: r.username, createdAt: r.created_at, expiresAt: r.expires_at };
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
  }

  async purgeExpiredSessions(now: number): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now).run();
  }

  // ladder ------------------------------------------------------------------
  async getProfile(username: string): Promise<RankedProfile | null> {
    const r = await this.db.prepare('SELECT username, rating, rank, wins, losses, streak, updated_at, is_bot FROM ranked_profiles WHERE username = ?1')
      .bind(username.toLowerCase()).first<{ username: string; rating: number; rank: string; wins: number; losses: number; streak: number; updated_at: number; is_bot: number }>();
    if (!r) return null;
    return {
      username: r.username, rating: r.rating, rank: r.rank as RankId, wins: r.wins, losses: r.losses, streak: r.streak, updatedAt: r.updated_at, isBot: r.is_bot === 1
    };
  }

  async upsertProfile(profile: RankedProfile): Promise<void> {
    await this.db.prepare(
      'INSERT OR REPLACE INTO ranked_profiles (username, rating, rank, wins, losses, streak, updated_at, is_bot) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
    ).bind(profile.username.toLowerCase(), profile.rating, profile.rank, profile.wins, profile.losses, profile.streak, profile.updatedAt, profile.isBot ? 1 : 0).run();
  }

  async listProfiles(): Promise<RankedProfile[]> {
    const r = await this.db.prepare('SELECT username, rating, rank, wins, losses, streak, updated_at, is_bot FROM ranked_profiles').all<{ username: string; rating: number; rank: string; wins: number; losses: number; streak: number; updated_at: number; is_bot: number }>();
    return (r.results ?? []).map((p) => ({
      username: p.username, rating: p.rating, rank: p.rank as RankId, wins: p.wins, losses: p.losses, streak: p.streak, updatedAt: p.updated_at, isBot: p.is_bot === 1
    }));
  }

  async getMatch(rankedMatchId: string): Promise<RankedMatch | null> {
    const r = await this.db.prepare('SELECT ranked_match_id, season_id, player_a, player_b, winner, a_delta, b_delta, created_at FROM ranked_matches WHERE ranked_match_id = ?1')
      .bind(rankedMatchId).first<{ ranked_match_id: string; season_id: string; player_a: string; player_b: string; winner: string; a_delta: number; b_delta: number; created_at: number }>();
    if (!r) return null;
    return { rankedMatchId: r.ranked_match_id, seasonId: r.season_id, playerA: r.player_a, playerB: r.player_b, winner: r.winner, aRatingDelta: r.a_delta, bRatingDelta: r.b_delta, createdAt: r.created_at };
  }

  async recordMatch(match: RankedMatch): Promise<void> {
    await this.db.prepare(
      'INSERT OR IGNORE INTO ranked_matches (ranked_match_id, season_id, player_a, player_b, winner, a_delta, b_delta, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
    ).bind(match.rankedMatchId, match.seasonId, match.playerA, match.playerB, match.winner, match.aRatingDelta, match.bRatingDelta, match.createdAt).run();
  }

  async listMatches(seasonId: string, limit: number): Promise<RankedMatch[]> {
    const r = await this.db.prepare('SELECT ranked_match_id, season_id, player_a, player_b, winner, a_delta, b_delta, created_at FROM ranked_matches WHERE season_id = ?1 ORDER BY created_at DESC LIMIT ?2')
      .bind(seasonId, limit).all<{ ranked_match_id: string; season_id: string; player_a: string; player_b: string; winner: string; a_delta: number; b_delta: number; created_at: number }>();
    return (r.results ?? []).map((m) => ({ rankedMatchId: m.ranked_match_id, seasonId: m.season_id, playerA: m.player_a, playerB: m.player_b, winner: m.winner, aRatingDelta: m.a_delta, bRatingDelta: m.b_delta, createdAt: m.created_at }));
  }
}
