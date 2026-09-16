/**
 * STORE DA LIGA — estado do cliente (sessão, perfil, ladder, matchmaking).
 */

import { create } from 'zustand';
import {
  getToken, isRankedConfigured, rankedApi, setToken,
  type RankedHistoryRow, type RankedProfileDetails, type RankedProfileView, type RankedSeasonResultRow,
  type RankedSeasonView, type StartMatchResponse
} from './client';

export interface RankedState {
  configured: boolean;
  token: string;
  username: string | null;
  profile: RankedProfileView | null;
  ladder: RankedProfileView[];
  /**
   * Temporada LIDA DO SERVIDOR (`GET /ranked/season`) — janela, status e
   * liquidação vêm do banco; a UI não calcula temporada sozinha.
   */
  season: RankedSeasonView | null;
  /** Top 10 da rota de temporada (é onde o título REI DA LIGA aparece). */
  topTen: RankedProfileView[];
  /** Detalhes do próprio perfil (pico, melhor posição, highest rank). */
  details: RankedProfileDetails | null;
  /** Currículo liquidado da temporada, se `settleSeason` já rodou. */
  seasonResult: RankedSeasonResultRow | null;
  /** Partidas desta conta na temporada (servidor filtra por participante). */
  history: RankedHistoryRow[];
  /** Standings finais de uma temporada liquidada. */
  standings: RankedSeasonResultRow[];
  standingsSeasonId: string | null;
  /** Ticket da partida em andamento. */
  pendingStart: StartMatchResponse | null;
  busy: boolean;
  error: string | null;
  /** Resultado da última partida submetida (para a tela de vitória). */
  lastResult: {
    result: 'win' | 'loss'; ratingAfter: number; rank: string; position: number | null; isReiDaLiga: boolean;
    /** pico da temporada, melhor posição e melhor rank devolvidos pelo servidor */
    peakRating: number | null; bestPosition: number | null; highestRank: string | null;
    /** true = reenvio do mesmo ticket (o servidor não pontuou de novo) */
    alreadyApplied: boolean;
  } | null;

  init: () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshLadder: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Temporada + Top 10 (público) — funciona mesmo sem login. */
  refreshSeason: () => Promise<void>;
  /** Standings liquidados; sem `seasonId` o servidor usa a temporada mais recente. */
  loadStandings: (seasonId?: string) => Promise<void>;
  startMatch: (deck: string[]) => Promise<StartMatchResponse>;
  finishMatch: (ticket: string, commands: import('../engine/types').Command[]) => Promise<void>;
  clearError: () => void;
  clearLastResult: () => void;
}

export const useRanked = create<RankedState>((set, get) => ({
  configured: isRankedConfigured(),
  token: getToken(),
  username: null,
  profile: null,
  ladder: [],
  season: null,
  topTen: [],
  details: null,
  seasonResult: null,
  history: [],
  standings: [],
  standingsSeasonId: null,
  pendingStart: null,
  busy: false,
  error: null,
  lastResult: null,

  init: async () => {
    // a temporada é pública e é o cabeçalho da tela: busca antes do login
    await get().refreshSeason();
    const token = get().token;
    if (!token) return;
    try {
      const me = await rankedApi.me(token);
      set({ username: me.username });
      await get().refreshLadder();
      await get().refreshProfile();
    } catch {
      setToken('');
      set({ token: '', username: null });
    }
  },

  register: async (username, password) => {
    set({ busy: true, error: null });
    try {
      const r = await rankedApi.register(username, password);
      set({ token: r.token, username: r.username });
      await get().refreshLadder();
      await get().refreshProfile();
    } catch (e) {
      set({ error: (e as { error?: string })?.error ?? 'falha no registro' });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  login: async (username, password) => {
    set({ busy: true, error: null });
    try {
      const r = await rankedApi.login(username, password);
      set({ token: r.token, username: r.username });
      await get().refreshLadder();
      await get().refreshProfile();
    } catch (e) {
      set({ error: (e as { error?: string })?.error ?? 'falha no login' });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  logout: async () => {
    try {
      await rankedApi.logout(get().token);
    } catch {
      /* token pode já estar inválido */
    }
    set({ token: '', username: null, profile: null, details: null, seasonResult: null, history: [], standings: [] });
  },

  refreshLadder: async () => {
    try {
      const r = await rankedApi.ladder(get().token);
      set({ ladder: r.ladder });
    } catch {
      /* offline: mantém o último ladder */
    }
  },

  refreshProfile: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const r = await rankedApi.profile(token);
      set({ profile: r.profile, details: r.details, seasonResult: r.seasonResult, history: r.history ?? [] });
    } catch {
      /* offline: mantém o último estado lido */
    }
  },

  refreshSeason: async () => {
    if (!get().configured) return;
    try {
      const r = await rankedApi.season();
      set({ season: r.season, topTen: r.topTen ?? [] });
    } catch {
      /* offline: sem temporada não há como exibir janela/status */
    }
  },

  loadStandings: async (seasonId) => {
    try {
      const r = await rankedApi.seasonResults(seasonId);
      set({ standings: r.standings ?? [], standingsSeasonId: r.seasonId });
    } catch {
      set({ standings: [], standingsSeasonId: null });
    }
  },

  startMatch: async (deck) => {
    set({ busy: true, error: null });
    try {
      const r = await rankedApi.start(get().token, deck);
      set({ pendingStart: r });
      return r;
    } catch (e) {
      set({ error: (e as { error?: string })?.error ?? 'falha no matchmaking' });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  finishMatch: async (ticket, commands) => {
    set({ busy: true, error: null });
    try {
      const r = await rankedApi.finish(get().token, ticket, commands);
      set({
        lastResult: {
          result: r.result, ratingAfter: r.ratingAfter, rank: r.rank, position: r.position,
          isReiDaLiga: r.isReiDaLiga, peakRating: r.peakRating, bestPosition: r.bestPosition,
          highestRank: r.highestRank, alreadyApplied: r.alreadyApplied
        },
        pendingStart: null
      });
      await get().refreshLadder();
      await get().refreshProfile();
      await get().refreshSeason();
    } catch (e) {
      set({ error: (e as { error?: string })?.error ?? 'falha ao enviar o resultado' });
    } finally {
      set({ busy: false });
    }
  },

  clearError: () => set({ error: null }),
  clearLastResult: () => set({ lastResult: null })
}));
