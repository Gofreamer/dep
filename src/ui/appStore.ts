import { create } from 'zustand';
import { metaStore } from '../persistence/store';
import type { MatchConfig } from '../game/controller';

export type Screen =
  | 'title' | 'menu' | 'deckSelect' | 'builder' | 'collection'
  | 'match' | 'results' | 'history' | 'settings'
  | 'multiplayer' | 'onlineMatch' | 'ranked';

interface AppState {
  screen: Screen;
  editingDeckId: string | null;
  matchConfig: MatchConfig | null;
  lastOutcome: 'win' | 'loss' | null;
  toast: { id: number; text: string } | null;
  go: (s: Screen) => void;
  openBuilder: (deckId: string | null) => void;
  startMatch: (cfg: MatchConfig) => void;
  finishMatch: (result: 'win' | 'loss') => void;
  showToast: (text: string) => void;
}

let toastId = 1;

export const useApp = create<AppState>((set, get) => ({
  screen: 'title',
  editingDeckId: null,
  matchConfig: null,
  lastOutcome: null,
  toast: null,
  go: (s) => set({ screen: s }),
  openBuilder: (deckId) => set({ screen: 'builder', editingDeckId: deckId }),
  startMatch: (cfg) => set({ matchConfig: cfg, screen: 'match' }),
  finishMatch: (result) => set({ lastOutcome: result, screen: 'results' }),
  showToast: (text) => {
    const id = toastId++;
    set({ toast: { id, text } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 2600);
  }
}));

export { metaStore };
