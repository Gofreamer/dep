// @vitest-environment node
/**
 * D1 / MIGRATIONS — teste de integração REAL de SQL.
 *
 * Nada aqui é mock de banco: as migration `worker/migrations/*.sql` são lidas do
 * disco e aplicadas num SQLite de verdade (`node:sqlite` — o D1 da Cloudflare É
 * SQLite), e o `D1RankedRepo` roda em cima delas com um adaptador fino que
 * implementa `prepare/bind/all/first/run/exec` com a semântica do D1.
 *
 * Cobrimos o que só aparece com SQL real:
 *  - 0001 e 0002 aplicam em banco vazio E em banco populado SEM perder dados;
 *  - o backfill de 0002 (peak_rating/highest_rank/season_id) de fato preenche;
 *  - `INSERT OR IGNORE` da temporada é idempotente;
 *  - bots sobrevivem a "reabrir" o banco (novo repo sobre o mesmo arquivo);
 *  - a temporada semeada pela migration bate com as constantes de
 *    `src/ranked/seasons.ts` (doc/código não podem divergir).
 *
 * O que NÃO cobre (e está documentado em docs/PRODUCTION-CHECKLIST.md): o
 * serviço D1 da Cloudflare em si — aplicar `--remote`, `database_id` do
 * projeto, e o bind do Worker. Isso exige credencial de deploy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { D1RankedRepo } from '../worker/src/d1repo';
import { BOT_ROSTER } from '../src/ranked/bots';
import { seedBots } from '../src/ranked/matchmaking';
import { applyRankedResult, leaderboard, settleSeason } from '../src/ranked/ladder';
import { runLadderTick, scheduledMatchId, matchesForHour } from '../src/ranked/ladderTick';
import { SEASON_1, seasonStatus, toSeason } from '../src/ranked/seasons';
import { rankFor } from '../src/ranked/ranks';

const MIG_DIR = resolve(__dirname, '../worker/migrations');
const MIG_0001 = join(MIG_DIR, '0001_ranked.sql');
const MIG_0002 = join(MIG_DIR, '0002_ranked_seasons.sql');

// ---------------------------------------------------------------------------
// Adaptador D1 sobre node:sqlite
// ---------------------------------------------------------------------------

interface Stmt {
  bind(...vals: unknown[]): Stmt;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
}

function d1From(db: DatabaseSync): { exec(sql: string): Promise<void>; prepare(sql: string): Stmt } {
  return {
    async exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): Stmt {
      let args: unknown[] = [];
      const stmt = db.prepare(sql);
      const norm = (v: unknown): unknown => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null);
      return {
        bind(...vals: unknown[]) {
          args = vals.map(norm);
          return this;
        },
        async all<T>() {
          const rows = stmt.all(...(args as never[])) as unknown as T[];
          return { results: rows.map((r) => ({ ...r }) as T) };
        },
        async first<T>() {
          const rows = stmt.all(...(args as never[])) as unknown as T[];
          return rows.length ? ({ ...rows[0] } as T) : null;
        },
        async run() {
          const r = stmt.run(...(args as never[])) as unknown as { changes?: number };
          return { success: true, meta: { changes: Number(r?.changes ?? 0) } };
        }
      };
    }
  };
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

let dir = '';
let db: DatabaseSync;
let file = '';
/** valores gravados no teste anterior, relidos depois de reabrir o arquivo */
let stellaAfterReopen = 0;
let humanAfterReopen = { rating: 0, wins: 0, losses: 0 };

function fresh(path: string): DatabaseSync {
  return new DatabaseSync(path);
}

afterAll(() => {
  try { db?.close(); } catch { /* já fechado */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function repoOf(handle: DatabaseSync): D1RankedRepo {
  return new D1RankedRepo(d1From(handle) as unknown as D1Database);
}

describe('migrations D1 (0001 → 0002) em SQLite real', () => {
  it('aplicam em banco vazio e criam o esquema esperado', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jet-d1-'));
    file = join(dir, 'empty.sqlite');
    db = fresh(file);
    db.exec(readFileSync(MIG_0001, 'utf8'));
    db.exec(readFileSync(MIG_0002, 'utf8'));

    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[]).map((t) => t.name);
    for (const want of ['accounts', 'sessions', 'ranked_profiles', 'ranked_matches', 'seasons', 'season_results']) {
      expect(tables, `tabela ${want} não criada`).toContain(want);
    }
    const cols = (db.prepare(`PRAGMA table_info(ranked_profiles)`).all() as { name: string }[]).map((c) => c.name);
    for (const want of ['peak_rating', 'best_position', 'highest_rank', 'season_id']) {
      expect(cols, `coluna ${want} ausente`).toContain(want);
    }
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ranked_profiles`).get()).toMatchObject({ n: 0 });
  });

  it('preservam dados existentes e fazem o backfill (banco populado)', async () => {
    const pop = join(mkdtempSync(join(tmpdir(), 'jet-d1-pop-')), 'pop.sqlite');
    const dbp = fresh(pop);
    try {
      // só 0001 → dados "legados" da 2.0, sem nenhuma das colunas novas
      dbp.exec(readFileSync(MIG_0001, 'utf8'));
      dbp.prepare(
        `INSERT INTO ranked_profiles (username, rating, rank, wins, losses, streak, updated_at, is_bot)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
      ).run('veterana', 2110, 'CAMPEAO', 41, 12, 3, 1_700_000_000_000, 0);
      dbp.prepare(
        `INSERT INTO accounts (username, salt, hash, created_at) VALUES (?1,?2,?3,?4)`
      ).run('veterana', 'salt123', 'hashabc', 1_699_000_000_000);
      dbp.prepare(
        `INSERT INTO ranked_matches (ranked_match_id, season_id, player_a, player_b, winner, a_delta, b_delta, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
      ).run('rm-antiga', 'season-1', 'veterana', 'bot-moirai', 'veterana', 24, -24, 1_700_000_000_000);

      dbp.exec(readFileSync(MIG_0002, 'utf8'));

      const row = dbp.prepare(`SELECT * FROM ranked_profiles WHERE username = 'veterana'`).get() as Record<string, unknown>;
      // nada se perdeu
      expect(row.rating).toBe(2110);
      expect(row.wins).toBe(41);
      expect(row.losses).toBe(12);
      expect(row.streak).toBe(3);
      expect(row.rank).toBe('CAMPEAO');
      // ...e o backfill preencheu o que a 2.0 não tinha
      expect(row.peak_rating).toBe(2110);
      expect(row.highest_rank).toBe('CAMPEAO');
      expect(row.season_id).toBe('season-1');
      expect(row.best_position).toBeNull();
      const hist = dbp.prepare(`SELECT COUNT(*) AS n FROM ranked_matches WHERE ranked_match_id='rm-antiga'`).get() as { n: number };
      expect(hist.n).toBe(1);
      const acct = dbp.prepare(`SELECT salt, hash FROM accounts WHERE username='veterana'`).get() as { salt: string; hash: string };
      expect(acct.salt).toBe('salt123');
      expect(acct.hash).toBe('hashabc');

      // temporada semeada pela migration == constantes do código
      const season = dbp.prepare(`SELECT * FROM seasons WHERE id='season-1'`).get() as Record<string, unknown>;
      expect(season.number).toBe(1);
      expect(season.start_at).toBe(SEASON_1.startAt);
      expect(season.end_at).toBe(SEASON_1.endAt);
      expect(season.grace_after_end).toBe(SEASON_1.graceAfterEnd);
      expect(season.settled_at).toBeNull();
      // INSERT OR IGNORE é idempotente
      dbp.exec(`INSERT OR IGNORE INTO seasons (id, number, name, start_at, end_at, grace_after_end) VALUES ('season-1',1,'Season 1',${SEASON_1.startAt},${SEASON_1.endAt},${SEASON_1.graceAfterEnd})`);
      const n = dbp.prepare(`SELECT COUNT(*) AS n FROM seasons`).get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      dbp.close();
      rmSync(pop.replace(/[^/]*$/, ''), { recursive: true, force: true });
    }
  });

  it('o repositório D1 funciona sobre o esquema migrado (bots, rating, pico, posição)', async () => {
    const repo = repoOf(db);
    await seedBots(repo);
    const profs = await repo.listProfiles();
    expect(profs.length).toBe(BOT_ROSTER.length);
    expect(profs.every((p) => p.isBot)).toBe(true);
    // peak/pico/highestRank vêm do seed e são persistidos lidos de volta
    const stella = profs.find((p) => p.username === 'bot-stella-prime')!;
    expect(stella.peakRating).toBe(stella.rating);
    expect(stella.highestRank).toBe(rankFor(stella.rating).id);
    expect(stella.bestPosition).toBe(1);
    expect(stella.seasonId).toBe('season-1');

    // cria um humano e aplica um resultado real (idempotência do matchId)
    await repo.createAccount({ username: 'desafiante', salt: 's', hash: 'h', createdAt: 1 });
    await repo.upsertProfile({
      username: 'desafiante', rating: 2250, rank: rankFor(2250).id, wins: 5, losses: 2, streak: 2,
      updatedAt: 2, isBot: false, seasonId: 'season-1', peakRating: 2250, bestPosition: 20, highestRank: rankFor(2250).id
    });
    const res = await applyRankedResult(repo, {
      rankedMatchId: 'rm-d1-1', seasonId: 'season-1', winnerUsername: 'desafiante', loserUsername: 'bot-stella-prime', now: 3
    });
    expect(res.alreadyApplied).toBe(false);
    expect(res.winnerRatingAfter).toBeGreaterThan(2250);
    expect(res.loserRatingAfter).toBeLessThan(stella.rating);
    const again = await applyRankedResult(repo, {
      rankedMatchId: 'rm-d1-1', seasonId: 'season-1', winnerUsername: 'desafiante', loserUsername: 'bot-stella-prime', now: 4
    });
    expect(again.alreadyApplied).toBe(true);
    expect(again.winnerRatingAfter).toBe(res.winnerRatingAfter);

    // pico da STELLA não regride com a derrota; o do humano subiu
    const stellaAfter = (await repo.getProfile('bot-stella-prime'))!;
    expect(stellaAfter.rating).toBe(res.loserRatingAfter);
    stellaAfterReopen = stellaAfter.rating;
    expect(stellaAfter.peakRating).toBe(stella.rating);
    const human = (await repo.getProfile('desafiante'))!;
    humanAfterReopen = { rating: human.rating, wins: human.wins, losses: human.losses };
    expect(human.peakRating).toBe(res.winnerRatingAfter);
    expect(human.bestPosition).toBeLessThanOrEqual(20);

    // contas/sessões no SQL real (timestamps wall-clock: expiração compara com Date.now())
    const t0 = Date.now();
    await repo.createSession({ token: 'tok-vigente', username: 'desafiante', createdAt: t0 - 1_000, expiresAt: t0 + 60_000 });
    await repo.createSession({ token: 'tok-vencida', username: 'desafiante', createdAt: t0 - 120_000, expiresAt: t0 - 60_000 });
    expect((await repo.getSession('tok-vigente'))?.username).toBe('desafiante');
    // a leitura de sessão vencida já a elimina (defesa em profundidade)
    expect(await repo.getSession('tok-vencida')).toBeNull();
    await repo.purgeExpiredSessions(t0);
    expect((await repo.getSession('tok-vigente'))?.username).toBe('desafiante');
    const acct = (await repo.getAccount('desafiante'))!;
    expect(acct.salt).toBe('s');
    expect(acct.hash).toBe('h');
  });

  it('bots e resultados sobrevivem a reabrir o banco', async () => {
    // fecha e reabre o MESMO arquivo: é assim que se prova persistência real
    db.close();
    db = fresh(file);
    const repo = repoOf(db);
    const profs = await repo.listProfiles();
    // os 24 bots + o humano do teste anterior — persistência é do banco inteiro
    expect(profs.length).toBe(BOT_ROSTER.length + 1);
    expect(profs.filter((p) => p.isBot).length).toBe(BOT_ROSTER.length);
    const stella = (await repo.getProfile('bot-stella-prime'))!;
    expect(stella.isBot).toBe(true);
    expect(stella.rating).toBe(stellaAfterReopen); // a derrota do teste anterior persistiu
    const human = (await repo.getProfile('desafiante'))!;
    expect(human.rating).toBe(humanAfterReopen.rating);
    expect(human.wins).toBe(humanAfterReopen.wins);
    const seasons = await repo.listSeasons();
    expect(seasons.map((s) => s.id)).toContain('season-1');
    const matches = await repo.listMatches('season-1', 50);
    expect(matches.map((m) => m.rankedMatchId)).toContain('rm-d1-1');
  });

  it('tick agendado e liquidação gravam no banco migrado', async () => {
    const repo = repoOf(db);
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    const before = await repo.listMatches('season-1', 500);
    const tick = await runLadderTick(repo, { now });
    const inHour = matchesForHour(now);
    expect(tick.played).toBeGreaterThan(0);
    expect(tick.played).toBeLessThanOrEqual(inHour);
    expect(tick.pairings.length).toBe(tick.played);
    // matchId determinístico por (temporada, hora, slot)
    expect(tick.pairings[0].matchId).toBe(scheduledMatchId('season-1', now, tick.pairings[0].slot));
    const after = await repo.listMatches('season-1', 500);
    expect(after.length).toBeGreaterThan(before.length);
    // reexecutar a mesma hora não duplica
    const repeat = await runLadderTick(repo, { now: now + 60_000 });
    expect(repeat.played).toBe(0);
    const after2 = await repo.listMatches('season-1', 500);
    expect(after2.length).toBe(after.length);

    // liquidação: linhas em season_results com todos os campos pedidos
    const humanBefore = (await repo.getProfile('desafiante'))!;
    const rows = await settleSeason(repo, 'season-1', now);
    expect(rows.length).toBe(BOT_ROSTER.length + 1);
    const human = rows.find((r) => r.username === 'desafiante')!;
    expect(human.finalRating).toBeGreaterThan(0);
    expect(human.peakRating).toBeGreaterThanOrEqual(human.finalRating);
    expect(human.finalPosition).toBeGreaterThanOrEqual(1);
    expect(human.bestPosition).toBeLessThanOrEqual(human.finalPosition);
    expect(human.highestRank).toBeTruthy();
    expect(typeof human.wasLeagueKing).toBe('boolean');
    expect(human.wins).toBe(humanBefore.wins);
    expect(human.losses).toBe(humanBefore.losses);
    const season = (await repo.listSeasons()).find((s) => s.id === 'season-1')!;
    expect(season.settledAt).toBe(now);
    // read-back pelo repo (SQL de listagem com ORDER BY posição)
    const readBack = await repo.listSeasonResults('season-1');
    expect(readBack.length).toBe(rows.length);
    expect(readBack[0].finalPosition).toBe(1);
    expect(seasonStatus(toSeason(season), now)).toBe('active');
  });
});
