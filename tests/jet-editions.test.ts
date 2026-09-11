import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { AGENT_TCG_PROFILES, OFFICIAL_EDITION_VARIANTS } from '../src/data/jet/agentProfiles';
import { JET_SNAPSHOT } from '../src/data/jet/snapshot';
import { registry } from '../src/engine/registry';
import { MatchEngine } from '../src/engine/engine';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { expandDeck } from '../src/data/deckUtils';
import { player } from '../src/engine/queries';
import type { CharacterDef } from '../src/engine/types';

/**
 * AS 10 EDIÇÕES ESPECIAIS OFICIAIS — teste específico por variante.
 * Garante a composição baseProfile + editionSidegrade: herda tudo da BASE e
 * substitui EXATAMENTE o slot declarado (attack.role), nunca por custo.
 */

beforeAll(() => { registerJetDataPack(); });

const EXPECTED_VARIANTS: [string, string, string, 'skill' | 'signature'][] = [
  ['Jenny', 'MVP', 'MVP Tempo', 'skill'],
  ['Wei Wang', 'MVP', 'MVP Lock', 'signature'],
  ['Ran Yuki', 'CHAMPION', 'Champion Point', 'signature'],
  ['Shirakami Niku', 'CHAMPION', 'Trono Inabalável', 'signature'],
  ['Ryan Smith', 'CHAMPION', 'Comando de Campeão', 'signature'],
  ['Saki', 'CHAMPION', 'Golpe do Título', 'signature'],
  ['Alice Westland', 'FINALS', 'Final Cover', 'skill'],
  ['Tarruh', 'FINALS', 'All-In de Final', 'skill'],
  ['Tayná Lannister Müller', 'FINALS', 'Fechamento de Final', 'skill'],
  ['Mik Kashnov', 'ICON', 'Ícone de Campo', 'skill']
];

function cardOf(name: string, edition: string): CharacterDef {
  const identity = JET_SNAPSHOT.agents.find((a) => a.name === name)!;
  const id = edition === 'BASE' ? `${identity.agentId}-base` : `${identity.agentId}-${edition.toLowerCase()}`;
  return registry.card(id) as CharacterDef;
}

describe('Composição das variantes (dados)', () => {
  it('declara exatamente as 10 variantes oficiais com o slot da fonte', () => {
    expect(OFFICIAL_EDITION_VARIANTS.length).toBe(10);
    for (const [name, edition, , slot] of EXPECTED_VARIANTS) {
      const v = OFFICIAL_EDITION_VARIANTS.find((x) => x.name === name && x.edition === edition);
      expect(v, `${name} ${edition}`).toBeDefined();
      expect(v!.replaces).toBe(slot);
      expect(v!.attack.role).toBe(slot);
      // consistência com o snapshot da fonte
      const identity = JET_SNAPSHOT.agents.find((a) => a.name === name)!;
      const src = JET_SNAPSHOT.editionVariants.find((x) => x.agentId === identity.agentId && x.edition === edition);
      expect(src, `${name} ${edition} na fonte`).toBeDefined();
      expect(src!.replaces).toBe(slot);
    }
  });
});

for (const [name, edition, actionName, slot] of EXPECTED_VARIANTS) {
  describe(`Variante ${name} ${edition}`, () => {
    it('herda identidade/stats da BASE e substitui somente o slot oficial', () => {
      const base = cardOf(name, 'BASE');
      const variant = cardOf(name, edition);
      // identidade/estágio/facção
      expect(variant.identityId).toBe(base.identityId);
      expect(variant.stage).toBe(0);
      expect(variant.faction).toBe(base.faction);
      // política de stats: HP, retreat e PV de vitória idênticos à BASE
      expect(variant.maxHp).toBe(base.maxHp);
      expect(variant.retreatCost).toBe(base.retreatCost);
      expect(variant.victoryValue).toBe(base.victoryValue);
      // passivas/abilities da BASE preservadas (nenhum sidegrade oficial troca passiva)
      expect(variant.abilities.map((a) => a.id).sort()).toEqual(base.abilities.map((a) => a.id).sort());
      // slot correto substituído
      const replaced = variant.attacks.find((a) => a.role === slot)!;
      expect(replaced.name).toBe(actionName);
      // slot INCORRETO preservado (mesmo id e nome da BASE)
      const keptRole = slot === 'skill' ? 'signature' : 'skill';
      const baseKept = base.attacks.find((a) => a.role === keptRole)!;
      const kept = variant.attacks.find((a) => a.role === keptRole)!;
      expect(kept.id).toBe(baseKept.id);
      expect(kept.name).toBe(baseKept.name);
      expect(kept.damage).toBe(baseKept.damage);
      // exatamente 2 ataques, cada um com role
      expect(variant.attacks.length).toBe(2);
      expect(variant.attacks.filter((a) => a.role).length).toBe(2);
    });

    it('raridade muda (metadado) sem alterar gameplay; flavor traz o tradeoff oficial', () => {
      const base = cardOf(name, 'BASE');
      const variant = cardOf(name, edition);
      expect(variant.rarity).not.toBe(base.rarity); // sidegrade é raro/épico/lendário
      expect(variant.maxHp).toBe(base.maxHp);       // …mas stats idênticos
      expect(variant.holo).toBeUndefined();          // holo cosmético não existe no CORE SET
      expect(variant.flavor).toBeTruthy();           // tradeoff documentado na fonte
    });

    it('perfil registrado contém proveniência da edição', () => {
      const identity = JET_SNAPSHOT.agents.find((a) => a.name === name)!;
      const profile = AGENT_TCG_PROFILES[`${identity.agentId}#${edition}`];
      expect(profile).toBeDefined();
      expect(profile.provenance.sourceRepository).toBe('RocksXB/jet-tactics.');
      expect(profile.provenance.sourceEdition).toBe(edition);
      expect(profile.provenance.sourceId).toContain('editions#');
    });
  });
}

describe('Nenhuma edição é evolução', () => {
  it('UPGRADE Jenny BASE → Jenny MVP é rejeitado pela engine', () => {
    const deck = expandDeck({ id: 'vx', name: 'vx', description: '', cards: { 'agent-jenny-base': 3, 'agent-jenny-mvp': 3, 'jres-energia': 34 } })
      .map((id) => registry.card(id));
    const e = new MatchEngine({
      seed: 5, config: DEFAULT_CONFIG,
      players: [
        { name: 'A', deckId: 'vx', isAI: false, aiLevel: 'normal', deck },
        { name: 'B', deckId: 'vy', isAI: false, aiLevel: 'normal', deck: expandDeck({ id: 'vy', name: 'vy', description: '', cards: { 'agent-ruby-base': 2, 'jres-energia': 38 } }).map((id) => registry.card(id)) }
      ]
    });
    const me = player(e.state, 0);
    // garante as duas variantes na mão (rig determinístico de instâncias reais)
    for (const wantId of ['agent-jenny-base', 'agent-jenny-mvp']) {
      if (!me.hand.some((c) => c.defId === wantId)) {
        const inst = me.deck.find((c) => c.defId === wantId);
        if (inst) { me.deck.splice(me.deck.indexOf(inst), 1); me.hand.push(inst); }
      }
    }
    const base = me.hand.find((c) => c.defId === 'agent-jenny-base');
    const mvp = me.hand.find((c) => c.defId === 'agent-jenny-mvp');
    expect(base).toBeDefined();
    expect(mvp).toBeDefined();
    e.dispatch({ type: 'SETUP_SET_ACTIVE', player: 0, uid: base!.uid });
    e.dispatch({ type: 'SETUP_DONE', player: 0 });
    // mesmo após o setup, UPGRADE entre variantes da mesma identidade é ilegal
    const legal = e.legalActions(0);
    expect(legal.upgradable.find((u) => u.to === mvp!.uid)).toBeUndefined();
    const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: mvp!.uid, targetUid: base!.uid });
    expect(r.ok).toBe(false);
  });
});
