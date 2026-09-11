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
  /**
   * Efeitos sonoros. Campo OPCIONAL adicionado na v1: saves antigos (v2) sem
   * este campo recebem `true` na migração — não é mudança incompatível, então
   * `SAVE_SCHEMA_VERSION` não sobe e nenhum deck do usuário é descartado.
   */
  soundEnabled?: boolean;
}

/** Versão atual do schema de save — aumente em qualquer mudança incompatível. */
export const SAVE_SCHEMA_VERSION = 2;

/**
 * MetaState persistido (LocalStorageAdapter). Estratégia de migração:
 *  - `version` guarda a versão do schema do save (v1 = era NEXO, v2 = JET).
 *  - migrate(): roda em TODO load; cada passo v(n)→v(n+1) é uma função pura.
 *  - saves inválidos/corrompidos → adapter retorna null → defaults seguros.
 *  - cartas fora do catálogo ativo → decks com tais cartas são descartados
 *    com fallback para os starters JET (ver MetaStore.migrate).
 */
export interface MetaState {
  /** schemaVersion do save (ver SAVE_SCHEMA_VERSION). */
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
