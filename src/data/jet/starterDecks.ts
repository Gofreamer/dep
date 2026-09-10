import type { DeckDef } from '../deckUtils';

/**
 * STARTER DECKS JET (Parte 18) — compostos SOMENTE com o roster curado
 * importado da fonte oficial (RocksXB/jet-tactics @ 769196ea55) + cartas
 * auxiliares neutras do JET CORE SET. 60 cartas, máx. 4 cópias, sempre com
 * Agentes Base (stage 0) suficientes para o setup.
 *
 * Identidades:
 *  - KOF 12 "Pressão KOF": agressão — duelistas e breakers, Marca/Exaustão
 *    para fechar confrontos rápido (Ran Yuki, Xixim, Shirakami Niku, Jenny).
 *  - Asgard "Muralha Asgard": controle/defesa — Tenacidade, curas e
 *    Silêncio (Tarruh, Alice Westland, Tayná Lannister Müller).
 *  - Morning Star "Comando MS": versátil/liderança — purificação, economia
 *    de carta e recursos (Henry, Mik Kashnov, Ryan Smith, Saki).
 */
export const JET_STARTER_DECKS: DeckDef[] = [
  {
    id: 'deck-jet-kof-12',
    name: 'Pressão KOF 12',
    description: 'Agressão: Marca e Exaustão para fechar o jogo rápido (KOF 12).',
    cards: {
      'agent-ran-yuki-base': 3, 'agent-xixim-base': 3, 'agent-shirakami-niku-base': 3, 'agent-jenny-base': 2,
      'jres-energia': 25, 'jres-descarga': 2, 'jres-bateria': 2,
      'jact-foco-ofensivo': 3, 'jact-marcacao': 2, 'jact-leitura': 2, 'jact-recarga': 2, 'jact-corte-energia': 2,
      'jeq-manopla': 2, 'jeq-placa': 2,
      'jfd-arena': 2, 'jfd-ovacao': 2, 'jfd-zona-neutra': 1
    }
  },
  {
    id: 'deck-jet-asgard',
    name: 'Muralha Asgard',
    description: 'Controle: Tenacidade, curas em equipe e Silêncio (Asgard).',
    cards: {
      'agent-tarruh-base': 3, 'agent-alice-westland-base': 3, 'agent-tayna-lannister-muller-base': 3,
      'jres-energia': 26, 'jres-nucleo': 2, 'jres-bateria': 2,
      'jact-trincheira': 3, 'jact-purificacao': 2, 'jact-leitura': 2, 'jact-recarga': 2, 'jact-corte-energia': 2,
      'jeq-placa': 2, 'jeq-nucleo-hp': 2, 'jeq-propulsor': 1,
      'jfd-arena': 2, 'jfd-zona-neutra': 2, 'jfd-ovacao': 1
    }
  },
  {
    id: 'deck-jet-morning-star',
    name: 'Comando Morning Star',
    description: 'Versátil: purificação, economia de cartas e golpes de título (Morning Star).',
    cards: {
      'agent-ryan-smith-base': 3, 'agent-mik-kashnov-base': 3, 'agent-saki-base': 3, 'agent-henry-base': 2,
      'jres-energia': 25, 'jres-bateria': 2, 'jres-rele': 2,
      'jact-leitura': 3, 'jact-retomada': 2, 'jact-purificacao': 2, 'jact-rally': 1, 'jact-abre-espaco': 2,
      'jeq-ampulheta': 2, 'jeq-propulsor': 2, 'jeq-manopla': 1,
      'jfd-ovacao': 2, 'jfd-arena': 2, 'jfd-zona-neutra': 1
    }
  }
];
