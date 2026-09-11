import type { MatchRecord, MetaState, PersistenceAdapter, SavedDeck } from './types';
import { LocalStorageAdapter } from './local';
import { JET_STARTER_DECKS } from '../data/jet/starterDecks';
import { SAVE_SCHEMA_VERSION } from './types';
import { registerJetDataPack } from '../data/jet/pack';
import { registry } from '../engine/registry';

/** Catálogo ativo para coleção: registra o pack JET (idempotente) e lista tudo. */
function activeCatalog() {
  registerJetDataPack();
  return registry.allCards();
}

/** Meta progression: decks, collection, stats, settings. */
export class MetaStore {
  private adapter: PersistenceAdapter;
  state: MetaState;

  constructor(adapter: PersistenceAdapter = new LocalStorageAdapter()) {
    this.adapter = adapter;
    this.state = this.adapter.load() ?? this.defaults();
    this.migrate();
  }

  private defaults(): MetaState {
    const decks: SavedDeck[] = JET_STARTER_DECKS.map((d, i) => ({
      id: d.id,
      name: d.name,
      cards: { ...d.cards },
      createdAt: Date.now() + i
    }));
    const collection: Record<string, number> = {};
    for (const def of activeCatalog()) collection[def.id] = 99;
    return {
      version: SAVE_SCHEMA_VERSION,
      decks,
      activeDeckId: decks[0]?.id ?? '',
      collection,
      favorites: [],
      wins: 0,
      losses: 0,
      history: [],
      settings: { difficulty: 'normal', speed: 'normal', devMode: import.meta.env.DEV, tutorialDone: false, player1Name: 'Você', soundEnabled: true }
    };
  }

  private migrate(): void {
    // Pipeline de migração: v1 (era NEXO) → v2 (JET standalone).
    if (this.state.version === 1) {
      // v1→v2: decks/coleção são revalidados contra o catálogo ativo abaixo;
      // histórico e estatísticas são preservados; nada mais muda de formato.
      this.state.version = 2;
    }
    if (this.state.version !== SAVE_SCHEMA_VERSION) {
      // Save de versão desconhecida (mais nova/antiga demais): reset seguro.
      const history = Array.isArray(this.state.history) ? this.state.history : [];
      this.state = this.defaults();
      this.state.history = history.slice(0, 100);
    }
    if (!this.state.settings) this.state.settings = this.defaults().settings;
    // Campo opcional da v1: saves antigos recebem o padrão sem invalidar nada.
    if (typeof this.state.settings.soundEnabled !== 'boolean') this.state.settings.soundEnabled = true;
    if (!Array.isArray(this.state.favorites)) this.state.favorites = [];
    if (!Array.isArray(this.state.history)) this.state.history = [];
    if (typeof this.state.wins !== 'number') this.state.wins = 0;
    if (typeof this.state.losses !== 'number') this.state.losses = 0;
    if (!Array.isArray(this.state.decks)) this.state.decks = this.defaults().decks;
    if (!this.state.collection) this.state.collection = {};
    for (const def of activeCatalog()) if (!this.state.collection[def.id]) this.state.collection[def.id] = 99;
    // Baralhos salvos com cartas fora do catálogo ativo (ex.: fixture NEXO do
    // prototype anterior) não são jogáveis — descartados; fallback: starters JET.
    const known = (id: string) => registry.tryCard(id) !== undefined;
    this.state.decks = this.state.decks.filter((d) => Object.keys(d.cards).every(known));
    if (this.state.decks.length === 0) {
      this.state.decks = this.defaults().decks;
    }
    if (!this.state.decks.some((d) => d.id === this.state.activeDeckId)) {
      this.state.activeDeckId = this.state.decks[0]?.id ?? '';
    }
    this.save();
  }

  save(): void {
    // Falha de persistência (storage cheio/indisponível) NUNCA derruba o jogo:
    // o estado continua válido em memória.
    try {
      this.adapter.save(this.state);
    } catch {
      // noop — gravação é best-effort
    }
  }

  // decks ----------------------------------------------------------------—

  listDecks(): SavedDeck[] {
    return this.state.decks;
  }

  getDeck(id: string): SavedDeck | undefined {
    return this.state.decks.find((d) => d.id === id);
  }

  createDeck(name: string, cards: Record<string, number> = {}): SavedDeck {
    const deck: SavedDeck = { id: `deck-${Date.now()}-${Math.floor(Math.random() * 9999)}`, name, cards, createdAt: Date.now() };
    this.state.decks.push(deck);
    this.save();
    return deck;
  }

  updateDeck(id: string, patch: Partial<Pick<SavedDeck, 'name' | 'cards'>>): void {
    const deck = this.getDeck(id);
    if (!deck) return;
    Object.assign(deck, patch);
    this.save();
  }

  copyDeck(id: string): SavedDeck | undefined {
    const src = this.getDeck(id);
    if (!src) return undefined;
    return this.createDeck(`${src.name} (cópia)`, { ...src.cards });
  }

  deleteDeck(id: string): void {
    this.state.decks = this.state.decks.filter((d) => d.id !== id);
    if (this.state.activeDeckId === id) this.state.activeDeckId = this.state.decks[0]?.id ?? '';
    this.save();
  }

  setActiveDeck(id: string): void {
    this.state.activeDeckId = id;
    this.save();
  }

  // stats -------------------------------------------------------------------

  recordMatch(rec: MatchRecord): void {
    this.state.history.unshift(rec);
    this.state.history = this.state.history.slice(0, 100);
    if (rec.result === 'win') this.state.wins++;
    else this.state.losses++;
    this.save();
  }

  resetAll(): void {
    this.state = this.defaults();
    this.save();
  }
}

// shared singleton (browser storage by default)
export const metaStore = new MetaStore();
