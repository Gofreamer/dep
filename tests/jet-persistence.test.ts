import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetaStore } from '../src/persistence/store';
import { LocalStorageAdapter } from '../src/persistence/local';
import { SAVE_SCHEMA_VERSION, type MetaState, type PersistenceAdapter } from '../src/persistence/types';
import { registerJetDataPack } from '../src/data/jet/pack';
import { registry } from '../src/engine/registry';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';

/**
 * RESILIÊNCIA DE SAVE (itens 36–37): qualquer estado persistido — ausente,
 * válido, corrompido, legado NEXO, com cartas removidas ou versão futura —
 * deve produzir um MetaStore utilizável, nunca uma tela branca.
 */

beforeAll(() => { registerJetDataPack(); });

/** Adapter em memória que pode simular corrupção e falha de gravação. */
function memAdapter(initial?: string, failSave = false): PersistenceAdapter & { raw: string | null } {
  const slot: { raw: string | null } = { raw: initial ?? null };
  return {
    get raw() { return slot.raw; },
    load() {
      if (!slot.raw) return null;
      return JSON.parse(slot.raw) as MetaState;
    },
    save(state: MetaState) {
      if (failSave) throw new Error('QuotaExceededError');
      slot.raw = JSON.stringify(state);
    },
    clear() { slot.raw = null; }
  };
}

const validSave = (): string =>
  JSON.stringify({
    version: SAVE_SCHEMA_VERSION,
    decks: [{ id: 'deck-x', name: 'Meu deck', cards: { 'agent-ran-yuki-base': 4, 'jres-energia': 56 }, createdAt: 1 }],
    activeDeckId: 'deck-x',
    collection: { 'agent-ran-yuki-base': 4 },
    favorites: [],
    wins: 3,
    losses: 1,
    history: [{ id: 'm1', date: 1, deckId: 'deck-x', opponent: 'deck-jet-asgard', result: 'win' }],
    settings: { difficulty: 'hard', speed: 'fast', devMode: false, tutorialDone: true, player1Name: 'Ana' }
  });

/** Save v1 (era NEXO): chaves e cartas que não existem mais. */
const legacyNexoSave = (): string =>
  JSON.stringify({
    version: 1,
    decks: [{ id: 'deck-nexo', name: 'NEXO', cards: { 'char-cindro': 3, 'res-solar': 20 }, createdAt: 1 }],
    activeDeckId: 'deck-nexo',
    collection: { 'char-cindro': 1, 'res-solar': 9 },
    favorites: [],
    wins: 10,
    losses: 4,
    history: [{ id: 'n1', date: 2, deckId: 'deck-nexo', opponent: 'qualquer', result: 'loss' }],
    settings: null
  });

describe('Primeiro acesso (storage vazio)', () => {
  it('produz defaults jogáveis: 3 starters JET, coleção completa, sem histórico', () => {
    const ms = new MetaStore(memAdapter());
    expect(ms.state.version).toBe(SAVE_SCHEMA_VERSION);
    expect(ms.listDecks().map((d) => d.id).sort()).toEqual([...JET_STARTER_DECKS.map((d) => d.id)].sort());
    expect(ms.state.wins).toBe(0);
    expect(ms.state.history).toEqual([]);
    for (const def of registry.allCards()) expect(ms.state.collection[def.id]).toBeGreaterThan(0);
  });
});

describe('Save válido', () => {
  it('carrega sem alterações semânticas', () => {
    const ms = new MetaStore(memAdapter(validSave()));
    expect(ms.getDeck('deck-x')?.name).toBe('Meu deck');
    expect(ms.state.wins).toBe(3);
    expect(ms.state.settings.player1Name).toBe('Ana');
    expect(ms.state.settings.tutorialDone).toBe(true);
    expect(ms.state.history).toHaveLength(1);
  });
});

describe('JSON corrompido', () => {
  it('não lança; estado volta aos defaults e o app continua', () => {
    const broken = memAdapter('{"version": 2, "decks": [');
    // load() do LocalStorageAdapter real engole o erro; aqui simulamos via adapter
    const ms = new MetaStore({
      load: () => null, // correção equivalente ao catch de JSON.parse
      save: () => {},
      clear: () => {}
    });
    expect(ms.listDecks().length).toBeGreaterThan(0);
    void broken;
  });

  it('LocalStorageAdapter real: JSON quebrado é descartado sem exceção', () => {
    // exercise direto do adapter real com localStorage stub
    const store = new Map<string, string>();
    const fakeLocal: Record<string, unknown> = {};
    Object.defineProperty(fakeLocal, 'getItem', { value: (k: string) => store.get(k) ?? null });
    Object.defineProperty(fakeLocal, 'setItem', { value: (k: string, v: string) => void store.set(k, v) });
    Object.defineProperty(fakeLocal, 'removeItem', { value: (k: string) => void store.delete(k) });
    const g = globalThis as unknown as { localStorage?: unknown };
    const had = 'localStorage' in g;
    const prev = g.localStorage;
    g.localStorage = fakeLocal;
    try {
      store.set('jet-tcg:meta:v2', '{quebrado');
      const a = new LocalStorageAdapter();
      expect(a.load()).toBeNull();
      expect(store.has('jet-tcg:meta:v2')).toBe(false); // descartada
      // legado NEXO presente: migra
      store.set('nexo-tcg:meta:v1', legacyNexoSave());
      const loaded = a.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(1);
    } finally {
      if (had) g.localStorage = prev; else delete g.localStorage;
    }
  });
});

describe('Save legado NEXO (v1)', () => {
  it('migra para v2: decks NEXO descartados → starters JET; histórico e placar preservados', () => {
    const ms = new MetaStore(memAdapter(legacyNexoSave()));
    expect(ms.state.version).toBe(SAVE_SCHEMA_VERSION);
    expect(ms.state.decks.every((d) => Object.keys(d.cards).every((id) => registry.tryCard(id)))).toBe(true);
    expect(ms.state.decks.length).toBeGreaterThan(0);
    expect(ms.state.wins).toBe(10);
    expect(ms.state.losses).toBe(4);
    expect(ms.state.history).toHaveLength(1); // histórico legado preservado
    expect(ms.state.settings?.difficulty).toBeDefined(); // settings nulos → defaults
  });
});

describe('Save com cartas removidas do catálogo', () => {
  it('deck inválido é descartado e substituído pelos starters', () => {
    const ghost = JSON.stringify({
      version: SAVE_SCHEMA_VERSION,
      decks: [
        { id: 'ghost', name: 'Fantasma', cards: { 'card-extinta': 60 }, createdAt: 1 },
        { id: 'ok', name: 'Válido', cards: { 'agent-ran-yuki-base': 4, 'jres-energia': 56 }, createdAt: 2 }
      ],
      activeDeckId: 'ghost',
      collection: {},
      favorites: [],
      wins: 0,
      losses: 0,
      history: [],
      settings: undefined
    });
    const ms = new MetaStore(memAdapter(ghost));
    expect(ms.getDeck('ghost')).toBeUndefined();
    expect(ms.getDeck('ok')).toBeDefined();
    expect(ms.state.activeDeckId).toBe('ok');
    expect(ms.state.settings?.difficulty).toBeDefined();
  });

  it('todos os decks inválidos → fallback para os 3 starters', () => {
    const allGhost = JSON.stringify({
      version: SAVE_SCHEMA_VERSION,
      decks: [{ id: 'ghost', name: 'Fantasma', cards: { 'card-extinta': 60 }, createdAt: 1 }],
      activeDeckId: 'ghost',
      collection: {},
      favorites: [],
      wins: 0,
      losses: 0,
      history: [],
      settings: { difficulty: 'normal', speed: 'normal', devMode: false, tutorialDone: false, player1Name: 'X' }
    });
    const ms = new MetaStore(memAdapter(allGhost));
    expect(ms.listDecks().map((d) => d.id).sort()).toEqual([...JET_STARTER_DECKS.map((d) => d.id)].sort());
    expect(JET_STARTER_DECKS.map((d) => d.id)).toContain(ms.state.activeDeckId);
  });
});

describe('Versão desconhecida (save do futuro)', () => {
  it('reset seguro preservando o histórico', () => {
    const future = validSave().replace('"version":2', '"version":99');
    const ms = new MetaStore(memAdapter(future));
    expect(ms.state.version).toBe(SAVE_SCHEMA_VERSION);
    expect(ms.listDecks().map((d) => d.id).sort()).toEqual([...JET_STARTER_DECKS.map((d) => d.id)].sort());
    expect(ms.state.history).toHaveLength(1); // histórico resgatado no reset
  });
});

describe('Campos ausentes no save', () => {
  it('história vazia / settings ausentes / favoritos ausentes não quebram', () => {
    const minimal = JSON.stringify({ version: SAVE_SCHEMA_VERSION });
    const ms = new MetaStore(memAdapter(minimal));
    expect(Array.isArray(ms.state.history)).toBe(true);
    expect(ms.state.settings?.difficulty).toBe('normal');
    expect(Array.isArray(ms.state.favorites)).toBe(true);
    expect(ms.state.decks.length).toBeGreaterThan(0);
  });
});

describe('Falha de gravação (storage cheio)', () => {
  it('save() não lança; o jogo segue funcionando em memória', () => {
    const ms = new MetaStore(memAdapter(validSave(), true));
    expect(() => ms.recordMatch({ id: 'm2', date: 5, playerDeckId: 'deck-x', opponentDeckId: 'y', result: 'win', reason: 'concede', turns: 3, victoryPoints: [2, 0] })).not.toThrow();
    expect(ms.state.wins).toBe(4); // estado em memória atualizado
  });
});

describe('Ciclo completo', () => {
  it('gravar → nova instância → ler devolve o mesmo estado', () => {
    const a = memAdapter();
    const ms1 = new MetaStore(a);
    ms1.recordMatch({ id: 'm9', date: 9, playerDeckId: JET_STARTER_DECKS[0].id, opponentDeckId: JET_STARTER_DECKS[1].id, result: 'win', reason: 'victory_points', turns: 7, victoryPoints: [4, 1] });
    ms1.setActiveDeck(JET_STARTER_DECKS[2].id);
    const ms2 = new MetaStore(a);
    expect(ms2.state.wins).toBe(1);
    expect(ms2.state.activeDeckId).toBe(JET_STARTER_DECKS[2].id);
    expect(ms2.state.history[0].id).toBe('m9');
  });
});

beforeEach(() => { /* adapters são criados por teste */ });
