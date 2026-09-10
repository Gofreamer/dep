import type { DeckDef } from '../../deckUtils';

/**
 * BARALHOS NEXO (fixture legado) — usados apenas por testes/dev.
 * O produto principal usa os Starter Decks JET (src/data/jet/starterDecks.ts).
 */
export { expandDeck, validateDeck, deckStats } from '../../deckUtils';
export type { DeckDef, DeckValidation } from '../../deckUtils';

export const STARTER_DECKS: DeckDef[] = [
  {
    id: 'deck-furia-solar',
    name: 'Fúria Solar',
    description: 'Agressivo: personagens rápidos, ataques baratos e pressão constante.',
    cards: {
      'char-cindro': 4, 'char-ignarok': 3, 'char-vulcannon': 2,
      'char-chispito': 3, 'char-voltraio': 2,
      'char-faiscante': 2, 'char-braseiro': 2, 'char-nimbo': 2, 'char-ciclone': 1,
      'res-solar': 8, 'res-volt': 5, 'res-neutro': 4, 'res-prisma': 2, 'res-cristal-furia': 1,
      'act-golpe': 2, 'act-furia': 3, 'act-inspiracao': 2, 'act-aceleracao': 2,
      'act-granada': 2, 'act-escudo': 2, 'act-reforcos': 2,
      'eq-lamina': 1, 'eq-foco': 1,
      'fd-arena-solar': 2
    }
  },
  {
    id: 'deck-ascensao',
    name: 'Ascensão',
    description: 'Evolução: começa devagar, mas domina o jogo com formas finais poderosas.',
    cards: {
      'char-brotinho': 3, 'char-floradon': 3, 'char-silvana': 2,
      'char-ploc': 3, 'char-marefix': 3, 'char-abissalor': 2,
      'char-vesper': 2, 'char-espectro': 2,
      'char-carvalho': 1, 'char-sementeira': 2, 'char-ondina': 1,
      'res-flora': 7, 'res-mare': 7, 'res-neutro': 3, 'res-essencia-viva': 1, 'res-nucleo-eco': 1, 'res-prisma': 1,
      'act-reforcos': 2, 'act-treinamento': 2, 'act-chamado': 1, 'act-inspiracao': 2,
      'act-estimulo': 2, 'act-balsamo': 1, 'act-soro': 1, 'act-purga': 1,
      'eq-amuleto': 1, 'eq-oraculo': 1,
      'fd-mare-alta': 1, 'fd-forja': 1
    }
  },
  {
    id: 'deck-controle-tatico',
    name: 'Controle Tático',
    description: 'Controle: trocas, curas, sabotagem de recursos e defesas incansáveis.',
    cards: {
      'char-ferrolho': 2, 'char-fortaleza': 2, 'char-bastiao': 1,
      'char-sombrio': 2, 'char-penumbra': 1, 'char-nihilux': 1,
      'char-flurro': 2, 'char-glaciar': 1,
      'char-curandeiro': 1, 'char-guardia': 1, 'char-drone': 1, 'char-automato': 1, 'char-lunaris': 1,
      'res-neutro': 7, 'res-umbra': 5, 'res-mare': 3, 'res-prisma': 2, 'res-ambar': 1, 'res-dinamo': 1,
      'act-manobra': 2, 'act-onda-choque': 2, 'act-sabotagem': 1, 'act-escudo': 2,
      'act-postura': 1, 'act-granada': 1, 'act-microbug': 1, 'act-inspiracao': 2,
      'act-reforcos': 1, 'act-reciclagem': 1, 'act-golpe': 1, 'act-rede': 1,
      'eq-escamas': 2, 'eq-botas': 2, 'eq-selo': 1, 'eq-canhao': 1,
      'fd-nevoeiro': 1, 'fd-zona-bloqueio': 1
    }
  }
];

/** Baralhos do tutorial (curtos, controlados). */
export const TUTORIAL_DECKS: DeckDef[] = [
  {
    id: 'deck-tutorial-aluno',
    name: 'Treinamento Nexo',
    description: 'Baralho guiado do tutorial.',
    cards: {
      'char-cindro': 3, 'char-chispito': 2, 'char-ignarok': 2, 'char-faiscante': 1,
      'res-solar': 5, 'res-volt': 4, 'res-neutro': 3,
      'act-golpe': 2, 'act-soro': 1, 'act-inspiracao': 1, 'act-manobra': 1, 'act-reforcos': 1,
      'eq-lamina': 1, 'fd-arena-solar': 1
    }
  },
  {
    id: 'deck-tutorial-instrutor',
    name: 'Instrutor',
    description: 'Baralho do instrutor (oponente do tutorial).',
    cards: {
      'char-sombrio': 2, 'char-vesper': 1, 'char-bandido': 1,
      'res-umbra': 5, 'res-neutro': 3
    }
  }
];

// ---------------------------------------------------------------------------
// Deck validation — centralized rules (config-driven)
// ---------------------------------------------------------------------------


