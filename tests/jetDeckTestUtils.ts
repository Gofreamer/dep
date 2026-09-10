import { validateDeck } from '../src/data/deckUtils';
import { registry } from '../src/engine/registry';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';

export { JET_STARTER_DECKS };

/** validateDeck com as regras JET (deep-merged do DEFAULT_CONFIG). */
export function validateDeckAny(cards: Record<string, number>) {
  return validateDeck(cards, DEFAULT_CONFIG.deckRules, { requireBasic: true });
}

export function jetCard(id: string) {
  return registry.card(id);
}
