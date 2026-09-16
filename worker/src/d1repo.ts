/**
 * D1RankedRepo — implementação D1 (Cloudflare) do contrato RankedRepo.
 *
 * Tabelas (criadas por `worker/migrations/*.sql`):
 *   accounts         (username PK, salt, hash, created_at)
 *   sessions         (token PK, username, created_at, expires_at)
 *   ranked_profiles  (username PK, rating, rank, wins, losses, streak, updated_at, is_bot
 *                     + 0002: peak_rating, best_position, highest_rank, season_id)
 *   ranked_matches   (ranked_match_id PK, season_id, player_a, player_b, winner, a_delta, b_delta, created_at)
 *   seasons          (0002: id PK, number UNIQUE, name, start_at, end_at, grace_after_end, settled_at)
 *   season_results   (0002: (season_id, username) PK, finais/picos/posição/Rei da Liga)
 *
 * As colunas de 0002 são lidas com `COALESCE`, então o repo continua funcionando
 * num banco onde a migration ainda não foi aplicada (só não reporta pico).
 */

import type {
  Account, RankedMatch, RankedProfile, RankedRepo, SeasonResultRow, SeasonRow, Session
} from '../../src/ranked/repo';
import type { RankId } from '../../src/ranked/ranks';

/** Colunas lidas de `ranked_profiles` (0001 + 0002). */
const PROFILE_COLS = `username, rating, rank, wins, losses, streak, updated_at, is_bot,
       peak_rating, best_position, highest_rank, season_id`;

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

  private static mapProfile(r: D1ProfileRow): RankedProfile {
    return {
      username: r.username, rating: r.rating, rank: r.rank as RankId, wins: r.wins, losses: r.losses,
      streak: r.streak, updatedAt: r.updated_at, isBot: r.is_bot === 1,
      peakRating: r.peak_rating ?? r.rating,
      bestPosition: r.best_position ?? null,
      highestRank: (r.highest_rank ?? r.rank) as RankId,
      seasonId: r.season_id ?? undefined
    };
  }

  async getProfile(username: string): Promise<RankedProfile | null> {
    const r = await this.db.prepare(
      `SELECT ${PROFILE_COLS} FROM ranked_profiles WHERE username = ?1`
    ).bind(username.toLowerCase()).first<D1ProfileRow>();
    if (!r) return null;
    return D1RankedRepo.mapProfile(r);
  }

  async upsertProfile(profile: RankedProfile): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO ranked_profiles
         (username, rating, rank, wins, losses, streak, updated_at, is_bot,
          peak_rating, best_position, highest_rank, season_id)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
    ).bind(
      profile.username.toLowerCase(), profile.rating, profile.rank, profile.wins, profile.losses,
      profile.streak, profile.updatedAt, profile.isBot ? 1 : 0,
      // peak_rating nunca pode REGREDIR, mesmo com um escritor desatento
      Math.max(profile.peakRating ?? profile.rating, profile.rating),
      profile.bestPosition ?? null, profile.highestRank ?? profile.rank, profile.seasonId ?? null
    ).run();
  }

  async listProfiles(): Promise<RankedProfile[]> {
    const r = await this.db.prepare(`SELECT ${PROFILE_COLS} FROM ranked_profiles`)
      .all<D1ProfileRow>();
    return (r.results ?? []).map((p) => D1RankedRepo.mapProfile(p));
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

  // temporadas ---------------------------------------------------------------
  async listSeasons(): Promise<SeasonRow[]> {
    const r = await this.db.prepare(
      'SELECT id, number, name, start_at, end_at, grace_after_end, settled_at FROM seasons ORDER BY number ASC'
    ).all<D1SeasonRow>();
    return (r.results ?? []).map((s) => ({
      id: s.id, number: s.number, name: s.name, startAt: s.start_at, endAt: s.end_at,
      graceAfterEnd: s.grace_after_end, settledAt: s.settled_at ?? null
    }));
  }

  async upsertSeason(season: SeasonRow): Promise<void> {
    await this.db.prepare(
      `INSERT INTO seasons (id, number, name, start_at, end_at, grace_after_end, settled_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7)
       ON CONFLICT(id) DO UPDATE SET
         number = excluded.number, name = excluded.name, start_at = excluded.start_at,
         end_at = excluded.end_at, grace_after_end = excluded.grace_after_end,
         settled_at = COALESCE(excluded.settled_at, seasons.settled_at)`
    ).bind(season.id, season.number, season.name, season.startAt, season.endAt, season.graceAfterEnd, season.settledAt ?? null).run();
  }

  async listSeasonResults(seasonId: string): Promise<SeasonResultRow[]> {
    const r = await this.db.prepare(
      `SELECT season_id, username, final_rating, peak_rating, final_position, best_position,
              highest_rank, was_league_king, league_king_peak_position, wins, losses, settled_at
         FROM season_results WHERE season_id = ?1 ORDER BY final_position ASC`
    ).bind(seasonId).all<D1SeasonResultRow>();
    return (r.results ?? []).map((x) => ({
      seasonId: x.season_id, username: x.username, finalRating: x.final_rating, peakRating: x.peak_rating,
      finalPosition: x.final_position, bestPosition: x.best_position, highestRank: x.highest_rank as RankId,
      wasLeagueKing: x.was_league_king === 1, leagueKingPeakPosition: x.league_king_peak_position ?? null,
      wins: x.wins, losses: x.losses, settledAt: x.settled_at
    }));
  }

  async upsertSeasonResult(row: SeasonResultRow): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO season_results
         (season_id, username, final_rating, peak_rating, final_position, best_position,
          highest_rank, was_league_king, league_king_peak_position, wins, losses, settled_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
    ).bind(
      row.seasonId, row.username.toLowerCase(), row.finalRating, row.peakRating, row.finalPosition, row.bestPosition,
      row.highestRank, row.wasLeagueKing ? 1 : 0, row.leagueKingPeakPosition ?? null, row.wins, row.losses, row.settledAt
    ).run();
  }
}

interface D1ProfileRow {
  username: string; rating: number; rank: string; wins: number; losses: number; streak: number;
  updated_at: number; is_bot: number; peak_rating: number | null; best_position: number | null;
  highest_rank: string | null; season_id: string | null;
}

interface D1SeasonRow {
  id: string; number: number; name: string; start_at: number; end_at: number;
  grace_after_end: number; settled_at: number | null;
}

interface D1SeasonResultRow {
  season_id: string; username: string; final_rating: number; peak_rating: number; final_position: number;
  best_position: number; highest_rank: string; was_league_king: number;
  league_king_peak_position: number | null; wins: number; losses: number; settled_at: number;
}
