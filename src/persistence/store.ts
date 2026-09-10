import type { MatchRecord, MetaState, PersistenceAdapter, SavedDeck } from './types';
import { LocalStorageAdapter } from './local';
import { STARTER_DECKS } from '../data/fixtures/nexo/decks';
import { ALL_CARDS } from '../data/fixtures/nexo/cards';

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
    const decks: SavedDeck[] = STARTER_DECKS.map((d, i) => ({
      id: d.id,
      name: d.name,
      cards: { ...d.cards },
      createdAt: Date.now() + i
    }));
    const collection: Record<string, number> = {};
    for (const def of ALL_CARDS) collection[def.id] = 99;
    return {
      version: 1,
      decks,
      activeDeckId: decks[0]?.id ?? '',
      collection,
      favorites: [],
      wins: 0,
      losses: 0,
      history: [],
      settings: { difficulty: 'normal', speed: 'normal', devMode: import.meta.env.DEV, tutorialDone: false, player1Name: 'Você' }
    };
  }

  private migrate(): void {
    // Future schema migrations live here.
    if (!this.state.settings) this.state.settings = this.defaults().settings;
    if (!this.state.collection) this.state.collection = {};
    for (const def of ALL_CARDS) if (!this.state.collection[def.id]) this.state.collection[def.id] = 99;
    this.save();
  }

  save(): void {
    this.adapter.save(this.state);
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
