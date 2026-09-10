/**
 * Persistence contract. The game talks only to this interface, so browser
 * storage can later be swapped for Firebase / Firestore / REST / etc.
 * without touching gameplay or UI logic.
 */
export interface SavedDeck {
  id: string;
  name: string;
  cards: Record<string, number>;
  createdAt: number;
}

export interface MatchRecord {
  id: string;
  date: number;
  playerDeckId: string;
  opponentDeckId: string;
  result: 'win' | 'loss';
  reason: string;
  turns: number;
  victoryPoints: [number, number];
}

export interface Settings {
  difficulty: 'easy' | 'normal' | 'hard';
  speed: 'slow' | 'normal' | 'fast';
  devMode: boolean;
  tutorialDone: boolean;
  player1Name: string;
}

export interface MetaState {
  version: number;
  decks: SavedDeck[];
  activeDeckId: string;
  collection: Record<string, number>;
  favorites: string[];
  wins: number;
  losses: number;
  history: MatchRecord[];
  settings: Settings;
}

export interface PersistenceAdapter {
  load(): MetaState | null;
  save(state: MetaState): void;
  clear(): void;
}
