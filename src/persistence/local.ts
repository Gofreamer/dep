import type { MetaState, PersistenceAdapter } from './types';

// Chaves históricas: 'nexo-tcg:meta:v1' (era NEXO) → 'jet-tcg:meta:v2' (atual).
// A leitura migra de chaves antigas; gravação usa SEMPRE a chave atual.
const KEY = 'jet-tcg:meta:v2';
const LEGACY_KEYS = ['nexo-tcg:meta:v1'];

/** Browser localStorage adapter com fallback seguro (save corrompido → null). */
export class LocalStorageAdapter implements PersistenceAdapter {
  private ok = typeof localStorage !== 'undefined';

  load(): MetaState | null {
    if (!this.ok) return null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as MetaState;
    } catch {
      // JSON corrompido na chave atual: descarta e tenta legado
      try { localStorage.removeItem(KEY); } catch { /* noop */ }
    }
    for (const legacy of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(legacy);
        if (raw) return JSON.parse(raw) as MetaState;
      } catch {
        try { localStorage.removeItem(legacy); } catch { /* noop */ }
      }
    }
    return null;
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
      for (const legacy of LEGACY_KEYS) localStorage.removeItem(legacy);
    } catch {
      /* noop */
    }
  }
}
