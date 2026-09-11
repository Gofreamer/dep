import { validateDeck } from '../src/data/deckUtils';
import { registry } from '../src/engine/registry';
import { DEFAULT_CONFIG, type CardDef, type CharacterDef } from '../src/engine/types';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';
import { JET_TUTORIAL_DECKS } from '../src/data/jet/tutorialDecks';

export { JET_STARTER_DECKS, JET_TUTORIAL_DECKS };

/** validateDeck com as regras JET (deep-merged do DEFAULT_CONFIG). */
export function validateDeckAny(cards: Record<string, number>) {
  return validateDeck(cards, DEFAULT_CONFIG.deckRules, { requireBasic: true });
}

export function jetCard(id: string) {
  return registry.card(id);
}

/** Catálogo completo do pack JET (requer registerJetDataPack antes). */
export function JET_TCG_ALL_CARDS(): CardDef[] {
  return registry.allCards();
}

/** Agrupamento de cartas CHARACTER por identityId (coleção agrupada). */
export function jetIdentityGroups(): { identityId: string; variants: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const def of registry.allCards()) {
    if (def.kind !== 'CHARACTER') continue;
    const cd = def as CharacterDef;
    if (!cd.identityId) continue;
    if (!groups.has(cd.identityId)) groups.set(cd.identityId, []);
    groups.get(cd.identityId)!.push(cd.id);
  }
  return [...groups.entries()].map(([identityId, variants]) => ({ identityId, variants }));
}
