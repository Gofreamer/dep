import { beforeAll, describe, expect, it } from 'vitest';
import artSnapshotRaw from '../src/data/jet/artSnapshot.ts?raw';
import { registerJetDataPack } from '../src/data/jet/pack';
import { JET_SNAPSHOT } from '../src/data/jet/snapshot';
import { JET_ART_SNAPSHOT } from '../src/data/jet/artSnapshot';
import {
  artSnapshotProvenance,
  hasRemoteArt,
  preloadCardArt,
  remoteArtUrl,
  resolveCardArt
} from '../src/data/jet/art';
import {
  ART_EDITION_ALIASES,
  artUrlOrigin,
  basePhotoOf,
  buildArtSnapshot,
  canonicalizeArtEdition,
  createArtIndex,
  isArtUrlAllowed,
  isKnownArtEdition,
  normalizeAgentName,
  resolveArtWithIndex,
  type TcgAgentRef
} from '../src/integrations/jet/cardArt';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { aiNextCommand } from '../src/engine/ai/ai';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { expandDeck } from '../src/data/deckUtils';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';
import { MetaStore } from '../src/persistence/store';
import type { MetaState, PersistenceAdapter } from '../src/persistence/types';

/**
 * ARTES OFICIAIS (Jet Cards → JET TCG) — pipeline, matching, resolução,
 * segurança de URL e garantias de standalone.
 *
 * Cobre os 17 itens exigidos: matching BASE/edição, prioridade
 * specialImageUrl, fallbacks edição→BASE→procedural, Imgur/GitHub/Pages,
 * protocolos rejeitados, acentos, URL encoding, equipe legada, ambiguidade,
 * determinismo, gameplay intacto, arte fora de saves e de MatchState.
 */

beforeAll(() => { registerJetDataPack(); });

const TCG_AGENTS = (): TcgAgentRef[] =>
  JET_SNAPSHOT.agents.map((a) => ({ agentId: a.agentId, name: a.name, team: a.team }));

const PLAYABLE_SPECIALS = (): { identityId: string; edition: string }[] =>
  JET_SNAPSHOT.editionVariants.map((v) => ({ identityId: v.agentId, edition: v.edition }));

const BASE_INPUT = {
  sourceCommit: 'abc123def456abc123def456abc123def456abcd',
  capturedAt: '2026-09-11'
};

function memAdapter(): PersistenceAdapter & { raw: string | null } {
  const slot: { raw: string | null } = { raw: null };
  return {
    get raw() { return slot.raw; },
    load() {
      if (!slot.raw) return null;
      return JSON.parse(slot.raw) as MetaState;
    },
    save(state: MetaState) { slot.raw = JSON.stringify(state); },
    clear() { slot.raw = null; }
  };
}

// ---------------------------------------------------------------------------
// 1. matching de agente BASE
// ---------------------------------------------------------------------------

describe('matching de agente BASE', () => {
  it('casa nome exato da fonte com a identidade canônica', () => {
    const { snapshot, report } = buildArtSnapshot({
      ...BASE_INPUT,
      tcgAgents: TCG_AGENTS(),
      players: {
        'KOF 12_Jenny': { name: 'Jenny', team: 'KOF 12', photo: 'https://example.com/jenny.png' }
      },
      specials: {}
    });
    expect(report.baseRecognized).toBe(1);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      identityId: 'agent-jenny',
      name: 'Jenny',
      edition: 'BASE',
      url: 'https://example.com/jenny.png',
      source: 'jet-cards',
      sourceType: 'base'
    });
  });

  it('foto BASE usa a prioridade photo → photoUrl → image (photos.js)', () => {
    expect(basePhotoOf({ photo: 'https://a/p.png', photoUrl: 'https://a/u.png', image: 'https://a/i.png' })).toBe('https://a/p.png');
    expect(basePhotoOf({ photoUrl: 'https://a/u.png', image: 'https://a/i.png' })).toBe('https://a/u.png');
    expect(basePhotoOf({ image: 'https://a/i.png' })).toBe('https://a/i.png');
    expect(basePhotoOf({})).toBe('');
    expect(basePhotoOf(null)).toBe('');
    // Sem DiceBear no TCG: valor não-HTTP vira ausência (fallback procedural).
    expect(basePhotoOf({ photo: 'nota-url' })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. matching de edição
// ---------------------------------------------------------------------------

describe('matching de edição', () => {
  it('casa playerName + edition com identityId + edition do TCG', () => {
    const { snapshot, report } = buildArtSnapshot({
      ...BASE_INPUT,
      tcgAgents: TCG_AGENTS(),
      players: {},
      specials: {
        ed1: { playerName: 'Jenny', playerKey: 'KOF 12_Jenny', edition: 'MVP', team: 'KOF 12', specialImageUrl: 'https://example.com/jenny-mvp.png' }
      }
    });
    expect(report.specialsRecognized).toBe(1);
    expect(snapshot.entries[0]).toMatchObject({ identityId: 'agent-jenny', edition: 'MVP', sourceType: 'special' });
  });

  it('mapeamento de edição é explícito e documentado (aliases históricos)', () => {
    expect(ART_EDITION_ALIASES.CHAMPIONS).toBe('CHAMPION');
    expect(canonicalizeArtEdition('CHAMPIONS')).toBe('CHAMPION');
    expect(canonicalizeArtEdition('final')).toBe('FINALS');
    expect(canonicalizeArtEdition('mvp')).toBe('MVP');
    expect(canonicalizeArtEdition('icone')).toBe('ICON');
    expect(canonicalizeArtEdition('BASE')).toBe('BASE');
    expect(canonicalizeArtEdition('')).toBeNull();
    expect(canonicalizeArtEdition(undefined)).toBeNull();
    expect(isKnownArtEdition('CHAMPION')).toBe(true);
    expect(isKnownArtEdition('TOTY')).toBe(false);
  });

  it('edição futura desconhecida é aceita com warning (nunca descartada em silêncio)', () => {
    const { snapshot, report } = buildArtSnapshot({
      ...BASE_INPUT,
      tcgAgents: TCG_AGENTS(),
      players: {},
      specials: {
        ed1: { playerName: 'Saki', edition: 'TOTY', team: 'Morning Star', specialImageUrl: 'https://example.com/saki-toty.png' }
      }
    });
    expect(snapshot.entries[0]).toMatchObject({ identityId: 'agent-saki', edition: 'TOTY' });
    expect(report.warnings.some((w) => w.code === 'unknown-edition')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3/4/5. prioridade specialImageUrl + fallbacks
// ---------------------------------------------------------------------------

describe('prioridade e fallbacks do resolver', () => {
  it('3. specialImageUrl tem prioridade sobre a foto BASE', () => {
    const index = createArtIndex(JET_ART_SNAPSHOT.entries);
    const resolved = resolveArtWithIndex(index, 'agent-jenny', 'MVP');
    expect(resolved).toMatchObject({ kind: 'remote', sourceType: 'special' });
    if (resolved.kind !== 'remote') throw new Error('esperava remote');
    expect(resolved.url).toContain('jinx.jpg');
    const base = resolveArtWithIndex(index, 'agent-jenny', 'BASE');
    expect(base).toMatchObject({ kind: 'remote', sourceType: 'base' });
    if (base.kind !== 'remote') throw new Error('esperava remote');
    expect(base.url).toContain('Jenny.jpg');
    expect(resolved.url).not.toBe(base.url);
  });

  it('4. edição sem arte própria cai para a BASE da mesma identidade (só visual)', () => {
    const index = createArtIndex([
      {
        identityId: 'agent-jenny', name: 'Jenny', edition: 'BASE', url: 'https://example.com/jenny.png',
        source: 'jet-cards', sourceType: 'base',
        provenance: { repository: 'Gofreamer/cartinhas23', sourceCommit: 'x' }
      }
    ]);
    const resolved = resolveArtWithIndex(index, 'agent-jenny', 'MVP');
    // Fallback é visual: informa a edição pedida, serve a URL BASE.
    expect(resolved).toEqual({ kind: 'remote', url: 'https://example.com/jenny.png', sourceType: 'base', identityId: 'agent-jenny', edition: 'MVP' });
  });

  it('5. sem BASE cai para o fallback procedural', () => {
    const index = createArtIndex([]);
    expect(resolveArtWithIndex(index, 'agent-jenny', 'BASE')).toMatchObject({ kind: 'procedural' });
    expect(resolveArtWithIndex(index, undefined, 'BASE')).toMatchObject({ kind: 'procedural' });
    expect(resolveCardArt(null)).toMatchObject({ kind: 'procedural' });
    expect(resolveCardArt({})).toMatchObject({ kind: 'procedural' });
    // Cartas auxiliares (sem identidade) nunca têm arte remota.
    for (const id of ['jres-energia', 'jact-leitura', 'jeq-manopla', 'jfd-arena']) {
      expect(resolveCardArt(registry.card(id)).kind).toBe('procedural');
      expect(hasRemoteArt(registry.card(id))).toBe(false);
      expect(remoteArtUrl(registry.card(id))).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 6/7/8. origens (tratadas como "URL de arte", sem ramificar por provedor)
// ---------------------------------------------------------------------------

describe('origens públicas', () => {
  it('6. URL Imgur resolve', () => {
    const resolved = resolveCardArt(registry.card('agent-alice-westland-base'));
    expect(resolved.kind).toBe('remote');
    if (resolved.kind !== 'remote') throw new Error('esperava remote');
    expect(artUrlOrigin(resolved.url)).toBe('imgur');
    expect(isArtUrlAllowed('https://i.imgur.com/dKI5jpm.png')).toBe(true);
  });

  it('7. URL GitHub (blob ?raw=true mantida como publicada) resolve', () => {
    const resolved = resolveCardArt(registry.card('agent-jenny-base'));
    expect(resolved.kind).toBe('remote');
    if (resolved.kind !== 'remote') throw new Error('esperava remote');
    expect(artUrlOrigin(resolved.url)).toBe('github');
    expect(resolved.url).toContain('/blob/');
    expect(resolved.url).toContain('?raw=true');
  });

  it('8. URL GitHub Pages resolve', () => {
    const resolved = resolveCardArt(registry.card('agent-henry-base'));
    expect(resolved.kind).toBe('remote');
    if (resolved.kind !== 'remote') throw new Error('esperava remote');
    expect(artUrlOrigin(resolved.url)).toBe('github-pages');
  });

  it('classificação de origem não afeta a resolução', () => {
    expect(artUrlOrigin('https://raw.githubusercontent.com/a/b.png')).toBe('github');
    expect(artUrlOrigin('https://i.imgur.com/a.png')).toBe('imgur');
    expect(artUrlOrigin('https://user.github.io/a.png')).toBe('github-pages');
    expect(artUrlOrigin('https://cdn.example.com/a.png')).toBe('other');
    expect(artUrlOrigin('lixo')).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// 9. protocolos rejeitados
// ---------------------------------------------------------------------------

describe('segurança das URLs', () => {
  it('9. só https em produção; javascript:/data:/file: sempre rejeitados', () => {
    expect(isArtUrlAllowed('https://example.com/a.png')).toBe(true);
    expect(isArtUrlAllowed('http://example.com/a.png')).toBe(false);
    expect(isArtUrlAllowed('http://example.com/a.png', { allowHttp: true })).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      'ftp://example.com/a.png',
      '',
      '   ',
      'nota-url',
      '/relative/path.png',
      null,
      undefined,
      123
    ]) {
      expect(isArtUrlAllowed(bad, { allowHttp: true }), String(bad)).toBe(false);
    }
  });

  it('URLs inválidas entram no relatório e não geram entrada', () => {
    const { snapshot, report } = buildArtSnapshot({
      ...BASE_INPUT,
      tcgAgents: TCG_AGENTS(),
      playableSpecials: PLAYABLE_SPECIALS(),
      players: {
        'KOF 12_Jenny': { name: 'Jenny', team: 'KOF 12', photo: 'javascript:alert(1)' }
      },
      specials: {
        ed1: { playerName: 'Jenny', edition: 'MVP', team: 'KOF 12', specialImageUrl: 'data:image/png;base64,AAA' }
      }
    });
    expect(snapshot.entries).toHaveLength(0);
    expect(report.invalidUrls).toHaveLength(2);
    expect(report.tcgAgentsWithoutBaseArt).toContain('agent-jenny');
    expect(report.tcgEditionsWithoutSpecialArt).toContainEqual({ identityId: 'agent-jenny', name: 'Jenny', edition: 'MVP' });
  });

  it('resolver revalida URLs do snapshot (defesa em profundidade)', () => {
    const mk = (edition: string, url: string, sourceType: 'base' | 'special') => ({
      identityId: 'agent-jenny', name: 'Jenny', edition, url, source: 'jet-cards' as const, sourceType,
      provenance: { repository: 'Gofreamer/cartinhas23' as const, sourceCommit: 'x' }
    });
    // Especial com URL inválida → cai para a BASE válida.
    const index = createArtIndex([mk('MVP', 'javascript:alert(1)', 'special'), mk('BASE', 'https://example.com/j.png', 'base')]);
    expect(resolveArtWithIndex(index, 'agent-jenny', 'MVP')).toEqual({
      kind: 'remote', url: 'https://example.com/j.png', sourceType: 'base', identityId: 'agent-jenny', edition: 'MVP'
    });
    // Tudo inválido → procedural (nunca uma URL perigosa no <img>).
    const bad = createArtIndex([mk('BASE', 'data:image/png;base64,AAA', 'base')]);
    expect(resolveArtWithIndex(bad, 'agent-jenny', 'BASE')).toMatchObject({ kind: 'procedural' });
  });

  it('todas as URLs do snapshot real passam na política de produção', () => {
    for (const entry of JET_ART_SNAPSHOT.entries) {
      expect(isArtUrlAllowed(entry.url), entry.identityId).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 10/11. acentos + URL encoding (normalização só para comparação)
// ---------------------------------------------------------------------------

describe('normalização de nomes', () => {
  it('10. acentos/case/espaços são equivalentes na comparação', () => {
    expect(normalizeAgentName('Tayná Lannister Müller')).toBe('tayna lannister muller');
    expect(normalizeAgentName('  TAYNÁ   lannister   MÜLLER ')).toBe('tayna lannister muller');
    expect(normalizeAgentName('Tayna Lannister Muller')).toBe('tayna lannister muller');
    const { snapshot } = buildArtSnapshot({
      ...BASE_INPUT,
      tcgAgents: TCG_AGENTS(),
      players: {
        k: { name: 'Tayna Lannister Muller', team: 'Asgard', photo: 'https://example.com/t.png' }
      },
      specials: {}
    });
    expect(snapshot.entries[0].identityId).toBe('agent-tayna-lannister-muller');
    // O nome canônico exibido NUNCA muda por causa da normalização.
    expect(snapshot.entries[0].name).toBe('Tayná Lannister Müller');
  });

  it('11. URL encoding é decodificado na comparação; URLs com %20 seguem intactas', () => {
    expect(normalizeAgentName('Tayn%C3%A1%20Lannister%20M%C3%BCller')).toBe('tayna lannister muller');
    expect(normalizeAgentName('%ZZ%')).toBeTruthy(); // encoding inválido não quebra
    const resolved = resolveCardArt(registry.card('agent-ran-yuki-champion'));
    expect(resolved.kind).toBe('remote');
    if (resolved.kind !== 'remote') throw new Error('esperava remote');
    expect(resolved.url).toContain('Ran%20Yuki%20CHAMPIONS.webp?raw=true');
  });
});

// ---------------------------------------------------------------------------
// 12. equipe legada divergente
// ---------------------------------------------------------------------------

describe('equipe legada', () => {
  it('12. playerName + edition identificam a identidade; equipe divergente vira warning', () => {
    const { snapshot, report } = buildArtSnapshot({
      ...BASE_INPUT,
      tcgAgents: TCG_AGENTS(),
      players: {},
      specials: {
        // Caso real da fonte: Mik Kashnov ICON com team 'Bastard' (legado).
        ed_ICON: { playerName: 'Mik Kashnov', playerKey: 'Morning Star_Mik Kashnov', edition: 'ICON', team: 'Bastard', specialImageUrl: 'https://example.com/mik-icon.png', defId: 'ed_ICON' }
      }
    });
    expect(snapshot.entries[0]).toMatchObject({ identityId: 'agent-mik-kashnov', edition: 'ICON' });
    expect(report.warnings.filter((w) => w.code === 'legacy-team')).toHaveLength(1);
    // Nenhum segundo agente é criado: só BASE + ICON do mesmo identityId.
    const mik = JET_ART_SNAPSHOT.entries.filter((e) => e.identityId === 'agent-mik-kashnov');
    expect(mik.map((e) => e.edition).sort()).toEqual(['BASE', 'ICON']);
  });
});

// ---------------------------------------------------------------------------
// 13. ambiguidade rejeitada
// ---------------------------------------------------------------------------

describe('ambiguidade', () => {
  it('13. dois canônicos com o mesmo nome normalizado → rejeitado, sem chute', () => {
    const agents: TcgAgentRef[] = [
      { agentId: 'agent-saki', name: 'Saki', team: 'Morning Star' },
      { agentId: 'agent-saki-legado', name: 'Sakí', team: 'Antiga' }
    ];
    const { snapshot, report } = buildArtSnapshot({
      ...BASE_INPUT,
      tcgAgents: agents,
      players: { k: { name: 'Saki', team: 'Morning Star', photo: 'https://example.com/s.png' } },
      specials: { ed1: { playerName: 'Saki', edition: 'CHAMPION', team: 'Morning Star', specialImageUrl: 'https://example.com/s-c.png' } }
    });
    expect(snapshot.entries).toHaveLength(0);
    expect(report.ambiguous).toEqual([{ normalized: 'saki', candidates: ['agent-saki', 'agent-saki-legado'] }]);
    expect(report.unmatchedSpecials).toEqual(['ed1']);
  });
});

// ---------------------------------------------------------------------------
// 14. determinismo
// ---------------------------------------------------------------------------

describe('determinismo', () => {
  it('14. resolver e builder são determinísticos', () => {
    const a = resolveCardArt(registry.card('agent-ran-yuki-champion'));
    const b = resolveCardArt(registry.card('agent-ran-yuki-champion'));
    expect(a).toEqual(b);
    const mkInput = (reverse: boolean) => {
      const players = reverse
        ? { b: { name: 'Saki', team: 't', photo: 'https://e/s.png' }, a: { name: 'Jenny', team: 't', photo: 'https://e/j.png' } }
        : { a: { name: 'Jenny', team: 't', photo: 'https://e/j.png' }, b: { name: 'Saki', team: 't', photo: 'https://e/s.png' } };
      return buildArtSnapshot({ ...BASE_INPUT, tcgAgents: TCG_AGENTS(), players, specials: {} });
    };
    // Ordem das chaves de entrada não muda o resultado (iteração ordenada).
    expect(mkInput(false).snapshot.entries).toEqual(mkInput(true).snapshot.entries);
    expect(mkInput(false).snapshot).toEqual(mkInput(false).snapshot);
    // Entradas sempre ordenadas por (identityId, edition).
    const ids = JET_ART_SNAPSHOT.entries.map((e) => `${e.identityId}#${e.edition}`);
    expect([...ids].sort()).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// 15. gameplay intacto
// ---------------------------------------------------------------------------

describe('gameplay intacto', () => {
  it('15a. CardDefs de gameplay não carregam URLs de arte', () => {
    for (const def of registry.allCards()) {
      const json = JSON.stringify(def);
      expect(json.includes('http'), def.id).toBe(false);
      expect(json.includes('data:'), def.id).toBe(false);
      expect(json.includes('base64'), def.id).toBe(false);
    }
  });

  it('15b. resolver é puro: não muta a carta', () => {
    const def = registry.card('agent-jenny-mvp');
    const before = JSON.stringify(def);
    resolveCardArt(def);
    resolveCardArt(def);
    expect(JSON.stringify(def)).toBe(before);
  });

  it('15c. variantes mantêm HP/recuo/PV da BASE (composição por edição)', () => {
    for (const v of JET_SNAPSHOT.editionVariants) {
      const base = registry.card(`${v.agentId}-base`) as unknown as { maxHp: number; retreatCost: number; victoryValue: number };
      const variant = registry.card(`${v.agentId}-${v.edition.toLowerCase()}`) as unknown as { maxHp: number; retreatCost: number; victoryValue: number };
      expect(variant.maxHp, v.agentId).toBe(base.maxHp);
      expect(variant.retreatCost, v.agentId).toBe(base.retreatCost);
      expect(variant.victoryValue, v.agentId).toBe(base.victoryValue);
    }
  });
});

// ---------------------------------------------------------------------------
// 16/17. arte fora de saves e MatchState
// ---------------------------------------------------------------------------

describe('arte fora de saves e estado', () => {
  it('16. arte nunca entra no save', () => {
    const adapter = memAdapter();
    const store = new MetaStore(adapter);
    store.save();
    expect(adapter.raw).toBeTruthy();
    expect(adapter.raw!.includes('http')).toBe(false);
    expect(adapter.raw!.includes('data:image')).toBe(false);
    expect(adapter.raw!.includes('base64')).toBe(false);
    // Decks salvos referenciam só cardId → contagem.
    for (const deck of store.state.decks) {
      expect(JSON.stringify(deck.cards).includes('http')).toBe(false);
    }
  });

  it('17. arte nunca entra em MatchState como blob/base64/URL', () => {
    const deckOf = (id: string) =>
      expandDeck(JET_STARTER_DECKS.find((d) => d.id === id)!).map((cardId) => registry.card(cardId));
    const engine = new MatchEngine({
      seed: 7,
      config: DEFAULT_CONFIG,
      players: [
        { name: 'P1', deckId: 'a', isAI: true, aiLevel: 'normal', deck: deckOf('deck-jet-kof-12') },
        { name: 'P2', deckId: 'b', isAI: true, aiLevel: 'normal', deck: deckOf('deck-jet-asgard') }
      ]
    });
    // Setup + alguns turnos reais com a IA.
    for (const p of [0, 1] as const) {
      let guard = 0;
      while (!engine.state.players[p].setupDone && guard++ < 30) {
        expect(engine.dispatch(aiNextCommand(engine, p)).ok).toBe(true);
      }
    }
    for (let i = 0; i < 40 && engine.state.phase !== 'gameOver'; i++) {
      const cmd = aiNextCommand(engine, engine.state.activePlayer);
      const r = engine.dispatch(cmd);
      if (!r.ok) break;
    }
    const json = JSON.stringify(engine.state);
    expect(json.includes('http')).toBe(false);
    expect(json.includes('data:image')).toBe(false);
    expect(json.includes('base64')).toBe(false);
    // Instâncias de carta não têm campo de arte/blob.
    const inst = engine.state.players[0].hand[0] ?? engine.state.players[0].deck[0];
    expect(inst).toBeTruthy();
    for (const key of Object.keys(inst)) {
      expect(['url', 'art', 'image', 'blob', 'base64', 'photo'].includes(key)).toBe(false);
    }
  });

  it('preload é best-effort e nunca quebra (sem Image no node)', () => {
    expect(() => preloadCardArt([registry.card('agent-jenny-base'), registry.card('jres-energia')])).not.toThrow();
    expect(() => preloadCardArt([])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Snapshot real: auditoria versionada
// ---------------------------------------------------------------------------

describe('snapshot real de arte (Gofreamer/cartinhas23)', () => {
  it('proveniência registra repositório + SHA da fonte', () => {
    const prov = artSnapshotProvenance();
    expect(prov.sourceRepository).toBe('Gofreamer/cartinhas23');
    expect(prov.sourceFile).toBe('seed-cards-import.json');
    expect(prov.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(prov.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JET_ART_SNAPSHOT.version).toBe(1);
  });

  it('18 BASE + 10 especiais, 28 URLs distintas', () => {
    const base = JET_ART_SNAPSHOT.entries.filter((e) => e.sourceType === 'base');
    const special = JET_ART_SNAPSHOT.entries.filter((e) => e.sourceType === 'special');
    expect(base).toHaveLength(18);
    expect(special).toHaveLength(10);
    expect(new Set(JET_ART_SNAPSHOT.entries.map((e) => e.url)).size).toBe(28);
    // Toda entrada BASE tem playerKey; toda especial tem defId.
    for (const e of base) expect(e.provenance.playerKey).toBeTruthy();
    for (const e of special) expect(e.provenance.defId).toBeTruthy();
  });

  it('origens do snapshot: GitHub 20, Pages 6, Imgur 2, outras 0', () => {
    const count: Record<string, number> = { github: 0, 'github-pages': 0, imgur: 0, other: 0 };
    for (const e of JET_ART_SNAPSHOT.entries) count[artUrlOrigin(e.url)] += 1;
    expect(count).toEqual({ github: 20, 'github-pages': 6, imgur: 2, other: 0 });
  });

  it('as 10 variantes jogáveis têm arte especial própria', () => {
    const expected: [string, string][] = [
      ['agent-jenny', 'MVP'],
      ['agent-wei-wang', 'MVP'],
      ['agent-ran-yuki', 'CHAMPION'],
      ['agent-shirakami-niku', 'CHAMPION'],
      ['agent-ryan-smith', 'CHAMPION'],
      ['agent-saki', 'CHAMPION'],
      ['agent-alice-westland', 'FINALS'],
      ['agent-tarruh', 'FINALS'],
      ['agent-tayna-lannister-muller', 'FINALS'],
      ['agent-mik-kashnov', 'ICON']
    ];
    expect(PLAYABLE_SPECIALS()).toHaveLength(10);
    for (const [identityId, edition] of expected) {
      const def = registry.card(`${identityId}-${edition.toLowerCase()}`);
      const resolved = resolveCardArt(def);
      expect(resolved, `${identityId} ${edition}`).toMatchObject({ kind: 'remote', sourceType: 'special' });
    }
  });

  it('os 18 agentes BASE têm arte remota', () => {
    for (const agent of JET_SNAPSHOT.agents) {
      const def = registry.card(`${agent.agentId}-base`);
      expect(resolveCardArt(def), agent.agentId).toMatchObject({ kind: 'remote', sourceType: 'base' });
    }
  });

  it('snapshot é standalone: sem Firebase/infra do Fórum, sem paths temporários', () => {
    const text: string = artSnapshotRaw;
    for (const forbidden of ['apiKey', 'authDomain', 'databaseURL', 'firestore', 'firebase-config', 'firebaseConfig', '.firebaseio.com', '/tmp/', 'marketValue', 'inventory']) {
      expect(text.includes(forbidden), forbidden).toBe(false);
    }
    expect(text).toContain('Gofreamer/cartinhas23');
  });
});
