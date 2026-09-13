/**
 * STORE DA LIGA — estado do cliente (sessão, perfil, ladder, matchmaking).
 */

import { create } from 'zustand';
import { getToken, isRankedConfigured, rankedApi, setToken, type RankedProfileView, type StartMatchResponse } from './client';

export interface RankedState {
  configured: boolean;
  token: string;
  username: string | null;
  profile: RankedProfileView | null;
  ladder: RankedProfileView[];
  /** Ticket da partida em andamento. */
  pendingStart: StartMatchResponse | null;
  busy: boolean;
  error: string | null;
  /** Resultado da última partida submetida (para a tela de vitória). */
  lastResult: { result: 'win' | 'loss'; ratingAfter: number; rank: string; position: number | null; isReiDaLiga: boolean } | null;

  init: () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshLadder: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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
  pendingStart: null,
  busy: false,
  error: null,
  lastResult: null,

  init: async () => {
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
    set({ token: '', username: null, profile: null });
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
      set({ profile: r.profile });
    } catch {
      /* offline */
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
        lastResult: { result: r.result, ratingAfter: r.ratingAfter, rank: r.rank, position: r.position, isReiDaLiga: r.isReiDaLiga },
        pendingStart: null
      });
      await get().refreshLadder();
      await get().refreshProfile();
    } catch (e) {
      set({ error: (e as { error?: string })?.error ?? 'falha ao enviar o resultado' });
    } finally {
      set({ busy: false });
    }
  },

  clearError: () => set({ error: null }),
  clearLastResult: () => set({ lastResult: null })
}));
