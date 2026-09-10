import type { MetaState, PersistenceAdapter } from './types';

const KEY = 'nexo-tcg:meta:v1';

/** Browser localStorage adapter (default for the prototype). */
export class LocalStorageAdapter implements PersistenceAdapter {
  private ok = typeof localStorage !== 'undefined';

  load(): MetaState | null {
    if (!this.ok) return null;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw) as MetaState;
    } catch {
      return null;
    }
  }

  save(state: MetaState): void {
    if (!this.ok) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // storage full/unavailable — game still playable in-memory
    }
  }

  clear(): void {
    if (!this.ok) return;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
  }
}
