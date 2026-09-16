// @vitest-environment node
/**
 * ESTRUTURA DOS BARALHOS DE ARQUÉTIPO — o gate estrutural que faltava na 2.0.
 *
 * A auditoria achou decks matematicamente inviáveis: `platinum`, `weigon` e
 * `salvatore` tinham UMA identidade de agente (teto de 4 cópias por
 * identidade) → 4 a 8 corpos num jogo onde perder o último Agente Ativo é
 * derrota (`noActiveLoses`). Winrate baixo aqui é consequência de estrutura,
 * não de "+5/-5 de dano". Este teste trava a estrutura para que ninguém
 * "reescreva" o deck de novo para o buraco:
 *
 *   • 60 cartas, passando pelo MESMO `validateDeck` do produto e da Liga;
 *   • ≥12 agentes em campo e ≥3 identidades distintas (o plano sobrevive ao
 *     primeiro KO race);
 *   • ≤4 cópias por carta e por identidade;
 *   • a fação declarada do arquétipo é a maioria real do baralho (identidade
 *     preservada — o Platinum não vira aggro KOF com outro nome);
 *   • curva de Energia dentro de faixa (nem deck sem fôlego, nem 30 energias);
 *   • existe finisher (a condição de vitória documentada tem corpo no deck).
 */
import { describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { ARCHETYPES, ARCHETYPE_DECKS, complete } from '../src/data/jet/archetypes';
import { registry } from '../src/engine/registry';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { validateDeck } from '../src/data/deckUtils';

registerJetDataPack();

interface List {
  ids: string[];
  cards: Array<Record<string, any>>;
}

function listOf(archetypeId: string): List {
  const deck = ARCHETYPE_DECKS.find((d) => d.id === archetypeId);
  if (!deck) throw new Error(`deck do arquétipo ausente: ${archetypeId}`);
  const ids: string[] = [];
  for (const [id, n] of Object.entries(deck.cards)) for (let i = 0; i < n; i++) ids.push(id);
  return { ids, cards: ids.map((id) => registry.card(id) as unknown as Record<string, any>) };
}

describe('estrutura dos baralhos de arquétipo', () => {
  it('todo arquétipo documentado tem deck com o mesmo id', () => {
    expect(ARCHETYPE_DECKS.map((d) => d.id).sort()).toEqual(ARCHETYPES.map((a) => a.id).sort());
  });

  for (const arch of ARCHETYPES) {
    describe(arch.id, () => {
      const list = listOf(arch.id);

      it('tem exatamente 60 cartas e passa no validateDeck do produto', () => {
        expect(list.ids.length).toBe(60);
        const deck = ARCHETYPE_DECKS.find((d) => d.id === arch.id)!;
        const v = validateDeck(deck.cards, DEFAULT_CONFIG.deckRules, { requireBasic: true });
        expect(v.errors, v.errors.join(' · ')).toEqual([]);
        expect(v.valid).toBe(true);
      });

      it('não cita carta fora do registry', () => {
        for (const id of list.ids) expect(registry.tryCard(id), `carta inexistente: ${id}`).toBeTruthy();
      });

      it('tem ≥12 corpos e ≥3 identidades (não depende de um único agente)', () => {
        const chars = list.cards.filter((c) => c.kind === 'CHARACTER');
        const identities = new Set(chars.map((c) => String(c.identityId ?? c.id)));
        expect(chars.length, `${arch.id} entra em campo com ${chars.length} agentes`).toBeGreaterThanOrEqual(12);
        expect(identities.size, `${arch.id} só tem ${identities.size} identidade(s)`).toBeGreaterThanOrEqual(3);
      });

      it('respeita o teto de cópias por carta e por identidade', () => {
        const perCard: Record<string, number> = {};
        const perIdentity: Record<string, number> = {};
        for (const c of list.cards) {
          perCard[c.id] = (perCard[c.id] ?? 0) + 1;
          if (c.kind === 'CHARACTER') {
            const id = String(c.identityId ?? c.id);
            perIdentity[id] = (perIdentity[id] ?? 0) + 1;
          }
        }
        const rules = DEFAULT_CONFIG.deckRules;
        const exempt: string[] = rules.copyLimitExempt ?? [];
        for (const [id, n] of Object.entries(perCard)) {
          const def = registry.tryCard(id);
          // MESMA isenção do `validateDeck`: recurso básico não tem teto de 4
          // (é o que permite curva de Energia), e carta Única tem `uniqueMax`.
          const limit = def?.unique === true ? rules.uniqueMax : exempt.includes(String(def?.kind)) ? Infinity : rules.maxCopies;
          expect(n, `carta ${id} com ${n} cópias (limite ${limit})`).toBeLessThanOrEqual(limit);
        }
        for (const [id, n] of Object.entries(perIdentity)) {
          expect(n, `identidade ${id} com ${n} cópias`).toBeLessThanOrEqual(DEFAULT_CONFIG.deckRules.maxCopiesPerIdentity ?? 4);
          // o teto por identidade é o que impedia o Platinum da 2.0 de ter mais
          // corpos: ele NÃO sobe porque "faltam agentes" — o deck é que precisa
          // de aliança entre fações.
          expect(DEFAULT_CONFIG.deckRules.maxCopiesPerIdentity).toBe(4);
        }
      });

      it(`a fação declarada (${arch.faction}) é a maioria do baralho`, () => {
        const nonEnergy = list.cards.filter((c) => c.id !== 'jres-energia');
        const own = nonEnergy.filter((c) => c.faction === arch.faction).length;
        const share = own / nonEnergy.length;
        // 55%: abaixo disso o deck é outra coisa com o nome trocado (o que a
        // 2.0 fazia com Platinum/Weigon ao encher de corpo de fora sem plano).
        expect(share, `${arch.id}: só ${(share * 100).toFixed(0)}% de ${arch.faction}`).toBeGreaterThanOrEqual(0.55);
      });

      it('tem curva de Energia e finisher reais', () => {
        const resources = list.cards.filter((c) => c.kind === 'RESOURCE').length;
        expect(resources, `${arch.id}: ${resources} recursos`).toBeGreaterThanOrEqual(15);
        expect(resources).toBeLessThanOrEqual(28);
        const finisher = list.cards.some((c) => Array.isArray(c.tags) && c.tags.includes('finisher'));
        expect(finisher, `${arch.id} não tem finisher no deck (a condição de vitória "${arch.winCondition}" precisa existir em carta)`).toBe(true);
      });

      it('o plano e as fraquezas documentados citam apenas mecânicas que existem', () => {
        // `strengths`/`weaknesses` são usados na UI: nada de prometer regra que
        // a engine não implementa (a 2.0 prometia "ignora Resistência" sem flag).
        const text = [arch.plan, arch.winCondition, ...arch.strengths, ...arch.weaknesses, ...arch.counters].join(' ');
        if (/ignora Resistência/i.test(text)) {
          const hasIgnore = list.cards.some((c) => JSON.stringify(c).includes('ignoreResistance'));
          expect(hasIgnore, `${arch.id} fala em ignorar Resistência sem carta com ignoreResistance`).toBe(true);
        }
      });
    });
  }

  it('complete() só preenche até 60 e recusa estouro', () => {
    const filled = complete({ 'agent-kaio-base': 4 });
    expect(Object.values(filled).reduce((s, n) => s + n, 0)).toBe(60);
    expect(filled['jres-energia']).toBe(56);
    const big: Record<string, number> = {};
    for (const id of registry.allCards().slice(0, 13).map((c) => c.id)) big[id] = 5; // 65 > 60
    expect(() => complete(big)).toThrow(/>60/);
  });
});
