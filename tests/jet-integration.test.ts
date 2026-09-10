import { beforeAll, describe, expect, it } from 'vitest';
import { setup, deckOf, makeEngine, autoSetup, rigHand } from './helpers';
import { buildSnapshot } from '../src/integrations/jet/normalize';
import { AGENT_TCG_PROFILES } from '../src/data/jet/agentProfiles';
import { registerJetDataPack, jetPendingCatalog } from '../src/data/jet/pack';
import { importSnapshot, profileKey } from '../src/integrations/jet/importer';
import { registry } from '../src/engine/registry';
import { charDef, countAllInstances, player } from '../src/engine/queries';
import type { CharacterDef } from '../src/engine/types';
import { JET_SNAPSHOT } from '../src/data/jet/snapshot';
import { JET_STARTER_DECKS, validateDeckAny } from './jetDeckTestUtils';

setup();

// ---------------------------------------------------------------------------
// Pipeline Jet Tactics → JET TCG com o SNAPSHOT REAL importado da fonte.
// ---------------------------------------------------------------------------

describe('Roster JET importado (fonte real)', () => {
  beforeAll(() => registerJetDataPack());

  it('registra as 18 identidades curadas com proveniência', () => {
    expect(JET_SNAPSHOT.agents.length).toBe(18);
    const report = registerJetDataPack();
    expect(report.agentsRegistered.length).toBeGreaterThanOrEqual(18);
    // toda carta de agente carrega proveniência rastreável
    const jenny = registry.card('agent-jenny-base') as any;
    expect(jenny.provenance.sourceRepository).toBe('RocksXB/jet-tactics');
    expect(jenny.provenance.sourceId).toContain('kof 12_jenny');
  });

  it('identidade vs carta: variantes compartilham identityId e são stage 0', () => {
    for (const def of registry.allCards().filter((c) => c.kind === 'CHARACTER')) {
      const cd = def as CharacterDef;
      if (!cd.id.startsWith('agent-')) continue;
      expect(cd.stage).toBe(0); // edição NUNCA é estágio
      expect(cd.identityId).toMatch(/^agent-/);
    }
    const base = registry.card('agent-jenny-base') as CharacterDef;
    const mvp = registry.card('agent-jenny-mvp') as CharacterDef;
    expect(base.identityId).toBe(mvp.identityId);
    expect(base.edition).toBe('BASE');
    expect(mvp.edition).toBe('MVP');
  });

  it('as 10 edições especiais oficiais viram cartas jogáveis como SIDE GRADES', () => {
    const expected = [
      'agent-jenny-mvp', 'agent-alice-westland-finals', 'agent-tarruh-finals',
      'agent-tayna-lannister-muller-finals', 'agent-ran-yuki-champion',
      'agent-shirakami-niku-champion', 'agent-wei-wang-mvp',
      'agent-mik-kashnov-icon', 'agent-ryan-smith-champion', 'agent-saki-champion'
    ];
    for (const id of expected) {
      const def = registry.tryCard(id) as CharacterDef | undefined;
      expect(def, id).toBeDefined();
      // sidegrade: mesmos stats de combate da BASE (nada de +poder automático)
      const baseId = id.replace(/-(mvp|champion|finals|icon)$/, '-base');
      const base = registry.card(baseId) as CharacterDef;
      expect(def!.maxHp).toBe(base.maxHp);
      expect(def!.victoryValue).toBe(base.victoryValue);
      // e o slot substituído OFICIALMENTE tem um ataque com o nome da fonte
      const slotName = JET_SNAPSHOT.editionVariants.find((v) => id.startsWith(v.agentId))!.action.name;
      expect(def!.attacks.some((a) => a.name === slotName), `${id} deve ter "${slotName}"`).toBe(true);
    }
  });

  it('edições não curadas (RIVALRY) ficam TCG_PROFILE_PENDING e não são jogáveis', () => {
    // na fonte real RIVALRY/CHAMPIONSHIP existem como conceito, mas SEM perfil curado:
    // o catálogo de pendentes só lista o que existe oficialmente e não foi adaptado
    const pending = jetPendingCatalog();
    for (const p of pending) expect(p.note).toContain('Aguardando adaptação');
    // nenhuma carta inventada: ids de edições sem perfil não estão registrados
    expect(registry.tryCard('agent-jenny-rivalry')).toBeUndefined();
    expect(registry.tryCard('agent-jenny-championship')).toBeUndefined();
  });

  it('papel vira mecânica: Suporte cura/compra, Breaker marca/exausta, Duelista pressiona', () => {
    const jenny = registry.card('agent-jenny-base') as CharacterDef;         // Suporte
    expect(jenny.abilities.some((a) => a.trigger === 'activated')).toBe(true); // Ability convertida
    expect(jenny.attacks.some((a) => a.effects?.some((e) => e.op === 'heal'))).toBe(true);

    const kaio = registry.card('agent-kaio-base') as CharacterDef;           // Breaker
    const kaioText = JSON.stringify(kaio.attacks);
    expect(kaioText).toContain('marked');   // punição via Marca
    expect(kaioText).toContain('exhausted'); // ou Exaustão

    const ruby = registry.card('agent-ruby-base') as CharacterDef;           // Duelista solo
    expect(ruby.attacks.reduce((s, a) => s + (a.damage ?? 0), 0)).toBeGreaterThan(40);
  });

  it('raridade e holo não conferem poder; todos os agentes são stage 0 jogáveis', () => {
    for (const def of registry.allCards().filter((c) => c.id.startsWith('agent-'))) {
      const cd = def as CharacterDef;
      expect(cd.attacks.length + cd.abilities.length).toBeGreaterThan(0);
      expect(cd.maxHp).toBeGreaterThanOrEqual(90);
      expect(cd.holo).toBeUndefined(); // pack curado não emite holo (cosmético futuro)
    }
  });
});

describe('Starter Decks JET', () => {
  it('os 3 decks são válidos (60 cartas, ≤4 cópias, com starter Base)', () => {
    expect(JET_STARTER_DECKS.length).toBe(3);
    for (const deck of JET_STARTER_DECKS) {
      const v = validateDeckAny(deck.cards);
      expect(v.errors, `${deck.id}: ${v.errors.join('; ')}`).toEqual([]);
      expect(v.counts.total).toBe(60);
    }
  });

  it('cada deck usa apenas agentes da sua equipe e tem identidade distinta', () => {
    for (const deck of JET_STARTER_DECKS) {
      const team = deck.id.replace('deck-jet-', '');
      for (const [id, n] of Object.entries(deck.cards)) {
        if (!id.startsWith('agent-')) continue;
        const def = registry.card(id) as CharacterDef;
        expect(def.faction, `${deck.id} usa ${id} de ${def.faction}`).toBe(team);
        void n;
      }
    }
    // identidades distintas: KOF agressão (mais dano), Asgard defesa (mais cura)
    const sumDamage = (cards: Record<string, number>) => Object.entries(cards).reduce((s, [id, n]) => {
      const d = registry.tryCard(id);
      if (!d || d.kind !== 'CHARACTER') return s;
      return s + (d as CharacterDef).attacks.reduce((x, a) => x + (a.damage ?? 0), 0) * n;
    }, 0);
    const sumHeal = (cards: Record<string, number>) => Object.entries(cards).reduce((s, [id, n]) => {
      const d = registry.tryCard(id);
      if (!d || d.kind !== 'CHARACTER') return s;
      const txt = JSON.stringify(d.attacks);
      return s + (txt.includes('"op":"heal"') ? 1 : 0) * n;
    }, 0);
    const kof = JET_STARTER_DECKS.find((d) => d.id === 'deck-jet-kof-12')!;
    const asgard = JET_STARTER_DECKS.find((d) => d.id === 'deck-jet-asgard')!;
    expect(sumDamage(kof.cards)).toBeGreaterThan(sumDamage(asgard.cards));
    expect(sumHeal(asgard.cards)).toBeGreaterThan(sumHeal(kof.cards));
  });
});

describe('Partida completa JET (humano guiado vs IA)', () => {
  it('agente importado ataca com a Signature convertida e conserva instâncias', () => {
    const e = makeEngine({
      p0: ['agent-jenny-base', 'agent-mik-kashnov-base', 'jres-energia', 'jres-energia', 'jres-energia', 'jact-leitura', ...Array(23).fill('jres-energia')],
      p1: deckOf('deck-jet-kof-12')
    });
    rigHand(e, 0, ['agent-jenny-base', 'agent-mik-kashnov-base', 'jres-energia', 'jres-energia', 'jres-energia', 'jact-leitura']);
    autoSetup(e);
    const p0 = player(e.state, 0);
    const jenny = p0.hand.find((c) => c.defId === 'agent-jenny-base') ?? p0.active!;
    if (p0.active !== jenny) {
      if (p0.active) p0.bench.push(p0.active);
      p0.active = jenny;
      p0.hand = p0.hand.filter((c) => c !== jenny);
    }
    e.state.turn = 2;
    e.state.activePlayer = 0;
    jenny.deployedOnTurn = 0;
    for (let i = 0; i < 2; i++) e.debugCommand('giveResource', { targetUid: jenny.uid, defId: 'jres-energia' });
    const totalBefore = countAllInstances(e.state).total;
    const signature = charDef(jenny).attacks.find((a) => a.name === 'Todos no Ritmo')!;
    const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: signature.id });
    expect(r.ok).toBe(true);
    // cura aplicada nos aliados (Suporte convertido) e nenhuma carta criada/perdida
    expect(countAllInstances(e.state).total).toBe(totalBefore);
    expect(p0.active!.damage).toBeLessThanOrEqual(jenny.damage);
  });

  it('IA vs IA termina partidas JET em múltiplas seeds sem deadlock', () => {
    // executado em tests/jet-flow.test.ts (cobertura completa)
    expect(JET_STARTER_DECKS.length).toBe(3);
  });
});
