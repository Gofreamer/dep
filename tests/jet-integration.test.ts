import { beforeAll, describe, expect, it } from 'vitest';
import { setup, deckOf, makeEngine, autoSetup, rigHand } from './helpers';
import { buildSnapshot } from '../src/integrations/jet/normalize';
import { defineProfiles } from '../src/data/jet/agentProfiles';
import { importSnapshot, pendingCatalog, profileKey, assertConvertible } from '../src/integrations/jet/importer';
import { convertAgent, mkAttack, mkAbility, mkEffect, pendingProfile } from '../src/integrations/jet/converter';
import { registry } from '../src/engine/registry';
import { charDef, player } from '../src/engine/queries';
import type { CharacterDef } from '../src/engine/types';
import { JET_ENERGY } from '../src/data/jet/energy';
import { registerJetDataPack } from '../src/data/jet/pack';
import { JET_TECHNIQUES, JET_EQUIPMENT, JET_FIELDS } from '../src/data/jet/auxiliares';

setup();

// ---------------------------------------------------------------------------
// Pipeline de importação Jet Tactics → JET TCG (testado com snapshot sintético
// — o snapshot REAL só é preenchido a partir do repositório oficial).
// ---------------------------------------------------------------------------

const CAPTURED = '2026-09-10';

function syntheticSnapshot() {
  return buildSnapshot({
    capturedAt: CAPTURED,
    setName: 'JET CORE SET — Alpha (teste)',
    teams: [{ id: 'kof-12', name: 'KOF 12', color: '#d4af37' }],
    editions: [{ id: 'BASE', name: 'Base' }, { id: 'MVP', name: 'MVP' }],
    agents: [
      {
        id: 'agent-jenny', name: 'Jenny', team: 'kof-12', role: 'Duelist',
        editions: ['BASE', 'MVP'], imageUrl: 'https://example.test/jenny.png'
      },
      {
        id: 'agent-kaio', name: 'Kaio', team: 'kof-12',
        editions: ['BASE']
      }
    ],
    kits: [
      {
        agentId: 'agent-jenny', role: 'Duelist',
        passive: { name: 'Ritmo Ofensivo', description: 'Ganha vantagem em duelos.' },
        skill: { name: 'Investida', description: 'Golpe rápido.' },
        signature: { name: 'Cometa Ascendente', description: 'Golpe decisivo.' }
      }
    ]
  });
}

function jennyBaseProfile() {
  return {
    agentId: 'agent-jenny',
    edition: 'BASE',
    status: 'CURATED' as const,
    cardId: 'agent-jenny-base',
    name: 'Jenny',
    faction: 'kof-12',
    rarity: 'rare' as const,
    maxHp: 110,
    retreatCost: 1,
    weakness: { affinity: 'umbra' },
    abilities: [
      mkAbility('ab-jenny-ritmo', 'Ritmo Ofensivo', 'whileActive', {
        mods: { damageDealtVsAffinity: { affinity: 'umbra', flat: 10 } },
        text: 'Duelista: +10 de dano contra Agentes Umbra.'
      })
    ],
    attacks: [
      mkAttack('atk-jenny-investida', 'Investida', [['*', 1]], 20, { text: 'Skill convertida.' }),
      mkAttack('atk-jenny-cometa', 'Cometa Ascendente', [['*', 2]], 50, { text: 'Signature convertida.' })
    ],
    victoryValue: 2,
    tags: ['duelist'],
    provenance: { sourceRepository: 'RocksXB/jet-tactics' as const, sourceType: 'curated-agents' as const, sourceId: 'curated-agents-1#jenny', capturedAt: CAPTURED }
  };
}

describe('Camada de integração Jet Tactics', () => {
  beforeAll(() => {
    registerJetDataPack(); // Energia JET + Técnicas + Equipamentos + Campos
    if (!registry.tryCard('agent-jenny-base')) {
      importSnapshot(syntheticSnapshot(), { profiles: defineProfiles(jennyBaseProfile()) });
    }
  });

  it('converte identidade + kit + perfil curado em carta jogável', () => {
    const def = registry.card('agent-jenny-base') as CharacterDef;
    expect(def.kind).toBe('CHARACTER');
    expect(def.name).toBe('Jenny');
    expect(def.identityId).toBe('agent-jenny');   // Parte 7: identityId
    expect(def.edition).toBe('BASE');             // Parte 8: edição ≠ estágio
    expect(def.stage).toBe(0);
    expect(def.faction).toBe('kof-12');           // Parte 16: equipe como facção
    expect(def.attacks.some((a) => a.id === 'atk-jenny-cometa')).toBe(true);
    const prov = (def as any).provenance;
    expect(prov.sourceRepository).toBe('RocksXB/jet-tactics'); // Parte 4: proveniência
    expect(prov.sourceId).toContain('jenny');
  });

  it('edição oficial sem perfil curado fica TCG_PROFILE_PENDING (não jogável)', () => {
    const report = importSnapshot(syntheticSnapshot(), { profiles: defineProfiles(jennyBaseProfile()) });
    // Jenny MVP e Kaio BASE existem na fonte mas não têm perfil → pendentes
    const pending = report.pending.map((p) => `${p.agentId}#${p.edition}`);
    expect(pending).toContain('agent-jenny#MVP');
    expect(pending).toContain('agent-kaio#BASE');
    // nenhuma carta inventada foi registrada
    expect(registry.tryCard('agent-jenny-mvp')).toBeUndefined();
    expect(registry.tryCard('agent-kaio-base')).toBeUndefined();
    const cat = pendingCatalog(syntheticSnapshot(), defineProfiles(jennyBaseProfile()));
    expect(cat.find((c) => c.edition === 'MVP')?.note).toContain('Aguardando adaptação');
  });

  it('variantes compartilham identityId e NÃO evoluem entre si', () => {
    const e = makeEngine({ p0: ['agent-jenny-base', ...Array(29).fill('jres-energia')], p1: deckOf('deck-controle-tatico') });
    autoSetup(e);
    // Jenny BASE registrada; MVP não existe — o invariante é: duas variantes
    // teriam o mesmo identityId e gap<1 rejeita upgrade (coberto em invariants)
    expect((registry.card('agent-jenny-base') as CharacterDef).identityId).toBe('agent-jenny');
    void e;
  });

  it('assertConvertible rejeita edição como estágio avançado', () => {
    const identity = syntheticSnapshot().agents[0];
    const bad = { ...jennyBaseProfile(), cardId: 'agent-jenny-mvp', edition: 'MVP', stage: 1 };
    expect(() => assertConvertible(convertAgent(bad, identity!).def)).toThrow(/edição nunca pode ser estágio/);
  });

  it('agente importado joga: ataque signature funciona na engine', () => {
    const e = makeEngine({ p0: ['agent-jenny-base', ...Array(29).fill('jres-energia')], p1: deckOf('deck-controle-tatico') });
    rigHand(e, 0, ['agent-jenny-base']);
    autoSetup(e);
    const p0 = player(e.state, 0);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    // Jenny como ativa (autoSetup pode tê-la sentado; arranjo direto de teste)
    const jenny = p0.hand.find((c) => c.defId === 'agent-jenny-base') ?? p0.active!;
    p0.hand = p0.hand.filter((c) => c !== jenny);
    if (p0.active !== jenny) {
      if (p0.active) p0.bench.push(p0.active);
      p0.active = jenny;
    }
    jenny.deployedOnTurn = 0;
    for (let i = 0; i < 3; i++) e.debugCommand('giveResource', { targetUid: jenny.uid, defId: 'jres-energia' });
    const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: 'atk-jenny-cometa' });
    expect(r.ok).toBe(true);
    expect(player(e.state, 1).active!.damage).toBeGreaterThan(0);
  });

  it('auxiliares JET: Energia conecta, Técnica joga, Campo entra', () => {
    expect(JET_ENERGY.length).toBeGreaterThan(0);
    expect(JET_TECHNIQUES.length).toBeGreaterThan(0);
    expect(JET_EQUIPMENT.length).toBeGreaterThan(0);
    expect(JET_FIELDS.some((f) => f.subtype === 'ARENA')).toBe(true);
    const e = makeEngine({ p0: ['agent-jenny-base', 'jact-leitura', 'jfd-arena', ...Array(27).fill('jres-energia')], p1: deckOf('deck-controle-tatico') });
    rigHand(e, 0, ['agent-jenny-base', 'jact-leitura', 'jfd-arena']);
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p0 = player(e.state, 0);
    const tec = p0.hand.find((c) => c.defId === 'jact-leitura')!;
    const handBefore = p0.hand.length;
    const r = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: tec.uid });
    expect(r.ok).toBe(true);
    expect(p0.hand.length).toBe(handBefore - 1 + 2); // gastou 1, comprou 2
    const campo = p0.hand.find((c) => c.defId === 'jfd-arena')!;
    const r2 = e.dispatch({ type: 'PLAY_FIELD', player: 0, uid: campo.uid });
    expect(r2.ok).toBe(true);
    expect(e.state.fields.some((f) => f.defId === 'jfd-arena')).toBe(true);
  });

  it('profileKey e pendentes têm proveniência registrada', () => {
    expect(profileKey('agent-jenny', 'BASE')).toBe('agent-jenny#BASE');
    const identity = syntheticSnapshot().agents[1]!;
    const p = pendingProfile(identity, 'BASE');
    expect(p.status).toBe('TCG_PROFILE_PENDING');
    expect(p.provenance.sourceRepository).toBe('RocksXB/jet-tactics');
    expect(mkEffect('drawCards', { amount: 1 }).op).toBe('drawCards');
  });
});
